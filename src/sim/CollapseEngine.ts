import {
  EntityState,
  GRID_CELL,
  GRID_COLS,
  GRID_ROWS,
  MacroElectronState,
  WallState,
} from './types';
import { clamp, pointInRect, wallBlocksClassical } from './geometry';
import { ObserverSystem } from './ObserverSystem';

export interface CollapseOutcome {
  collapsed: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetEntity?: EntityState;
  targetWall?: WallState;
}

/**
 * 量子概率云扩散引擎与波函数坍缩裁决器
 */
export class CollapseEngine {
  /** 概率密度幅值网格 [0..1] */
  public psi = new Float32Array(GRID_COLS * GRID_ROWS);
  private nextPsi = new Float32Array(GRID_COLS * GRID_ROWS);
  /** 静态/当前帧墙体阻滞网格（0=空气, 1=墙体介质，可穿墙但扩散降速） */
  private wallMask = new Uint8Array(GRID_COLS * GRID_ROWS);

  /** 进入概率云时的前向飘移惯性方向 */
  private driftDirX = 0;
  private driftDirY = 0;

  public clear(): void {
    this.psi.fill(0);
    this.nextPsi.fill(0);
  }

  /** 将经典态坐标初始化为局部高斯概率云核 */
  public seedFromClassical(electron: MacroElectronState): void {
    this.clear();
    const len = Math.hypot(electron.vx, electron.vy) || 1;
    this.driftDirX = electron.vx / len;
    this.driftDirY = electron.vy / len;

    const cgx = clamp(Math.floor(electron.x / GRID_CELL), 0, GRID_COLS - 1);
    const cgy = clamp(Math.floor(electron.y / GRID_CELL), 0, GRID_ROWS - 1);

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const gx = cgx + dx;
        const gy = cgy + dy;
        if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) continue;
        const d2 = dx * dx + dy * dy;
        this.psi[gy * GRID_COLS + gx] = Math.exp(-d2 / 2.2);
      }
    }
  }

  public rebuildWallMask(walls: WallState[]): void {
    this.wallMask.fill(0);
    for (const w of walls) {
      if (!wallBlocksClassical(w)) continue;
      const gx0 = clamp(Math.floor(w.x / GRID_CELL), 0, GRID_COLS - 1);
      const gx1 = clamp(Math.floor((w.x + w.w) / GRID_CELL), 0, GRID_COLS - 1);
      const gy0 = clamp(Math.floor(w.y / GRID_CELL), 0, GRID_ROWS - 1);
      const gy1 = clamp(Math.floor((w.y + w.h) / GRID_CELL), 0, GRID_ROWS - 1);
      for (let gy = gy0; gy <= gy1; gy++) {
        const row = gy * GRID_COLS;
        for (let gx = gx0; gx <= gx1; gx++) {
          this.wallMask[row + gx] = 1;
        }
      }
    }
  }

  /**
   * 推进一帧概率云扩散（Fisher-KPP 反应扩散 + 定向漂移偏置，支持穿过实体墙壁量子隧穿）
   */
  public stepDiffusion(
    electron: MacroElectronState,
    observerSys: ObserverSystem,
    walls: WallState[],
    dt: number
  ): void {
    this.rebuildWallMask(walls);
    electron.cloudAge += dt;

    // 2 个子步确保高波前速度下显式差分绝对数值稳定
    const subSteps = 2;
    const subDt = dt / subSteps;
    const driftFactor = Math.exp(-electron.cloudAge * 0.45) * 0.85;
    let tunnelWork = 0;

    for (let s = 0; s < subSteps; s++) {
      const airRate = 13.5 * subDt; // ~0.1125 per neighbor (sum < 0.5, strictly stable)
      const wallRate = 6.2 * subDt;

      for (let gy = 0; gy < GRID_ROWS; gy++) {
        const row = gy * GRID_COLS;
        for (let gx = 0; gx < GRID_COLS; gx++) {
          const idx = row + gx;
          const cur = this.psi[idx];

          // 持续亮着的观测光区对扩散中的概率云构成“观测边界势垒”，防止微弱边缘触角意外自杀；
          // 但一旦原本暗区被新开启/扫过的光束照亮 (isObs && !wasObs)，会在 evaluateCollapse 中立即坍缩！
          const isObs = observerSys.gridObserved[idx] === 1;
          const wasObs = observerSys.prevGridObserved[idx] === 1;
          if (isObs && wasObs) {
            this.nextPsi[idx] = cur * 0.55;
            continue;
          }

          const isWall = this.wallMask[idx] === 1;
          const rate = isWall ? wallRate : airRate;

          let sumDelta = 0;
          const dirs: [number, number][] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (const [dx, dy] of dirs) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
            const nVal = this.psi[ny * GRID_COLS + nx];
            if (nVal > cur) {
              // 如果是从上游（发射方向后侧）传过来，显著增强前向波包推进速度
              const align = -(dx * this.driftDirX + dy * this.driftDirY);
              const bias = 1 + align * driftFactor;
              sumDelta += (nVal - cur) * rate * Math.max(0.25, bias);
            }
          }

          // Fisher-KPP 波前自维持增长项，让概率云在漆黑房间内饱满铺开
          let nextVal = cur + sumDelta;
          if (nextVal > 0.015) {
            const growth = isWall ? 1.1 : 3.2;
            nextVal += growth * subDt * nextVal * (1 - nextVal);
          }

          if (isWall && nextVal > cur) {
            tunnelWork += nextVal - cur;
          }

          this.nextPsi[idx] = clamp(nextVal, 0, 1);
        }
      }

      this.psi.set(this.nextPsi);
    }

    // 量子穿墙带来的轻微额外能量衰减
    electron.stability -= Math.min(2.5 * dt, tunnelWork * 0.04);
  }

  /** 查询任意世界坐标处的局部最大概率幅 [0..1] */
  public sampleMaxPsiAround(x: number, y: number, radiusPx: number): number {
    const rCells = Math.max(1, Math.ceil(radiusPx / GRID_CELL));
    const cgx = clamp(Math.floor(x / GRID_CELL), 0, GRID_COLS - 1);
    const cgy = clamp(Math.floor(y / GRID_CELL), 0, GRID_ROWS - 1);
    let best = 0;

    for (let dy = -rCells; dy <= rCells; dy++) {
      for (let dx = -rCells; dx <= rCells; dx++) {
        const gx = cgx + dx;
        const gy = cgy + dy;
        if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) continue;
        const v = this.psi[gy * GRID_COLS + gx];
        if (v > best) best = v;
      }
    }
    return best;
  }

  /**
   * 检测当前观测场是否与概率云发生交集，并执行确定性波函数坍缩裁决
   */
  public evaluateCollapse(
    electron: MacroElectronState,
    observerSys: ObserverSystem,
    entities: EntityState[],
    walls: WallState[]
  ): CollapseOutcome | null {
    // 刚进入盲区的前 0.22 秒保护，确保平滑退化为概率云
    if (electron.cloudAge < 0.22) return null;

    const COLLAPSE_THRESHOLD = 0.09;

    // 1. 优先裁决：观测交集内是否存在与当前球状闪电同频的实体（确定性定点引爆）
    let bestEntity: EntityState | undefined;
    let bestEntityPsi = 0;

    for (const ent of entities) {
      if (ent.destroyed || ent.quantumGhostOnly) continue;
      if (!ent.remainingMaterials.includes(electron.spectrum)) continue;

      const gx = clamp(Math.floor(ent.x / GRID_CELL), 0, GRID_COLS - 1);
      const gy = clamp(Math.floor(ent.y / GRID_CELL), 0, GRID_ROWS - 1);
      if (!observerSys.isCellObserved(gx, gy)) continue;

      const localPsi = this.sampleMaxPsiAround(ent.x, ent.y, ent.radius + 8);
      if (localPsi >= COLLAPSE_THRESHOLD && localPsi > bestEntityPsi) {
        bestEntityPsi = localPsi;
        bestEntity = ent;
      }
    }

    if (bestEntity) {
      return {
        collapsed: true,
        x: bestEntity.x,
        y: bestEntity.y,
        vx: electron.vx,
        vy: electron.vy,
        targetEntity: bestEntity,
      };
    }

    // 2. 次优裁决：若频段为 delta，观测交集内是否有钢制重门
    if (electron.spectrum === 'delta') {
      for (const w of walls) {
        if (w.destroyed || w.kind !== 'steel_door') continue;
        const cx = w.x + w.w * 0.5;
        const cy = w.y + w.h * 0.5;
        const gx = clamp(Math.floor(cx / GRID_CELL), 0, GRID_COLS - 1);
        const gy = clamp(Math.floor(cy / GRID_CELL), 0, GRID_ROWS - 1);
        if (!observerSys.isCellObserved(gx, gy)) continue;
        const localPsi = this.sampleMaxPsiAround(cx, cy, Math.max(w.w, w.h) * 0.5);
        if (localPsi >= COLLAPSE_THRESHOLD) {
          return {
            collapsed: true,
            x: cx,
            y: cy,
            vx: electron.vx,
            vy: electron.vy,
            targetWall: w,
          };
        }
      }
    }

    // 3. 自由空间坍缩：检测被照亮的自由空气格子中是否存在足够高的概率幅
    let bestAirPsi = 0;
    let bestGx = -1;
    let bestGy = -1;

    for (let gy = 0; gy < GRID_ROWS; gy++) {
      const row = gy * GRID_COLS;
      for (let gx = 0; gx < GRID_COLS; gx++) {
        const idx = row + gx;
        if (observerSys.gridObserved[idx] !== 1) continue;
        if (this.wallMask[idx] === 1) continue;

        const val = this.psi[idx];
        // 对刚由暗变亮的格子（主动开灯/探照灯扫过）灵敏触发；对原本常亮边界需较高密度主体撞入才坍缩
        const turnedOn = observerSys.prevGridObserved[idx] === 0;
        const threshold = turnedOn ? 0.12 : 0.45;

        if (val >= threshold && val > bestAirPsi) {
          // 排除紧贴任何障碍墙内部的坐标
          const wx = (gx + 0.5) * GRID_CELL;
          const wy = (gy + 0.5) * GRID_CELL;
          const insideWall = walls.some(
            (w) => wallBlocksClassical(w) && pointInRect(wx, wy, w.x, w.y, w.w, w.h, 3)
          );
          if (!insideWall) {
            bestAirPsi = val;
            bestGx = gx;
            bestGy = gy;
          }
        }
      }
    }

    if (bestGx >= 0) {
      const cx = (bestGx + 0.5) * GRID_CELL;
      const cy = (bestGy + 0.5) * GRID_CELL;

      // 沿概率云梯度（或原入射方向）继续作为经典粒子运动
      const gRight = bestGx < GRID_COLS - 1 ? this.psi[bestGy * GRID_COLS + bestGx + 1] : 0;
      const gLeft = bestGx > 0 ? this.psi[bestGy * GRID_COLS + bestGx - 1] : 0;
      const gDown = bestGy < GRID_ROWS - 1 ? this.psi[(bestGy + 1) * GRID_COLS + bestGx] : 0;
      const gUp = bestGy > 0 ? this.psi[(bestGy - 1) * GRID_COLS + bestGx] : 0;

      // 从高密度向低密度波前推进
      let dx = gLeft - gRight + this.driftDirX * 0.35;
      let dy = gUp - gDown + this.driftDirY * 0.35;
      const dLen = Math.hypot(dx, dy);
      if (dLen < 0.01) {
        dx = this.driftDirX || 1;
        dy = this.driftDirY || 0;
      } else {
        dx /= dLen;
        dy /= dLen;
      }

      return {
        collapsed: true,
        x: cx,
        y: cy,
        vx: dx * electron.speed,
        vy: dy * electron.speed,
      };
    }

    return null;
  }
}
