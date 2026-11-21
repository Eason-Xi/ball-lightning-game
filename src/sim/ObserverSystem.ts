import {
  GRID_CELL,
  GRID_COLS,
  GRID_ROWS,
  ObserverState,
  WallState,
} from './types';
import { computeObserverPolygon, isPointInObserverCone } from './geometry';

export class ObserverSystem {
  /** 全图每格当前是否处于任意开启的观测源覆盖中 (1=观测, 0=暗区盲区) */
  public gridObserved = new Uint8Array(GRID_COLS * GRID_ROWS);
  /** 上一帧的观测掩码，用于判断某网格是否刚从暗变亮 */
  public prevGridObserved = new Uint8Array(GRID_COLS * GRID_ROWS);

  /** 更新敌方巡逻探照灯摆动并重算可见视锥多边形 + 观测网格 */
  public update(
    observers: ObserverState[],
    walls: WallState[],
    elapsedTime: number,
    ambientObserved: boolean
  ): void {
    this.prevGridObserved.set(this.gridObserved);

    for (const obs of observers) {
      if (obs.sweep && obs.active) {
        const phase = obs.sweep.phaseOffset ?? 0;
        obs.angleRad =
          obs.sweep.centerRad +
          Math.sin(elapsedTime * obs.sweep.speedRadPerSec + phase) *
            obs.sweep.amplitudeRad;
      }
      if (obs.active) {
        obs.polygon = computeObserverPolygon(
          obs.x,
          obs.y,
          obs.angleRad,
          obs.fovRad,
          obs.range,
          walls
        );
      } else {
        obs.polygon = [];
      }
    }

    if (ambientObserved) {
      this.gridObserved.fill(1);
      return;
    }

    // 重算网格级观测状态
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      const py = (gy + 0.5) * GRID_CELL;
      const rowOffset = gy * GRID_COLS;
      for (let gx = 0; gx < GRID_COLS; gx++) {
        const px = (gx + 0.5) * GRID_CELL;
        this.gridObserved[rowOffset + gx] = this.isPointObservedExact(
          px,
          py,
          observers,
          walls,
          false
        )
          ? 1
          : 0;
      }
    }
  }

  public isPointObservedExact(
    x: number,
    y: number,
    observers: ObserverState[],
    walls: WallState[],
    ambientObserved: boolean
  ): boolean {
    if (ambientObserved) return true;
    for (const obs of observers) {
      if (!obs.active) continue;
      if (
        isPointInObserverCone(
          x,
          y,
          obs.x,
          obs.y,
          obs.angleRad,
          obs.fovRad,
          obs.range,
          walls
        )
      ) {
        return true;
      }
    }
    return false;
  }

  public isCellObserved(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) return false;
    return this.gridObserved[gy * GRID_COLS + gx] === 1;
  }

  public didCellTurnObserved(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= GRID_COLS || gy < 0 || gy >= GRID_ROWS) return false;
    const idx = gy * GRID_COLS + gx;
    return this.gridObserved[idx] === 1 && this.prevGridObserved[idx] === 0;
  }
}
