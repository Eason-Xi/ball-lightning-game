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
  public inventory = { deflector: 0, attractor: 0 };

  public electron: MacroElectronState | null = null;
  public observerSystem = new ObserverSystem();
  public collapseEngine = new CollapseEngine();

  public fxEvents: FxEvent[] = [];
  public logs: SimLogEntry[] = [];

  public elapsedTime = 0;
  public paused = true;
  public status: MissionStatus = 'playing';
  public statusReason = '';
  public playerObserversEnabled = true;

  private nextId = 1;
  private callbacks: SimEventCallbacks;

  constructor(level: LevelSpec, callbacks: SimEventCallbacks = {}) {
    this.callbacks = callbacks;
    this.loadLevel(level);
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
    }));
    this.devices = level.devices.map((d) => ({ ...d, pulseTimer: 0 }));
    this.observers = level.observers.map((o) => ({
      ...o,
      sweep: o.sweep ? { ...o.sweep } : undefined,
      polygon: [],
    }));

    this.emitterX = level.emitter.x;
    this.emitterY = level.emitter.y;
    this.emitterAngle = level.emitter.angleRad;
    this.selectedSpectrum = level.defaultSpectrum;
    this.remainingAmmo = level.ammo;
    this.inventory = { ...level.inventory };

    this.electron = null;
    this.collapseEngine.clear();
    this.fxEvents = [];
    this.logs = [];
    this.elapsedTime = 0;
    this.paused = true;
    this.status = 'playing';
    this.statusReason = '';

    // 同步己方观测初始开关状态
    const anyPlayerObsActive = this.observers.some(
      (o) => o.owner === 'player' && o.active
    );
    this.playerObserversEnabled = anyPlayerObsActive || Boolean(level.ambientObserved);

    this.observerSystem.update(
      this.observers,
      this.walls,
      this.elapsedTime,
      Boolean(this.level.ambientObserved)
    );

    this.addLog(`实验 [${level.code}] ${level.title} 已载入。`, 'highlight');
  }

  public addLog(
    text: string,
    level: SimLogEntry['level'] = 'info'
  ): void {
    this.logs.unshift({
      time: this.elapsedTime,
      text,
      level,
    });
    if (this.logs.length > 40) this.logs.length = 40;
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

  /** 一键开关所有己方主动观测源（主动观测信标 + 发射器近场灯） */
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
    this.observerSystem.update(
      this.observers,
      this.walls,
      this.elapsedTime,
      false
    );
    this.callbacks.onObserverToggle?.(active);
    this.addLog(
      active ? '己方主动观测源已开启：波函数锁定激活' : '己方主动观测源已切断：暗区进入量子叠加态',
      active ? 'highlight' : 'info'
    );

    // 即使在时停时手动开灯，若当前处于概率云中，在下一运行帧立即判定坍缩；若在实时模式立刻检测
    if (active && this.electron && this.electron.alive && this.electron.mode === 'cloud') {
      this.tryCollapseCloud();
    }
  }

  /** 单独切换场景中的某一个己方观测源 */
  public toggleSingleObserver(observerId: string): boolean {
    const obs = this.observers.find((o) => o.id === observerId && o.owner === 'player');
    if (!obs) return false;
    obs.active = !obs.active;
    this.playerObserversEnabled = this.observers.some(
      (o) => o.owner === 'player' && o.active
    );
    this.observerSystem.update(
      this.observers,
      this.walls,
      this.elapsedTime,
      Boolean(this.level.ambientObserved)
    );
    this.callbacks.onObserverToggle?.(obs.active);
    this.addLog(
      `${obs.name} → ${obs.active ? '开启观测' : '关闭观测'}`,
      obs.active ? 'highlight' : 'info'
    );
    if (obs.active && this.electron && this.electron.alive && this.electron.mode === 'cloud') {
      this.tryCollapseCloud();
    }
    return true;
  }

  public placeDevice(kind: DeviceKind, x: number, y: number, angleRad = 0): DeviceState | null {
    if (this.inventory[kind] <= 0 && !this.level.isSandbox) return null;
    if (x < 30 || x > WORLD_WIDTH - 30 || y < 30 || y > WORLD_HEIGHT - 30) return null;

    // 不允许直接放进墙体内部
    for (const w of this.walls) {
      if (!w.destroyed && pointInRect(x, y, w.x, w.y, w.w, w.h, 12)) {
        this.callbacks.onToast?.('无法将电磁装置嵌入实墙内部。', true);
        return null;
      }
    }

    if (!this.level.isSandbox) {
      this.inventory[kind] -= 1;
    }

    const dev: DeviceState = {
      id: `dev_${this.nextId++}`,
      kind,
      x,
      y,
      angleRad,
      radius: kind === 'deflector' ? 76 : 108,
      fixed: false,
      pulseTimer: 0,
    };
    this.devices.push(dev);
    this.addLog(
      `已部署 ${kind === 'deflector' ? '超导磁偏转器' : '高压引雷针'} (${Math.round(x)}, ${Math.round(y)})`
    );
    return dev;
  }

  public removeDevice(deviceId: string): boolean {
    const idx = this.devices.findIndex((d) => d.id === deviceId && !d.fixed);
    if (idx < 0) return false;
    const [removed] = this.devices.splice(idx, 1);
    if (!this.level.isSandbox) {
      this.inventory[removed.kind] += 1;
    }
    this.addLog(`已回收 ${removed.kind === 'deflector' ? '超导磁偏转器' : '高压引雷针'}`);
    return true;
  }

  public moveDevice(deviceId: string, x: number, y: number): void {
    const dev = this.devices.find((d) => d.id === deviceId && !d.fixed);
    if (!dev) return;
    const nx = clamp(x, 30, WORLD_WIDTH - 30);
    const ny = clamp(y, 30, WORLD_HEIGHT - 30);
    for (const w of this.walls) {
      if (!w.destroyed && pointInRect(nx, ny, w.x, w.y, w.w, w.h, 10)) {
        return;
      }
    }
    dev.x = nx;
    dev.y = ny;
  }

  public rotateDevice(deviceId: string, angleRad: number): void {
    const dev = this.devices.find((d) => d.id === deviceId && !d.fixed && d.kind === 'deflector');
    if (!dev) return;
    dev.angleRad = angleRad;
  }

  /** 从发生器激发一颗新的球状闪电 */
  public launchElectron(): boolean {
    if (this.status !== 'playing') return false;
    if (this.electron && this.electron.alive) {
      this.callbacks.onToast?.('当前场内已存在一颗活跃宏电子，请等待其坍缩或退激。', true);
      return false;
    }
    if (this.remainingAmmo === 0) {
      this.callbacks.onToast?.('可用宏电子已耗尽，按 R 重置实验。', true);
      return false;
    }

    if (this.remainingAmmo > 0) {
      this.remainingAmmo -= 1;
    }

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

    this.electron = e;
    this.collapseEngine.clear();
    if (e.mode === 'cloud') {
      this.collapseEngine.seedFromClassical(e);
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

  /** 获取当前关卡主要目标区域的最大概率幅 Ψ (用于 HUD 遥测提示) */
  public getTargetMaxPsi(): number {
    if (!this.electron || !this.electron.alive || this.electron.mode !== 'cloud') {
      return 0;
    }
    let best = 0;
    for (const ent of this.entities) {
      if (ent.destroyed || !ent.requiredDestroyLayers?.length) continue;
      const v = this.collapseEngine.sampleMaxPsiAround(ent.x, ent.y, ent.radius + 10);
      if (v > best) best = v;
    }
    return best;
  }

  /** 推进一个固定物理步长 (dt = 1/60s) */
  public step(dt = FIXED_DT): void {
    // 更新视觉特效衰减（即使暂停后也保留少量收尾）
    this.updateEffects(dt);

    if (this.paused || this.status !== 'playing') {
      // 暂停状态下仍保持观测多边形同步（例如玩家手动开关灯）
      this.observerSystem.update(
        this.observers,
        this.walls,
        this.elapsedTime,
        Boolean(this.level.ambientObserved)
      );
      return;
    }

    this.elapsedTime += dt;

    // 1. 更新所有观测源视锥和网格掩码
    this.observerSystem.update(
      this.observers,
      this.walls,
      this.elapsedTime,
      Boolean(this.level.ambientObserved)
    );

    // 2. 更新电磁装置脉动与实体提示计时
    for (const d of this.devices) {
      if (d.pulseTimer > 0) d.pulseTimer = Math.max(0, d.pulseTimer - dt);
    }
    for (const ent of this.entities) {
      if (ent.phasePassTimer > 0) ent.phasePassTimer = Math.max(0, ent.phasePassTimer - dt);
    }

    // 3. 推进球状闪电模拟
    if (this.electron && this.electron.alive) {
      if (this.electron.mode === 'classical') {
        this.stepClassicalElectron(this.electron, dt);
      } else {
        this.stepCloudElectron(this.electron, dt);
      }
    }

    // 4. 胜负状态判定
    this.evaluateMissionStatus();
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
    this.fxEvents.push({
      ...fx,
      id: this.nextId++,
      age: 0,
    });
  }

  private stepClassicalElectron(e: MacroElectronState, dt: number): void {
    // 观察者效应检测：离开所有观测源即刻退化为概率云！
    if (!this.isPointObserved(e.x, e.y)) {
      e.mode = 'cloud';
      e.cloudAge = 0;
      this.collapseEngine.seedFromClassical(e);
      this.addLog('宏电子脱离所有观测光锥 → 进入量子概率云叠加态（可穿墙隧穿）', 'highlight');
      this.callbacks.onModeChange?.('cloud');
      this.callbacks.onToast?.('进入无观测盲区：已转化为量子概率云，正在穿透实体障碍！');
      return;
    }

    const prevX = e.x;
    const prevY = e.y;

    // 电磁力场导向与充能
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

    // 场景边界检查
    if (nextX < 6 || nextX > WORLD_WIDTH - 6 || nextY < 6 || nextY > WORLD_HEIGHT - 6) {
      this.fizzleElectron(e, clamp(nextX, 8, WORLD_WIDTH - 8), clamp(nextY, 8, WORLD_HEIGHT - 8), '宏电子逸出实验场边界退激');
      return;
    }

    // 墙体与钢制重门连续碰撞检查
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
      if (closestWall.kind === 'steel_door' && e.spectrum === 'delta') {
        this.destroySteelDoor(closestWall, e);
        return;
      } else {
        const msg =
          closestWall.kind === 'steel_door'
            ? '钢制重门阻挡了非 δ 频段宏电子（请切换至 δ 金属频段气化钢门）'
            : !this.level.ambientObserved
            ? '实体屏障阻挡了经典态球状闪电！提示：关闭观测进入盲区以量子穿墙。'
            : '球状闪电撞击混凝土屏障退激消散（尝试布置超导磁偏转器绕过障碍）';
        this.fizzleElectron(e, hx, hy, msg);
        return;
      }
    }

    // 移动并记录轨迹
    e.x = nextX;
    e.y = nextY;
    e.trail.push({ x: e.x, y: e.y });
    if (e.trail.length > 65) e.trail.shift();

    // 实体交互检测（选择性频谱共振）
    for (const ent of this.entities) {
      if (ent.destroyed || ent.quantumGhostOnly) continue;
      const d = dist(e.x, e.y, ent.x, ent.y);
      if (d <= ent.radius + 7) {
        if (ent.remainingMaterials.includes(e.spectrum)) {
          this.triggerEntityResonance(ent, e);
          return;
        } else {
          // 异频无害穿透！原著最核心奇观
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

    // 自然寿命衰减
    e.stability -= CLASSICAL_DECAY_PER_SEC * dt;
    if (e.stability <= 0) {
      this.fizzleElectron(e, e.x, e.y, '激发态寿命耗尽，宏电子退激回归基态');
    }
  }

  private stepCloudElectron(e: MacroElectronState, dt: number): void {
    this.collapseEngine.stepDiffusion(e, this.observerSystem, this.walls, dt);

    e.stability -= CLOUD_DECAY_PER_SEC * dt;
    if (e.stability <= 0) {
      e.alive = false;
      this.collapseEngine.clear();
      this.addLog('概率云能量耗尽，未曾观测即悄然退激', 'warn');
      this.callbacks.onFizzle?.();
      this.callbacks.onToast?.('概率云在坍缩前能量耗尽，请在覆及目标后及时开启观测源！', true);
      return;
    }

    this.tryCollapseCloud();
  }

  private tryCollapseCloud(): void {
    const e = this.electron;
    if (!e || !e.alive || e.mode !== 'cloud') return;

    const outcome = this.collapseEngine.evaluateCollapse(
      e,
      this.observerSystem,
      this.entities,
      this.walls
    );

    if (!outcome || !outcome.collapsed) return;

    // 触发剧烈的波函数坍缩内爆特效
    this.pushFx({
      kind: 'collapse_implosion',
      x: outcome.x,
      y: outcome.y,
      color: SPECTRUM_META[e.spectrum].color,
      radius: 130,
      duration: 0.6,
      label: '波函数坍缩 Ψ→1',
    });

    this.collapseEngine.clear();
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
      this.addLog(
        `波函数在「${outcome.targetEntity.name}」核心定向坍缩！`,
        'success'
      );
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
    // 门毁后立即更新观测多边形（不再挡光）
    this.observerSystem.update(
      this.observers,
      this.walls,
      this.elapsedTime,
      Boolean(this.level.ambientObserved)
    );
  }

  private triggerEntityResonance(ent: EntityState, e: MacroElectronState): void {
    const spec = e.spectrum;
    e.alive = false;

    // 仅移除匹配的频段材质层！
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

    // 若为单一材质且清空，实体完全毁灭；若为复合目标（如导弹车），移除 alpha 层即判定火控瘫痪
    if (ent.remainingMaterials.length === 0) {
      ent.destroyed = true;
      ent.disabled = true;
    } else if (ent.requiredDestroyLayers?.every((req) => !ent.remainingMaterials.includes(req))) {
      ent.disabled = true;
    }

    const isSecondaryBlast = spec === 'beta' && (ent.blastRadius ?? 0) > 0;

    this.addLog(
      `[${SPECTRUM_META[spec].symbol}] 精准抹除「${ent.name}」的 ${SPECTRUM_META[spec].shortName} 层！`,
      ent.isProtected ? 'warn' : 'success'
    );
    this.callbacks.onVaporize?.(spec, isSecondaryBlast);

    if (isSecondaryBlast) {
      this.triggerSecondaryBlast(ent);
    }
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

    // 波及范围内所有实体（无差别热爆伤害，反衬选择性毁灭的珍贵）
    for (const other of this.entities) {
      if (other.id === source.id || other.destroyed || other.quantumGhostOnly) continue;
      if (dist(source.x, source.y, other.x, other.y) <= r + other.radius * 0.4) {
        other.destroyed = true;
        other.remainingMaterials = [];
        this.addLog(`「${other.name}」被次生殉爆波及损毁！`, 'warn');
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

  public getObjectiveStates(): { id: string; text: string; kind: 'destroy_layer' | 'protect'; done: boolean; violated: boolean }[] {
    return this.level.objectives.map((obj) => {
      const ent = this.entities.find((e) => e.id === obj.entityId);
      if (!ent) {
        return { id: obj.id, text: obj.text, kind: obj.kind, done: false, violated: false };
      }
      if (obj.kind === 'protect') {
        const violated = ent.destroyed || ent.remainingMaterials.length < ent.materials.length;
        return {
          id: obj.id,
          text: obj.text,
          kind: obj.kind,
          done: !violated,
          violated,
        };
      } else {
        const layerGone = obj.layer
          ? !ent.remainingMaterials.includes(obj.layer)
          : ent.destroyed;
        return {
          id: obj.id,
          text: obj.text,
          kind: obj.kind,
          done: layerGone,
          violated: false,
        };
      }
    });
  }

  private evaluateMissionStatus(): void {
    if (this.level.isSandbox || this.status !== 'playing') return;

    const states = this.getObjectiveStates();

    // 1. 先检查保护约束是否被破坏
    const violated = states.find((s) => s.violated);
    if (violated) {
      this.status = 'failed';
      this.statusReason = `违反实验约束：${violated.text}。请调整谐振频段避免次生误伤。`;
      this.addLog(`实验中止：${violated.text}`, 'warn');
      return;
    }

    // 2. 检查所有摧毁目标是否完成
    const destroyGoals = states.filter((s) => s.kind === 'destroy_layer');
    if (destroyGoals.length > 0 && destroyGoals.every((g) => g.done)) {
      this.status = 'victory';
      this.statusReason = '全部物理实验目标均已达成，零附带损伤。';
      this.addLog('实验成功：所有战术目标均已精准完成！', 'success');
      return;
    }

    // 3. 若无活跃宏电子且剩余弹药为 0，任务失败
    if (this.remainingAmmo === 0 && (!this.electron || !this.electron.alive)) {
      this.status = 'failed';
      this.statusReason = '可用宏电子已全部消耗完毕，仍未完成目标。按 R 键重置并重新规划方案。';
      this.addLog('实验失败：宏电子耗尽。', 'warn');
    }
  }
}

export function getGridDimensions(): { cols: number; rows: number; cell: number } {
  return { cols: GRID_COLS, rows: GRID_ROWS, cell: GRID_CELL };
}
