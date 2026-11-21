import {
  DeviceKind,
  DeviceState,
  EntityState,
  FxEvent,
  GRID_CELL,
  GRID_COLS,
  GRID_ROWS,
  MacroElectronState,
  ObserverState,
  SPECTRUM_META,
  SpectrumType,
  WallState,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../sim/types';
import { SimulationWorld } from '../sim/World';
import { predictTrajectory } from '../sim/EMFieldSolver';

export interface RenderUIState {
  blueprintMode: boolean;
  selectedDeviceId: string | null;
  placementTool: DeviceKind | null;
  mouseX: number;
  mouseY: number;
  isHoveringCanvas: boolean;
  visualTime: number;
}

/**
 * 冷冽精密的 90 年代军工实验室示波器 × 量子概率云干涉渲染器
 */
export class BlueprintRenderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法初始化 Canvas 2D 渲染上下文');
    }
    this.ctx = context;
  }

  public resizeToFit(maxW: number, maxH: number): number {
    const aspect = WORLD_WIDTH / WORLD_HEIGHT;
    let displayW = maxW;
    let displayH = displayW / aspect;
    if (displayH > maxH) {
      displayH = maxH;
      displayW = displayH * aspect;
    }
    displayW = Math.max(320, Math.floor(displayW));
    displayH = Math.max(200, Math.floor(displayH));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = `${displayW}px`;
    this.canvas.style.height = `${displayH}px`;
    this.canvas.width = Math.round(displayW * dpr);
    this.canvas.height = Math.round(displayH * dpr);

    const scale = (displayW * dpr) / WORLD_WIDTH;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return displayW / WORLD_WIDTH;
  }

  public render(world: SimulationWorld, ui: RenderUIState): void {
    const ctx = this.ctx;
    ctx.save();

    // 1. 深空蓝图基底 & 坐标点阵
    this.drawBackground(world, ui);

    // 2. 物理观测光锥多边形（真实视线遮挡与玻璃穿透视觉表现）
    this.drawObserverCones(world, ui.visualTime);

    // 3. 量子概率云干涉密度场（处于 cloud 模式时渲染）
    if (world.electron && world.electron.alive && world.electron.mode === 'cloud') {
      this.drawProbabilityCloud(world, world.electron, ui.visualTime);
    }

    // 4. 电磁场装置及其动态力线
    for (const dev of world.devices) {
      this.drawDevice(dev, ui.selectedDeviceId === dev.id, ui.visualTime);
    }

    // 5. 墙体（混凝土 / 防弹玻璃 / 钢制重门）
    for (const wall of world.walls) {
      this.drawWall(wall, ui.blueprintMode);
    }

    // 6. 实体目标与材质频段徽章（含仅暗区可见的蓝玫瑰量子幽灵）
    for (const ent of world.entities) {
      this.drawEntity(world, ent, ui.blueprintMode, ui.visualTime);
    }

    // 7. 观测源硬件节点（探照灯 / 主动观测信标）
    for (const obs of world.observers) {
      this.drawObserverHardware(obs, ui.visualTime);
    }

    // 8. 雷球发生器与瞄准预测轨道
    this.drawEmitterAndPrediction(world, ui);

    // 9. 活跃经典态球状闪电（双层等离子辉光 + 随机电弧）
    if (world.electron && world.electron.alive && world.electron.mode === 'classical') {
      this.drawClassicalElectron(world.electron, ui.visualTime);
    }

    // 10. 放置工具半透明预览
    if (ui.placementTool && ui.isHoveringCanvas) {
      this.drawPlacementGhost(ui.placementTool, ui.mouseX, ui.mouseY);
    }

    // 11. 瞬态物理特效（坍缩内爆、选择性气化、次生殉爆、充能电弧）
    for (const fx of world.fxEvents) {
      this.drawFx(fx);
    }

    // 12. 示波器四角刻度装饰
    this.drawReticleFrame(world);

    ctx.restore();
  }

  private drawBackground(world: SimulationWorld, ui: RenderUIState): void {
    const ctx = this.ctx;
    ctx.fillStyle = world.level.ambientObserved ? '#0a101b' : '#05070c';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // 蓝图坐标网格
    const major = 60;
    ctx.strokeStyle = ui.blueprintMode
      ? 'rgba(0, 229, 255, 0.11)'
      : 'rgba(130, 170, 220, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = major; x < WORLD_WIDTH; x += major) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = major; y < WORLD_HEIGHT; y += major) {
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
    }
    ctx.stroke();

    // 若为真实观测关卡，轻微标注暗区背景文字水印
    if (!world.level.ambientObserved) {
      ctx.save();
      ctx.font = '600 10px Menlo, monospace';
      ctx.fillStyle = 'rgba(110, 145, 190, 0.22)';
      ctx.fillText('DARK REGION // UNOBSERVED QUANTUM SUPERPOSITION FIELD', 20, WORLD_HEIGHT - 16);
      ctx.restore();
    }
  }

  private drawObserverCones(world: SimulationWorld, t: number): void {
    if (world.level.ambientObserved) return;
    const ctx = this.ctx;

    for (const obs of world.observers) {
      if (!obs.active || obs.polygon.length < 3) continue;

      const isPlayer = obs.owner === 'player';
      const grad = ctx.createRadialGradient(obs.x, obs.y, 10, obs.x, obs.y, obs.range);
      if (isPlayer) {
        grad.addColorStop(0, 'rgba(126, 231, 135, 0.24)');
        grad.addColorStop(0.55, 'rgba(126, 231, 135, 0.11)');
        grad.addColorStop(1, 'rgba(126, 231, 135, 0.02)');
      } else {
        grad.addColorStop(0, 'rgba(255, 120, 90, 0.26)');
        grad.addColorStop(0.6, 'rgba(255, 105, 80, 0.12)');
        grad.addColorStop(1, 'rgba(255, 90, 70, 0.02)');
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(obs.polygon[0].x, obs.polygon[0].y);
      for (let i = 1; i < obs.polygon.length; i++) {
        ctx.lineTo(obs.polygon[i].x, obs.polygon[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // 细微扫描光锥轮廓线
      ctx.strokeStyle = isPlayer
        ? `rgba(126, 231, 135, ${0.32 + Math.sin(t * 3) * 0.06})`
        : 'rgba(255, 110, 85, 0.36)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawProbabilityCloud(
    world: SimulationWorld,
    electron: MacroElectronState,
    t: number
  ): void {
    const ctx = this.ctx;
    const psi = world.collapseEngine.psi;
    const meta = SPECTRUM_META[electron.spectrum];

    ctx.save();
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      const row = gy * GRID_COLS;
      const cy = (gy + 0.5) * GRID_CELL;
      for (let gx = 0; gx < GRID_COLS; gx++) {
        const val = psi[row + gx];
        if (val < 0.03) continue;

        const cx = (gx + 0.5) * GRID_CELL;
        // 量子干涉条纹调制：正弦波纹赋予流动的薛定谔波函数质感
        const wave = 0.72 + 0.28 * Math.sin((gx * 0.65 + gy * 0.55) - t * 6.5);
        const alpha = Math.min(0.82, val * 0.75 * wave);

        ctx.fillStyle = hexToRgba(meta.color, alpha * 0.55);
        ctx.fillRect(gx * GRID_CELL, gy * GRID_CELL, GRID_CELL, GRID_CELL);

        // 局部概率峰值点闪烁粒子
        if (val > 0.22 && ((gx * 37 + gy * 17) % 5 === 0)) {
          const r = 1.6 + val * 2.2 * wave;
          ctx.fillStyle = hexToRgba('#ffffff', alpha * 0.75);
          ctx.beginPath();
          ctx.arc(
            cx + Math.sin(t * 5 + gx) * 2.2,
            cy + Math.cos(t * 4.2 + gy) * 2.2,
            r,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }
    }

    // 如果密室目标已经被概率云覆盖，在目标周围绘制醒目的“可坍缩锁定位相环”
    for (const ent of world.entities) {
      if (ent.destroyed || ent.quantumGhostOnly) continue;
      if (!ent.remainingMaterials.includes(electron.spectrum)) continue;
      const localPsi = world.collapseEngine.sampleMaxPsiAround(
        ent.x,
        ent.y,
        ent.radius + 8
      );
      if (localPsi >= 0.09) {
        const pulse = 1 + Math.sin(t * 10) * 0.08;
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(ent.x, ent.y, (ent.radius + 14) * pulse, t * 1.4, t * 1.4 + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '700 11px Menlo, monospace';
        ctx.fillStyle = meta.color;
        ctx.textAlign = 'center';
        ctx.fillText(
          `Ψ=${Math.round(localPsi * 100)}% [开启观测即可坍缩]`,
          ent.x,
          ent.y - ent.radius - 20
        );
      }
    }
    ctx.restore();
  }

  private drawDevice(dev: DeviceState, selected: boolean, t: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(dev.x, dev.y);

    const isDeflector = dev.kind === 'deflector';
    const baseColor = isDeflector ? '#38bdf8' : '#22d3ee';

    // 作用力场半径圈
    const ringGrad = ctx.createRadialGradient(0, 0, 8, 0, 0, dev.radius);
    ringGrad.addColorStop(0, isDeflector ? 'rgba(56, 189, 248, 0.16)' : 'rgba(34, 211, 238, 0.22)');
    ringGrad.addColorStop(1, 'rgba(56, 189, 248, 0.01)');
    ctx.fillStyle = ringGrad;
    ctx.beginPath();
    ctx.arc(0, 0, dev.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = selected ? '#ffffff' : hexToRgba(baseColor, 0.45);
    ctx.lineWidth = selected ? 1.8 : 1.1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, dev.radius, t * (isDeflector ? 0.4 : -0.6), t * (isDeflector ? 0.4 : -0.6) + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (isDeflector) {
      // 超导磁偏转器：方向磁力线与旋转操控手柄
      ctx.rotate(dev.angleRad);

      // 流线磁感箭头
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
      ctx.lineWidth = 1.4;
      for (const offset of [-22, 0, 22]) {
        ctx.beginPath();
        ctx.moveTo(-30, offset);
        ctx.lineTo(34, offset);
        ctx.stroke();
      }

      // 中心六边形磁环
      ctx.fillStyle = '#0d1b2a';
      ctx.strokeStyle = selected ? '#ffffff' : '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 导向主箭头
      ctx.strokeStyle = '#7dd3fc';
      ctx.fillStyle = '#e0f2fe';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(36, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(44, 0);
      ctx.lineTo(32, -7);
      ctx.lineTo(32, 7);
      ctx.closePath();
      ctx.fill();

      // 旋转拖动手柄圆点（可拖拽转向）
      if (!dev.fixed) {
        ctx.fillStyle = selected ? '#ffd600' : '#00e5ff';
        ctx.beginPath();
        ctx.arc(46, 0, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 高压引雷针（向心脉冲波 + 尖端电极）
      const pulsePhase = (t * 1.4) % 1;
      const inRadius = dev.radius * (1 - pulsePhase);
      ctx.strokeStyle = hexToRgba('#00e5ff', pulsePhase * 0.42);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, inRadius, 0, Math.PI * 2);
      ctx.stroke();

      // 核心电极座
      const chargeGlow = dev.pulseTimer > 0 ? 12 : 0;
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 10 + chargeGlow;
      ctx.fillStyle = '#091824';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 闪电符号
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.moveTo(2, -9);
      ctx.lineTo(-5, 1);
      ctx.lineTo(0, 1);
      ctx.lineTo(-2, 9);
      ctx.lineTo(6, -1);
      ctx.lineTo(1, -1);
      ctx.closePath();
      ctx.fill();

      ctx.font = '600 10px Menlo, monospace';
      ctx.fillStyle = '#7dd3fc';
      ctx.textAlign = 'center';
      ctx.fillText('高压引雷针 +38%', 0, 31);
    }

    ctx.restore();
  }

  private drawWall(wall: WallState, blueprintMode: boolean): void {
    const ctx = this.ctx;
    if (wall.destroyed) {
      // 已气化的钢门残留淡虚线框
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 214, 0, 0.28)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
      ctx.restore();
      return;
    }

    ctx.save();
    if (wall.kind === 'concrete') {
      ctx.fillStyle = '#182232';
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeStyle = '#334663';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);

      // 斜线结构纹理
      ctx.beginPath();
      ctx.rect(wall.x, wall.y, wall.w, wall.h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(148, 179, 219, 0.11)';
      ctx.lineWidth = 1;
      for (let i = -wall.h; i < wall.w + wall.h; i += 12) {
        ctx.moveTo(wall.x + i, wall.y);
        ctx.lineTo(wall.x + i - wall.h, wall.y + wall.h);
      }
      ctx.stroke();
    } else if (wall.kind === 'glass') {
      // 防弹玻璃：晶莹青蓝半透明，视觉上立刻暗示“挡球但透光”
      ctx.fillStyle = 'rgba(56, 189, 248, 0.24)';
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);

      // 玻璃反光条纹
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = wall.x + 14; x < wall.x + wall.w - 8; x += 26) {
        ctx.moveTo(x, wall.y + 4);
        ctx.lineTo(x - 8, wall.y + wall.h - 4);
      }
      ctx.stroke();
    } else if (wall.kind === 'steel_door') {
      // δ 钢制重门
      ctx.fillStyle = 'rgba(255, 214, 0, 0.16)';
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 2;
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);

      // 门锁横纹
      ctx.strokeStyle = 'rgba(255, 214, 0, 0.45)';
      ctx.beginPath();
      for (let y = wall.y + 12; y < wall.y + wall.h; y += 14) {
        ctx.moveTo(wall.x + 3, y);
        ctx.lineTo(wall.x + wall.w - 3, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    if (wall.label && (blueprintMode || wall.kind !== 'concrete')) {
      ctx.save();
      ctx.font = '600 10.5px Menlo, monospace';
      ctx.fillStyle =
        wall.kind === 'steel_door'
          ? '#ffd600'
          : wall.kind === 'glass'
          ? '#7dd3fc'
          : '#8ea1b8';
      ctx.textAlign = 'center';
      ctx.fillText(wall.label, wall.x + wall.w / 2, wall.y - 7);
      ctx.restore();
    }
  }

  private drawEntity(
    world: SimulationWorld,
    ent: EntityState,
    blueprintMode: boolean,
    t: number
  ): void {
    const ctx = this.ctx;

    // 量子蓝玫瑰特殊渲染：仅在完全无观测暗区悄然盛开，一照亮即消隐！
    if (ent.quantumGhostOnly) {
      const observed = world.isPointObserved(ent.x, ent.y);
      if (observed) return;
      this.drawQuantumRose(ent.x, ent.y, t);
      return;
    }

    ctx.save();
    ctx.translate(ent.x, ent.y);

    if (ent.destroyed) {
      // 已被选择性气化的空洞残影
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, ent.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 10px Menlo, monospace';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.textAlign = 'center';
      ctx.fillText('已气化', 0, 4);
      ctx.restore();
      return;
    }

    // 蓝图模式下若为 β 易爆体，画出危险次生爆炸半径虚线圈
    if ((blueprintMode || ent.role === 'fuel_drum') && ent.blastRadius && ent.remainingMaterials.includes('beta')) {
      ctx.strokeStyle = 'rgba(255, 87, 34, 0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, ent.blastRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 保护目标防护框
    if (ent.isProtected) {
      ctx.strokeStyle = 'rgba(126, 231, 135, 0.65)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, ent.radius + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 异频无害穿透光环反馈
    if (ent.phasePassTimer > 0) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${ent.phasePassTimer})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, ent.radius + 10 + (1 - ent.phasePassTimer) * 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 主体几何形态（不同角色清晰可辨）
    const primarySpec: SpectrumType = ent.remainingMaterials[0] ?? 'alpha';
    const strokeColor = ent.disabled
      ? '#64748b'
      : ent.isProtected
      ? '#7ee787'
      : SPECTRUM_META[primarySpec].color;

    ctx.fillStyle = '#0f1726';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.2;

    if (ent.role === 'server' || ent.role === 'jammer') {
      const r = ent.radius;
      ctx.beginPath();
      ctx.roundRect(-r, -r, r * 2, r * 2, 6);
      ctx.fill();
      ctx.stroke();
      // 芯片电路装饰
      ctx.strokeStyle = hexToRgba(strokeColor, 0.45);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
      // 呼吸指示灯
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(0, 0, 4 + Math.sin(t * 5) * 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (ent.role === 'missile_truck') {
      const r = ent.radius;
      ctx.beginPath();
      ctx.roundRect(-r * 1.1, -r * 0.78, r * 2.2, r * 1.56, 7);
      ctx.fill();
      ctx.stroke();
      // 导弹发射架线条
      ctx.strokeStyle = ent.disabled ? '#475569' : '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.65, -7);
      ctx.lineTo(r * 0.65, -7);
      ctx.moveTo(-r * 0.65, 7);
      ctx.lineTo(r * 0.65, 7);
      ctx.stroke();
    } else if (ent.role === 'fuel_drum') {
      ctx.beginPath();
      ctx.arc(0, 0, ent.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff5722';
      ctx.font = '700 13px Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▲', 0, 1);
    } else if (ent.role === 'blackbox') {
      const r = ent.radius;
      ctx.beginPath();
      ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7ee787';
      ctx.font = '700 10px Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DATA', 0, 1);
    } else {
      // scientist 等人员图标
      ctx.beginPath();
      ctx.arc(0, 0, ent.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(0, -4, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 10, 8, Math.PI, 0);
      ctx.fill();
    }

    // 实体名称标签
    ctx.font = '600 11px -apple-system, sans-serif';
    ctx.fillStyle = ent.disabled ? '#7ee787' : '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const statusSuffix = ent.disabled ? ' [已瘫痪]' : ent.isProtected ? ' [保护]' : '';
    ctx.fillText(`${ent.name}${statusSuffix}`, 0, ent.radius + 17);

    // 顶部材质频段徽章组（如 [δ][α][β]）
    const mats = ent.remainingMaterials;
    const badgeW = 20;
    const gap = 4;
    const totalW = mats.length * badgeW + Math.max(0, mats.length - 1) * gap;
    let startX = -totalW / 2;
    const badgeY = -ent.radius - 22;

    for (const m of mats) {
      const meta = SPECTRUM_META[m];
      ctx.fillStyle = 'rgba(7, 11, 18, 0.9)';
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(startX, badgeY, badgeW, 15, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = meta.color;
      ctx.font = '700 10.5px Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(meta.symbol, startX + badgeW / 2, badgeY + 7.8);
      startX += badgeW + gap;
    }

    ctx.restore();
  }

  private drawQuantumRose(x: number, y: number, t: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    const shimmer = 0.45 + 0.35 * Math.sin(t * 2.8);
    ctx.strokeStyle = `rgba(56, 189, 248, ${shimmer})`;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 1.3;

    // 极坐标四叶量子蓝玫瑰线框
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2; a += 0.08) {
      const r = 13 * Math.cos(2 * a + t * 0.4);
      const px = r * Math.cos(a);
      const py = r * Math.sin(a);
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.font = '600 9.5px Menlo, monospace';
    ctx.fillStyle = `rgba(125, 211, 252, ${shimmer + 0.15})`;
    ctx.textAlign = 'center';
    ctx.fillText('Ψ 蓝玫瑰 (无观测态)', 0, 24);
    ctx.restore();
  }

  private drawObserverHardware(obs: ObserverState, t: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(obs.x, obs.y);

    const isPlayer = obs.owner === 'player';
    const color = isPlayer
      ? obs.active
        ? '#7ee787'
        : '#64748b'
      : '#ff6b57';

    // 点击提示波纹（针对窗外可控信标）
    if (isPlayer && obs.id !== 'obs-emitter') {
      ctx.strokeStyle = hexToRgba(color, 0.35 + Math.sin(t * 4) * 0.15);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 底座
    ctx.fillStyle = '#0e1623';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 指向灯头
    ctx.save();
    ctx.rotate(obs.angleRad);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(10, -5);
    ctx.lineTo(17, 0);
    ctx.lineTo(10, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 标签
    if (obs.id !== 'obs-emitter') {
      ctx.font = '600 10.5px Menlo, monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      const stateTag = isPlayer ? (obs.active ? '[点击关闭]' : '[点击开启]') : '[巡逻扫描]';
      ctx.fillText(`${obs.name} ${stateTag}`, 0, obs.y > WORLD_HEIGHT - 120 ? 32 : -18);
    }

    ctx.restore();
  }

  private drawEmitterAndPrediction(world: SimulationWorld, ui: RenderUIState): void {
    const ctx = this.ctx;
    const specMeta = SPECTRUM_META[world.selectedSpectrum];

    // 未发射或暂停时，画出前瞻预测轨道虚线！
    if (!world.electron || !world.electron.alive || world.paused) {
      const startX = world.emitterX + Math.cos(world.emitterAngle) * 26;
      const startY = world.emitterY + Math.sin(world.emitterAngle) * 26;
      const pred = predictTrajectory(
        startX,
        startY,
        world.emitterAngle,
        world.selectedSpectrum,
        world.devices,
        world.walls,
        (x, y) => world.isPointObserved(x, y),
        3.6
      );

      if (pred.points.length > 1) {
        ctx.save();
        ctx.strokeStyle = hexToRgba(specMeta.color, 0.58);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -ui.visualTime * 28;
        ctx.beginPath();
        ctx.moveTo(pred.points[0].x, pred.points[0].y);
        for (let i = 1; i < pred.points.length; i++) {
          ctx.lineTo(pred.points[i].x, pred.points[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // 标注进入盲区或撞墙落点
        if (pred.enteredBlindZoneAt) {
          const p = pred.enteredBlindZoneAt;
          ctx.strokeStyle = specMeta.color;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 12 + Math.sin(ui.visualTime * 6) * 2.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = '700 10.5px Menlo, monospace';
          ctx.fillStyle = specMeta.color;
          ctx.textAlign = 'center';
          ctx.fillText('进入盲区 → 量子概率云', p.x, p.y - 18);
        } else if (pred.hitWallAt) {
          const p = pred.hitWallAt;
          ctx.strokeStyle = '#ff5722';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x - 6, p.y - 6);
          ctx.lineTo(p.x + 6, p.y + 6);
          ctx.moveTo(p.x + 6, p.y - 6);
          ctx.lineTo(p.x - 6, p.y + 6);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 绘制雷球发生器本体
    ctx.save();
    ctx.translate(world.emitterX, world.emitterY);

    // 旋转底座
    ctx.fillStyle = '#0d1522';
    ctx.strokeStyle = specMeta.color;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = specMeta.color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 发射炮口指针
    ctx.rotate(world.emitterAngle);
    ctx.fillStyle = specMeta.color;
    ctx.beginPath();
    ctx.roundRect(10, -5, 20, 10, 3);
    ctx.fill();

    // 瞄准拉动手柄提示
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(38, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    ctx.save();
    ctx.font = '600 10.5px Menlo, monospace';
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.fillText('雷球发生器 (拖拽瞄准)', world.emitterX, world.emitterY + 36);
    ctx.restore();
  }

  private drawClassicalElectron(e: MacroElectronState, t: number): void {
    const ctx = this.ctx;
    const meta = SPECTRUM_META[e.spectrum];

    ctx.save();

    // 等离子拖尾
    if (e.trail.length > 1) {
      for (let i = 1; i < e.trail.length; i++) {
        const ratio = i / e.trail.length;
        ctx.strokeStyle = hexToRgba(meta.color, ratio * 0.72);
        ctx.lineWidth = 1.5 + ratio * 5.5;
        ctx.beginPath();
        ctx.moveTo(e.trail[i - 1].x, e.trail[i - 1].y);
        ctx.lineTo(e.trail[i].x, e.trail[i].y);
        ctx.stroke();
      }
    }

    // 外层辉光球体
    const jitterX = Math.sin(t * 47) * 1.1;
    const jitterY = Math.cos(t * 53) * 1.1;
    const cx = e.x + jitterX;
    const cy = e.y + jitterY;

    const glowGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
    glowGrad.addColorStop(0, '#ffffff');
    glowGrad.addColorStop(0.32, meta.color);
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();

    // 高频锯齿微电弧
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      const a = t * 14 + k * 2.1;
      const r1 = 8;
      const r2 = 17;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a + 0.3) * ((r1 + r2) * 0.5), cy + Math.sin(a + 0.3) * ((r1 + r2) * 0.5));
      ctx.lineTo(cx + Math.cos(a - 0.15) * r2, cy + Math.sin(a - 0.15) * r2);
      ctx.stroke();
    }

    // 核心白球
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 6.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawPlacementGhost(kind: DeviceKind, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.6;
    const r = kind === 'deflector' ? 76 : 108;
    ctx.strokeStyle = '#00e5ff';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '600 11px Menlo, monospace';
    ctx.fillStyle = '#e0f2fe';
    ctx.textAlign = 'center';
    ctx.fillText(
      `点击放置 ${kind === 'deflector' ? '超导磁偏转器' : '高压引雷针'} (Esc取消)`,
      x,
      y - 24
    );
    ctx.restore();
  }

  private drawFx(fx: FxEvent): void {
    const ctx = this.ctx;
    const p = Math.min(1, fx.age / fx.duration);
    const inv = 1 - p;

    ctx.save();
    if (fx.kind === 'collapse_implosion') {
      // 由大向小剧烈内爆收束环！直观展示“漫天概率云坍缩为一点”
      const r = fx.radius * inv * inv + 6;
      ctx.strokeStyle = hexToRgba(fx.color, 0.9 * inv);
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();

      // 闪光十字星
      ctx.strokeStyle = `rgba(255, 255, 255, ${inv})`;
      ctx.lineWidth = 2;
      const arm = 26 * inv;
      ctx.beginPath();
      ctx.moveTo(fx.x - arm, fx.y);
      ctx.lineTo(fx.x + arm, fx.y);
      ctx.moveTo(fx.x, fx.y - arm);
      ctx.lineTo(fx.x, fx.y + arm);
      ctx.stroke();
    } else if (fx.kind === 'selective_vaporize') {
      const r = 10 + fx.radius * p;
      ctx.strokeStyle = hexToRgba(fx.color, inv);
      ctx.lineWidth = 3 * inv + 1;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = hexToRgba(fx.color, inv * 0.25);
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    } else if (fx.kind === 'secondary_blast') {
      const r = fx.radius * Math.pow(p, 0.45);
      const grad = ctx.createRadialGradient(fx.x, fx.y, 4, fx.x, fx.y, r);
      grad.addColorStop(0, `rgba(255, 240, 200, ${inv * 0.85})`);
      grad.addColorStop(0.55, `rgba(255, 87, 34, ${inv * 0.55})`);
      grad.addColorStop(1, 'rgba(255, 87, 34, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (fx.kind === 'charge_arc' && fx.fromX !== undefined && fx.fromY !== undefined) {
      ctx.strokeStyle = hexToRgba('#ffffff', inv);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fx.fromX, fx.fromY);
      const midX = (fx.fromX + fx.x) / 2 + (Math.random() - 0.5) * 14;
      const midY = (fx.fromY + fx.y) / 2 + (Math.random() - 0.5) * 14;
      ctx.lineTo(midX, midY);
      ctx.lineTo(fx.x, fx.y);
      ctx.stroke();
    } else {
      ctx.strokeStyle = hexToRgba(fx.color, inv);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 8 + fx.radius * p, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (fx.label) {
      ctx.font = '700 11.5px Menlo, monospace';
      ctx.fillStyle = hexToRgba(fx.color, Math.min(1, inv * 1.4));
      ctx.textAlign = 'center';
      ctx.fillText(fx.label, fx.x, fx.y - 26 - p * 18);
    }

    ctx.restore();
  }

  private drawReticleFrame(world: SimulationWorld): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(125, 165, 215, 0.28)';
    ctx.lineWidth = 1.5;
    const len = 18;
    const m = 10;
    // 四角 L 形取景框
    const corners: [number, number, number, number][] = [
      [m, m, 1, 1],
      [WORLD_WIDTH - m, m, -1, 1],
      [m, WORLD_HEIGHT - m, 1, -1],
      [WORLD_WIDTH - m, WORLD_HEIGHT - m, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * len);
      ctx.stroke();
    }

    // 右下角时钟
    ctx.font = '500 10.5px Menlo, monospace';
    ctx.fillStyle = 'rgba(142, 161, 184, 0.5)';
    ctx.textAlign = 'right';
    ctx.fillText(
      `T+${world.elapsedTime.toFixed(2)}s  |  ${world.level.code}`,
      WORLD_WIDTH - 20,
      WORLD_HEIGHT - 16
    );
    ctx.restore();
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
