import {
  DeviceKind,
  DeviceState,
  EntityState,
  FIXED_DT,
  FxEvent,
  GRID_CELL,
  GRID_COLS,
  GRID_ROWS,
  LevelSpec,
  MacroElectronState,
  MissionStatus,
  ObserverState,
  SimEventCallbacks,
  SimLogEntry,
  SPECTRUM_META,
  SpectrumType,
  WallState,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './types';
import {
  clamp,
  computeMetalRailSlide,
  dist,
  pointInRect,
  segmentRectHit,
  wallBlocksClassical,
} from './geometry';
import {
  applyEMForces,
  CLASSICAL_DECAY_PER_SEC,
  CLOUD_DECAY_PER_SEC,
  ELECTRON_BASE_SPEED,
} from './EMFieldSolver';
import { ObserverSystem } from './ObserverSystem';
import { CollapseEngine } from './CollapseEngine';

export const MACRO_FUSION_TRIGGER_DIST = 44;
export const MACRO_FUSION_PULSE_RADIUS = 250;

export class SimulationWorld {
  public level!: LevelSpec;
  public walls: WallState[] = [];
  public entities: EntityState[] = [];
  public devices: DeviceState[] = [];
  public observers: ObserverState[] = [];

  public emitterX = 0;
  public emitterY = 0;
  public emitterAngle = 0;

  public selectedSpectrum: SpectrumType = 'alpha';
  public remainingAmmo = 0;
  public inventory: Record<DeviceKind, number> = {
    deflector: 0,
    attractor: 0,
    screen: 0,
    beacon: 0,
  };

  /** 支持同场多颗活跃宏电子（用于双球宏聚变与自由沙盒） */
  public electrons: MacroElectronState[] = [];
  public collapseEngines = new Map<number, CollapseEngine>();
  public observerSystem = new ObserverSystem();

  public fxEvents: FxEvent[] = [];
  public logs: SimLogEntry[] = [];

  public elapsedTime = 0;
  public paused = true;
  public status: MissionStatus = 'playing';
  public statusReason = '';
  public playerObserversEnabled = true;

  private lastLaunchTime = -1;
  private nextId = 1;
  private callbacks: SimEventCallbacks;

  constructor(level: LevelSpec, callbacks: SimEventCallbacks = {}) {
    this.callbacks = callbacks;
    this.loadLevel(level);
  }

  /** 向后兼容单球主视角的快捷读取器（取最新一颗活跃宏电子） */
  public get electron(): MacroElectronState | null {
    for (let i = this.electrons.length - 1; i >= 0; i--) {
      if (this.electrons[i].alive) return this.electrons[i];
    }
    return this.electrons[this.electrons.length - 1] ?? null;
  }

  public get maxConcurrentElectrons(): number {
    if (this.level.isSandbox) return 4;
    return this.level.maxConcurrentElectrons ?? (this.level.macroFusionEnabled ? 2 : 1);
  }

  public get activeElectronCount(): number {
    return this.electrons.filter((e) => e.alive).length;
  }

  public loadLevel(level: LevelSpec): void {
    this.level = level;
    this.walls = level.walls.map((w) => ({ ...w, destroyed: false }));
    this.entities = level.entities.map((e) => ({
      ...e,
      remainingMaterials: [...e.materials],
      destroyed: false,
      disabled: false,
      blastTriggered: false,
      phasePassTimer: 0,
      ghostActive: false,
    }));
    this.devices = level.devices.map((d) => ({ ...d, pulseTimer: 0 }));
    this.observers = level.observers.map((o) => ({
      ...o,
      sweep: o.sweep ? { ...o.sweep } : undefined,
      polygon: [],
      permanentlyDisabled: false,
      suppressedByGhost: false,
    }));

    // 若关卡预设了 beacon 装置，为其挂载对应的己方观测源
    for (const dev of this.devices) {
      if (dev.kind === 'beacon') {
        this.attachBeaconObserver(dev);
      }
    }

    this.emitterX = level.emitter.x;
    this.emitterY = level.emitter.y;
    this.emitterAngle = level.emitter.angleRad;
    this.selectedSpectrum = level.defaultSpectrum;
    this.remainingAmmo = level.ammo;
    this.inventory = {
      deflector: level.inventory.deflector ?? 0,
      attractor: level.inventory.attractor ?? 0,
      screen: level.inventory.screen ?? 0,
      beacon: level.inventory.beacon ?? 0,
    };

    this.electrons = [];
    this.collapseEngines.clear();
    this.fxEvents = [];
    this.logs = [];
    this.elapsedTime = 0;
    this.lastLaunchTime = -1;
    this.paused = true;
    this.status = 'playing';
    this.statusReason = '';

    const anyPlayerObsActive = this.observers.some(
      (o) => o.owner === 'player' && o.active
    );
    this.playerObserversEnabled = anyPlayerObsActive || Boolean(level.ambientObserved);

    this.updateQuantumGhosts();
    this.observerSystem.update(
      this.observers,
      this.walls,
      this.devices,
      this.elapsedTime,
      Boolean(this.level.ambientObserved)
    );

    this.addLog(`实验 [${level.code}] ${level.title} 已载入。`, 'highlight');
  }

  private attachBeaconObserver(dev: DeviceState): void {
    const obsId = `obs_dev_${dev.id}`;
    dev.linkedObserverId = obsId;
    this.observers.push({
      id: obsId,
      name: '便携观测信标',
      x: dev.x,
      y: dev.y,
      angleRad: dev.angleRad,
      fovRad: 1.25,
      range: 410,
      active: dev.beaconActive ?? this.playerObserversEnabled,
      owner: 'player',
      polygon: [],
      permanentlyDisabled: false,
      suppressedByGhost: false,
      sourceDeviceId: dev.id,
    });
  }

  public addLog(text: string, level: SimLogEntry['level'] = 'info'): void {
    this.logs.unshift({ time: this.elapsedTime, text, level });
    if (this.logs.length > 48) this.logs.length = 48;
  }

  public setSpectrum(spec: SpectrumType): boolean {
    if (!this.level.allowedSpectrums.includes(spec)) return false;
    this.selectedSpectrum = spec;
    this.addLog(`频谱调谐至 ${SPECTRUM_META[spec].name}`, 'info');
    return true;
  }

  public setEmitterAngle(rad: number): void {
    let a = rad;
    if (
      this.level.emitter.minAngleRad !== undefined &&
      this.level.emitter.maxAngleRad !== undefined
    ) {
      a = clamp(a, this.level.emitter.minAngleRad, this.level.emitter.maxAngleRad);
    }
    this.emitterAngle = a;
  }

  public togglePause(force?: boolean): void {
    if (this.status !== 'playing') return;
    this.paused = force !== undefined ? force : !this.paused;
  }

  /** 一键开关所有己方主动观测源 */
  public setPlayerObserversActive(active: boolean): void {
    if (this.level.ambientObserved) {
      this.callbacks.onToast?.('本关处于全明实验室环境，暂不涉及观测盲区切换。', false);
      return;
    }
    this.playerObserversEnabled = active;
    for (const obs of this.observers) {
      if (obs.owner === 'player') {
        obs.active = active;
      }
    }
    this.refreshObservationAndGhosts();
    this.callbacks.onObserverToggle?.(active);
    this.addLog(
      active ? '己方主动观测源已开启：波函数锁定激活' : '己方主动观测源已切断：暗区进入量子叠加态',
      active ? 'highlight' : 'info'
    );

    if (active) {
      for (const e of this.electrons) {
        if (e.alive && e.mode === 'cloud') {
          this.tryCollapseCloud(e);
        }
      }
    }
  }

  /** 单独切换某一个己方观测源 */
  public toggleSingleObserver(observerId: string): boolean {
    const obs = this.observers.find((o) => o.id === observerId && o.owner === 'player');
    if (!obs) return false;
    obs.active = !obs.active;
    this.playerObserversEnabled = this.observers.some(
      (o) => o.owner === 'player' && o.active
    );
    this.refreshObservationAndGhosts();
    this.callbacks.onObserverToggle?.(obs.active);
    this.addLog(
      `${obs.name} → ${obs.active ? '开启观测' : '关闭观测'}`,
      obs.active ? 'highlight' : 'info'
    );
    if (obs.active) {
      for (const e of this.electrons) {
        if (e.alive && e.mode === 'cloud') {
          this.tryCollapseCloud(e);
        }
      }
    }
    return true;
  }

  public placeDevice(kind: DeviceKind, x: number, y: number, angleRad = 0): DeviceState | null {
    if (this.inventory[kind] <= 0 && !this.level.isSandbox) return null;
    if (x < 26 || x > WORLD_WIDTH - 26 || y < 26 || y > WORLD_HEIGHT - 26) return null;

    for (const w of this.walls) {
      if (!w.destroyed && pointInRect(x, y, w.x, w.y, w.w, w.h, 10)) {
        this.callbacks.onToast?.('无法将装置嵌入实体墙面内部。', true);
        return null;
      }
    }

    if (!this.level.isSandbox) {
      this.inventory[kind] -= 1;
    }

    const radiusMap: Record<DeviceKind, number> = {
      deflector: 76,
      attractor: 108,
      screen: 56, // 总宽 112px 光学遮蔽幕
      beacon: 24,
    };

    const dev: DeviceState = {
      id: `dev_${this.nextId++}`,
      kind,
      x,
      y,
      angleRad,
      radius: radiusMap[kind],
      fixed: false,
      pulseTimer: 0,
      beaconActive: this.playerObserversEnabled,
    };
    this.devices.push(dev);

    if (kind === 'beacon') {
      this.attachBeaconObserver(dev);
    }

    this.refreshObservationAndGhosts();

    const nameMap: Record<DeviceKind, string> = {
      deflector: '超导磁偏转器',
      attractor: '高压引雷针',
      screen: '光学遮蔽幕',
      beacon: '便携观测信标',
    };
    this.addLog(`已部署 ${nameMap[kind]} (${Math.round(x)}, ${Math.round(y)})`);
    return dev;
  }

  public removeDevice(deviceId: string): boolean {
    const idx = this.devices.findIndex((d) => d.id === deviceId && !d.fixed);
    if (idx < 0) return false;
    const [removed] = this.devices.splice(idx, 1);
    if (removed.linkedObserverId) {
      this.observers = this.observers.filter((o) => o.id !== removed.linkedObserverId);
    }
    if (!this.level.isSandbox) {
      this.inventory[removed.kind] += 1;
    }
    this.refreshObservationAndGhosts();
    this.addLog('已回收战术装置');
    return true;
  }

  public moveDevice(deviceId: string, x: number, y: number): void {
    const dev = this.devices.find((d) => d.id === deviceId && !d.fixed);
    if (!dev) return;
    const nx = clamp(x, 26, WORLD_WIDTH - 26);
    const ny = clamp(y, 26, WORLD_HEIGHT - 26);
    for (const w of this.walls) {
      if (!w.destroyed && pointInRect(nx, ny, w.x, w.y, w.w, w.h, 8)) return;
    }
    dev.x = nx;
    dev.y = ny;
    if (dev.linkedObserverId) {
      const obs = this.observers.find((o) => o.id === dev.linkedObserverId);
      if (obs) {
        obs.x = nx;
        obs.y = ny;
      }
    }
    this.refreshObservationAndGhosts();
  }

  public rotateDevice(deviceId: string, angleRad: number): void {
    const dev = this.devices.find(
      (d) =>
        d.id === deviceId &&
        !d.fixed &&
        (d.kind === 'deflector' || d.kind === 'screen' || d.kind === 'beacon')
    );
    if (!dev) return;
    dev.angleRad = angleRad;
    if (dev.linkedObserverId) {
      const obs = this.observers.find((o) => o.id === dev.linkedObserverId);
      if (obs) obs.angleRad = angleRad;
    }
    this.refreshObservationAndGhosts();
  }

  /** 激发一颗新的宏电子 */
  public launchElectron(): boolean {
    if (this.status !== 'playing') return false;
    if (this.activeElectronCount >= this.maxConcurrentElectrons) {
      this.callbacks.onToast?.(
        this.maxConcurrentElectrons > 1
          ? `场内已达上限 (${this.maxConcurrentElectrons} 颗活跃宏电子)。`
          : '当前场内已存在一颗活跃宏电子，请等待其坍缩或退激。',
        true
      );
      return false;
    }
    if (this.elapsedTime - this.lastLaunchTime < 0.15 && this.activeElectronCount > 0) {
      return false;
    }
    if (this.remainingAmmo === 0) {
      this.callbacks.onToast?.('可用宏电子已耗尽，按 R 重置实验。', true);
      return false;
    }

    if (this.remainingAmmo > 0) {
      this.remainingAmmo -= 1;
    }
    this.lastLaunchTime = this.elapsedTime;

    const startX = this.emitterX + Math.cos(this.emitterAngle) * 26;
    const startY = this.emitterY + Math.sin(this.emitterAngle) * 26;
    const observedAtStart = this.isPointObserved(startX, startY);

    const e: MacroElectronState = {
      id: this.nextId++,
      spectrum: this.selectedSpectrum,
      mode: observedAtStart ? 'classical' : 'cloud',
      x: startX,
      y: startY,
      vx: Math.cos(this.emitterAngle) * ELECTRON_BASE_SPEED,
      vy: Math.sin(this.emitterAngle) * ELECTRON_BASE_SPEED,
      speed: ELECTRON_BASE_SPEED,
      stability: 100,
      maxStability: 100,
      alive: true,
      cloudAge: 0,
      trail: [{ x: startX, y: startY }],
      chargedDeviceIds: new Set<string>(),
      passedEntityIds: new Set<string>(),
    };

    this.electrons.push(e);
    const engine = new CollapseEngine();
    this.collapseEngines.set(e.id, engine);

    if (e.mode === 'cloud') {
      engine.seedFromClassical(e);
      this.addLog(
        `[${SPECTRUM_META[e.spectrum].symbol}] 宏电子在盲区激发 → 直接演化为量子概率云`,
        'highlight'
      );
      this.callbacks.onModeChange?.('cloud');
    } else {
      this.addLog(
        `[${SPECTRUM_META[e.spectrum].symbol}] 激发球状闪电 (${SPECTRUM_META[e.spectrum].shortName})`,
        'highlight'
      );
    }

    this.paused = false;
    this.callbacks.onLaunch?.(e.spectrum);
    return true;
  }

  public isPointObserved(x: number, y: number): boolean {
    return this.observerSystem.isPointObservedExact(
      x,
      y,
      this.observers,
      this.walls,
      Boolean(this.level.ambientObserved)
    );
  }

  /** 获取当前关卡所有未完成主要目标区域的最大概率幅 Ψ */
  public getTargetMaxPsi(): number {
    let best = 0;
    for (const e of this.electrons) {
      if (!e.alive || e.mode !== 'cloud') continue;
      const eng = this.collapseEngines.get(e.id);
      if (!eng) continue;
      for (const ent of this.entities) {
        if (ent.destroyed || !ent.requiredDestroyLayers?.length) continue;
        const v = eng.sampleMaxPsiAround(ent.x, ent.y, ent.radius + 10);
        if (v > best) best = v;
      }
    }
    return best;
  }

  /** 更新无观测暗区中的量子幽灵显化与压制效应（如林云量子态压制敌方强光探头） */
  private updateQuantumGhosts(): void {
    // 先复位所有幽灵压制标记
    for (const obs of this.observers) {
      obs.suppressedByGhost = false;
    }

    for (const ent of this.entities) {
      if (!ent.quantumGhostOnly) continue;
      // 判定量子幽灵节点自身是否处于完全无人观测的暗区（忽略它自己正在压制的那个探头，防止正反馈抖动）
      const observed = this.observerSystem.isPointObservedExact(
        ent.x,
        ent.y,
        this.observers,
        this.walls,
        Boolean(this.level.ambientObserved),
        ent.suppressObserverId
      );
      const wasActive = ent.ghostActive;
      ent.ghostActive = !observed;

      if (ent.ghostActive && ent.suppressObserverId) {
        const targetObs = this.observers.find((o) => o.id === ent.suppressObserverId);
        if (targetObs) {
          targetObs.suppressedByGhost = true;
          if (!wasActive) {
            this.addLog(
              `量子幽灵「${ent.name}」在无观测暗区显化，已压制「${targetObs.name}」！`,
              'highlight'
            );
            this.callbacks.onToast?.(
              `无观测量子态显化：「${ent.name}」已压制敌方强光探照灯！`
            );
          }
        }
      }
    }
  }

  private refreshObservationAndGhosts(): void {
    // 第一轮先根据现行光锥判断幽灵是否被照亮
    this.observerSystem.update(
      this.observers,
      this.walls,
      this.devices,
      this.elapsedTime,
      Boolean(this.level.ambientObserved)
    );
    this.updateQuantumGhosts();
    // 第二轮应用幽灵压制后的最终视锥结果
    this.observerSystem.update(
      this.observers,
      this.walls,
      this.devices,
      this.elapsedTime,
      Boolean(this.level.ambientObserved)
    );
  }

  public step(dt = FIXED_DT): void {
    this.updateEffects(dt);

    if (this.paused || this.status !== 'playing') {
      this.refreshObservationAndGhosts();
      return;
    }

    this.elapsedTime += dt;

    // 1. 更新量子幽灵压制与全部观测光锥
    this.refreshObservationAndGhosts();

    // 2. 更新装置脉动与穿透反馈计时
    for (const d of this.devices) {
      if (d.pulseTimer > 0) d.pulseTimer = Math.max(0, d.pulseTimer - dt);
    }
    for (const ent of this.entities) {
      if (ent.phasePassTimer > 0) ent.phasePassTimer = Math.max(0, ent.phasePassTimer - dt);
    }

    // 3. 推进所有活跃宏电子
    for (const e of this.electrons) {
      if (!e.alive) continue;
      if (e.mode === 'classical') {
        this.stepClassicalElectron(e, dt);
      } else {
        this.stepCloudElectron(e, dt);
      }
    }

    // 4. 检测双球共鸣 / 宏聚变（Macro-Fusion）
    if (this.level.macroFusionEnabled || this.level.isSandbox) {
      this.checkMacroFusion();
    }

    // 清理已彻底死亡的旧宏电子引擎（保留少量历史）
    for (const e of this.electrons) {
      if (!e.alive) {
        this.collapseEngines.delete(e.id);
      }
    }
    if (this.electrons.length > 6) {
      this.electrons = this.electrons.filter((e) => e.alive);
    }

    // 5. 胜负状态裁决
    this.evaluateMissionStatus();
  }

  private checkMacroFusion(): void {
    const aliveClassical = this.electrons.filter((e) => e.alive && e.mode === 'classical');
    if (aliveClassical.length < 2) return;

    for (let i = 0; i < aliveClassical.length; i++) {
      for (let j = i + 1; j < aliveClassical.length; j++) {
        const a = aliveClassical[i];
        const b = aliveClassical[j];
        if (!a.alive || !b.alive) continue;
        // 至少飞行一小段距离后才允许融合，避免在发射口刚射出就自爆
        if (a.trail.length < 8 || b.trail.length < 8) continue;

        if (dist(a.x, a.y, b.x, b.y) <= MACRO_FUSION_TRIGGER_DIST) {
          this.triggerMacroFusion(a, b);
          return;
        }
      }
    }
  }

  private triggerMacroFusion(a: MacroElectronState, b: MacroElectronState): void {
    const cx = (a.x + b.x) * 0.5;
    const cy = (a.y + b.y) * 0.5;
    const specs: SpectrumType[] = Array.from(new Set([a.spectrum, b.spectrum]));

    a.alive = false;
    b.alive = false;
    this.collapseEngines.delete(a.id);
    this.collapseEngines.delete(b.id);

    this.pushFx({
      kind: 'macro_fusion',
      x: cx,
      y: cy,
      color: SPECTRUM_META[a.spectrum].color,
      secondaryColor: SPECTRUM_META[b.spectrum].color,
      radius: MACRO_FUSION_PULSE_RADIUS,
      duration: 1.05,
      label: `宏聚变脉冲 [${specs.map((s) => SPECTRUM_META[s].symbol).join('+')}]`,
    });

    this.addLog(
      `双球耦合触发【宏聚变】！半径 ${MACRO_FUSION_PULSE_RADIUS}px 无视墙体共振清零！`,
      'success'
    );
    this.callbacks.onMacroFusion?.();
    this.callbacks.onToast?.('宏聚变触发！隔墙共振脉冲瞬间抹除覆盖区目标！');

    // 抹除脉冲半径内的所有匹配钢制重门
    if (specs.includes('delta')) {
      for (const w of this.walls) {
        if (w.destroyed || w.kind !== 'steel_door') continue;
        const wx = w.x + w.w * 0.5;
        const wy = w.y + w.h * 0.5;
        if (dist(cx, cy, wx, wy) <= MACRO_FUSION_PULSE_RADIUS) {
          w.destroyed = true;
          this.addLog(`宏聚变脉冲隔墙气化「${w.label ?? '钢制重门'}」`, 'success');
        }
      }
    }

    // 抹除脉冲半径内所有匹配频段的实体材质层（无视混凝土墙体阻挡！）
    for (const ent of this.entities) {
      if (ent.destroyed || ent.quantumGhostOnly) continue;
      if (dist(cx, cy, ent.x, ent.y) <= MACRO_FUSION_PULSE_RADIUS + ent.radius * 0.5) {
        for (const s of specs) {
          if (ent.remainingMaterials.includes(s)) {
            this.applyMaterialRemoval(ent, s);
          }
        }
      }
    }

    this.refreshObservationAndGhosts();
  }

  private updateEffects(dt: number): void {
    for (let i = this.fxEvents.length - 1; i >= 0; i--) {
      this.fxEvents[i].age += dt;
      if (this.fxEvents[i].age >= this.fxEvents[i].duration) {
        this.fxEvents.splice(i, 1);
      }
    }
  }

  private pushFx(fx: Omit<FxEvent, 'id' | 'age'>): void {
    this.fxEvents.push({ ...fx, id: this.nextId++, age: 0 });
  }

  private stepClassicalElectron(e: MacroElectronState, dt: number): void {
    if (!this.isPointObserved(e.x, e.y)) {
      e.mode = 'cloud';
      e.cloudAge = 0;
      const eng = this.collapseEngines.get(e.id) ?? new CollapseEngine();
      this.collapseEngines.set(e.id, eng);
      eng.seedFromClassical(e);
      this.addLog('宏电子脱离所有观测光锥 → 进入量子概率云叠加态（可穿墙隧穿）', 'highlight');
      this.callbacks.onModeChange?.('cloud');
      this.callbacks.onToast?.('进入无观测盲区：已转化为量子概率云，正在穿透实体障碍！');
      return;
    }

    const prevX = e.x;
    const prevY = e.y;

    const emRes = applyEMForces(e, this.devices, dt);
    if (emRes.chargedDevice) {
      emRes.chargedDevice.pulseTimer = 0.65;
      this.pushFx({
        kind: 'charge_arc',
        x: e.x,
        y: e.y,
        fromX: emRes.chargedDevice.x,
        fromY: emRes.chargedDevice.y,
        color: '#00E5FF',
        radius: 36,
        duration: 0.45,
        label: '+38% 续能',
      });
      this.addLog('高压引雷针发生过载共振：宏电子能量寿命 +38%', 'highlight');
      this.callbacks.onCharge?.();
    }

    const nextX = e.x + e.vx * dt;
    const nextY = e.y + e.vy * dt;

    if (nextX < 6 || nextX > WORLD_WIDTH - 6 || nextY < 6 || nextY > WORLD_HEIGHT - 6) {
      this.fizzleElectron(
        e,
        clamp(nextX, 8, WORLD_WIDTH - 8),
        clamp(nextY, 8, WORLD_HEIGHT - 8),
        '宏电子逸出实验场边界退激'
      );
      return;
    }

    let closestWall: WallState | null = null;
    let closestT = Infinity;
    for (const w of this.walls) {
      if (!wallBlocksClassical(w)) continue;
      const t = segmentRectHit(prevX, prevY, nextX, nextY, w.x, w.y, w.w, w.h, 6);
      if (t !== null && t < closestT) {
        closestT = t;
        closestWall = w;
      }
    }

    if (closestWall) {
      const hx = prevX + (nextX - prevX) * closestT;
      const hy = prevY + (nextY - prevY) * closestT;

      // 导电金属壁：镜像电磁吸附，平滑贴壁切向滑行！
      if (closestWall.kind === 'metal_rail') {
        const slid = computeMetalRailSlide(hx, hy, e.vx, e.vy, e.speed, closestWall);
        e.x = slid.x;
        e.y = slid.y;
        e.vx = slid.vx;
        e.vy = slid.vy;
        e.trail.push({ x: e.x, y: e.y });
        if (e.trail.length > 70) e.trail.shift();
        e.stability -= CLASSICAL_DECAY_PER_SEC * dt;
        return;
      }

      if (closestWall.kind === 'steel_door' && e.spectrum === 'delta') {
        this.destroySteelDoor(closestWall, e);
        return;
      }

      const msg =
        closestWall.kind === 'steel_door'
          ? '钢制重门阻挡了非 δ 频段宏电子（请切换至 δ 金属频段气化钢门）'
          : !this.level.ambientObserved
          ? '实体屏障阻挡了经典态球状闪电！提示：关闭观测或用遮蔽幕切出盲区以量子穿墙。'
          : '球状闪电撞击混凝土屏障退激消散（尝试使用磁偏转器或利用金属导流壁）';
      this.fizzleElectron(e, hx, hy, msg);
      return;
    }

    e.x = nextX;
    e.y = nextY;
    e.trail.push({ x: e.x, y: e.y });
    if (e.trail.length > 70) e.trail.shift();

    for (const ent of this.entities) {
      if (ent.destroyed || ent.quantumGhostOnly) continue;
      const d = dist(e.x, e.y, ent.x, ent.y);
      if (d <= ent.radius + 7) {
        if (ent.remainingMaterials.includes(e.spectrum)) {
          this.triggerEntityResonance(ent, e);
          return;
        } else {
          if (!e.passedEntityIds.has(ent.id)) {
            e.passedEntityIds.add(ent.id);
            ent.phasePassTimer = 0.8;
            this.pushFx({
              kind: 'phase_pass',
              x: ent.x,
              y: ent.y,
              color: SPECTRUM_META[e.spectrum].color,
              radius: ent.radius + 14,
              duration: 0.65,
              label: `无共振穿透 (${SPECTRUM_META[e.spectrum].symbol})`,
            });
            this.addLog(
              `[${SPECTRUM_META[e.spectrum].symbol}] 宏电子无害穿透「${ent.name}」（频段不匹配）`
            );
          }
        }
      }
    }

    e.stability -= CLASSICAL_DECAY_PER_SEC * dt;
    if (e.stability <= 0) {
      this.fizzleElectron(e, e.x, e.y, '激发态寿命耗尽，宏电子退激回归基态');
    }
  }

  private stepCloudElectron(e: MacroElectronState, dt: number): void {
    const eng = this.collapseEngines.get(e.id);
    if (!eng) return;

    eng.stepDiffusion(e, this.observerSystem, this.walls, dt);
    e.stability -= CLOUD_DECAY_PER_SEC * dt;

    if (e.stability <= 0) {
      e.alive = false;
      eng.clear();
      this.addLog('概率云能量耗尽，未曾观测即悄然退激', 'warn');
      this.callbacks.onFizzle?.();
      this.callbacks.onToast?.('概率云在坍缩前能量耗尽，请在覆及目标后及时开启观测源！', true);
      return;
    }

    this.tryCollapseCloud(e);
  }

  private tryCollapseCloud(e: MacroElectronState): void {
    if (!e.alive || e.mode !== 'cloud') return;
    const eng = this.collapseEngines.get(e.id);
    if (!eng) return;

    const outcome = eng.evaluateCollapse(
      e,
      this.observerSystem,
      this.entities,
      this.walls
    );
    if (!outcome || !outcome.collapsed) return;

    this.pushFx({
      kind: 'collapse_implosion',
      x: outcome.x,
      y: outcome.y,
      color: SPECTRUM_META[e.spectrum].color,
      radius: 130,
      duration: 0.6,
      label: '波函数坍缩 Ψ→1',
    });

    eng.clear();
    e.mode = 'classical';
    e.x = outcome.x;
    e.y = outcome.y;
    e.vx = outcome.vx;
    e.vy = outcome.vy;
    e.trail = [{ x: e.x, y: e.y }];

    const hitTarget = Boolean(outcome.targetEntity || outcome.targetWall);
    this.callbacks.onCollapse?.(outcome.x, outcome.y, hitTarget);
    this.callbacks.onModeChange?.('classical');

    if (outcome.targetEntity) {
      this.addLog(`波函数在「${outcome.targetEntity.name}」核心定向坍缩！`, 'success');
      this.triggerEntityResonance(outcome.targetEntity, e);
    } else if (outcome.targetWall) {
      this.addLog('波函数在钢制重门处坍缩！', 'success');
      this.destroySteelDoor(outcome.targetWall, e);
    } else {
      this.addLog('概率云被观测光锥捕获，坍缩恢复为经典粒子态', 'highlight');
    }
  }

  private destroySteelDoor(wall: WallState, e: MacroElectronState): void {
    wall.destroyed = true;
    e.alive = false;
    const cx = wall.x + wall.w * 0.5;
    const cy = wall.y + wall.h * 0.5;
    this.pushFx({
      kind: 'selective_vaporize',
      x: cx,
      y: cy,
      color: SPECTRUM_META.delta.color,
      radius: 56,
      duration: 0.7,
      label: 'δ 钢门气化',
    });
    this.addLog(`δ 频段精准气化「${wall.label ?? '钢制重门'}」，物理通路已开启！`, 'success');
    this.callbacks.onVaporize?.('delta', false);
    this.callbacks.onToast?.('钢制重门已被 δ 频段选择性气化，通道开启！');
    this.refreshObservationAndGhosts();
  }

  private triggerEntityResonance(ent: EntityState, e: MacroElectronState): void {
    const spec = e.spectrum;
    e.alive = false;
    const isSecondaryBlast = this.applyMaterialRemoval(ent, spec);
    this.callbacks.onVaporize?.(spec, isSecondaryBlast);
  }

  private applyMaterialRemoval(ent: EntityState, spec: SpectrumType): boolean {
    ent.remainingMaterials = ent.remainingMaterials.filter((m) => m !== spec);

    this.pushFx({
      kind: 'selective_vaporize',
      x: ent.x,
      y: ent.y,
      color: SPECTRUM_META[spec].color,
      radius: ent.radius + 36,
      duration: 0.75,
      label: `${SPECTRUM_META[spec].symbol} 选择性抹除`,
    });

    if (ent.remainingMaterials.length === 0) {
      ent.destroyed = true;
      ent.disabled = true;
    } else if (
      ent.requiredDestroyLayers?.length &&
      ent.requiredDestroyLayers.every((req) => !ent.remainingMaterials.includes(req))
    ) {
      ent.disabled = true;
    }

    // 若为敌方监控探头实体，烧毁其 α 芯片后永久关闭对应的敌方观测光锥！
    if (spec === 'alpha' && ent.linkedObserverId) {
      const linkedObs = this.observers.find((o) => o.id === ent.linkedObserverId);
      if (linkedObs) {
        linkedObs.permanentlyDisabled = true;
        linkedObs.active = false;
        this.addLog(
          `监控主控「${ent.name}」已被烧毁，「${linkedObs.name}」永久失效 → 暗区已生成！`,
          'success'
        );
        this.callbacks.onToast?.(`敌方「${linkedObs.name}」已被瘫痪，区域转入盲区！`);
        this.refreshObservationAndGhosts();
      }
    } else {
      this.addLog(
        `[${SPECTRUM_META[spec].symbol}] 精准抹除「${ent.name}」的 ${SPECTRUM_META[spec].shortName} 层！`,
        ent.isProtected ? 'warn' : 'success'
      );
    }

    const isSecondaryBlast = spec === 'beta' && (ent.blastRadius ?? 0) > 0;
    if (isSecondaryBlast) {
      this.triggerSecondaryBlast(ent);
    }
    return isSecondaryBlast;
  }

  private triggerSecondaryBlast(source: EntityState): void {
    const r = source.blastRadius ?? 100;
    source.blastTriggered = true;
    source.destroyed = true;
    source.remainingMaterials = [];

    this.pushFx({
      kind: 'secondary_blast',
      x: source.x,
      y: source.y,
      color: '#FF5722',
      radius: r,
      duration: 0.9,
      label: 'β 次生殉爆!',
    });
    this.addLog(`警告：「${source.name}」触发半径 ${r}px 次生热爆！`, 'warn');

    // 支持连锁殉爆（若波及另一个含 beta 燃料桶，继续触发次生爆炸！）
    for (const other of this.entities) {
      if (other.id === source.id || other.destroyed || other.quantumGhostOnly) continue;
      if (dist(source.x, source.y, other.x, other.y) <= r + other.radius * 0.4) {
        const shouldChain = other.remainingMaterials.includes('beta') && (other.blastRadius ?? 0) > 0;
        other.destroyed = true;
        other.disabled = true;
        other.remainingMaterials = [];
        this.addLog(`「${other.name}」被次生殉爆波及损毁！`, other.isProtected ? 'warn' : 'highlight');
        if (shouldChain && !other.blastTriggered) {
          this.triggerSecondaryBlast(other);
        }
      }
    }
  }

  private fizzleElectron(e: MacroElectronState, x: number, y: number, reason: string): void {
    e.alive = false;
    e.x = x;
    e.y = y;
    this.pushFx({
      kind: 'wall_fizzle',
      x,
      y,
      color: SPECTRUM_META[e.spectrum].color,
      radius: 26,
      duration: 0.45,
    });
    this.addLog(reason, 'warn');
    this.callbacks.onFizzle?.();
    this.callbacks.onToast?.(reason, true);
  }

  public getObjectiveStates(): {
    id: string;
    text: string;
    kind: 'destroy_layer' | 'protect';
    done: boolean;
    violated: boolean;
  }[] {
    return this.level.objectives.map((obj) => {
      const ent = this.entities.find((e) => e.id === obj.entityId);
      if (!ent) {
        return { id: obj.id, text: obj.text, kind: obj.kind, done: false, violated: false };
      }
      if (obj.kind === 'protect') {
        const violated = ent.destroyed || ent.remainingMaterials.length < ent.materials.length;
        return { id: obj.id, text: obj.text, kind: obj.kind, done: !violated, violated };
      } else {
        const layerGone = obj.layer
          ? !ent.remainingMaterials.includes(obj.layer)
          : ent.destroyed;
        return { id: obj.id, text: obj.text, kind: obj.kind, done: layerGone, violated: false };
      }
    });
  }

  private evaluateMissionStatus(): void {
    if (this.level.isSandbox || this.status !== 'playing') return;

    const states = this.getObjectiveStates();

    const violated = states.find((s) => s.violated);
    if (violated) {
      this.status = 'failed';
      this.statusReason = `违反实验约束：${violated.text}。请重新规划频段或轨迹避免误伤。`;
      this.addLog(`实验中止：${violated.text}`, 'warn');
      return;
    }

    const destroyGoals = states.filter((s) => s.kind === 'destroy_layer');
    if (destroyGoals.length > 0 && destroyGoals.every((g) => g.done)) {
      this.status = 'victory';
      this.statusReason = '全部物理实验目标均已精准达成，零附带损伤。';
      this.addLog('实验成功：所有战术目标均已达成！', 'success');
      return;
    }

    if (this.remainingAmmo === 0 && this.activeElectronCount === 0) {
      this.status = 'failed';
      this.statusReason = '可用宏电子已全部消耗完毕，仍未完成目标。按 R 键重置并重新推演。';
      this.addLog('实验失败：宏电子耗尽。', 'warn');
    }
  }
}

export function getGridDimensions(): { cols: number; rows: number; cell: number } {
  return { cols: GRID_COLS, rows: GRID_ROWS, cell: GRID_CELL };
}
