import {
  DeviceState,
  GRID_CELL,
  GRID_COLS,
  GRID_ROWS,
  ObserverState,
  WallState,
} from './types';
import {
  computeObserverPolygon,
  extractScreenSegments,
  isPointInObserverCone,
  SightSegment,
} from './geometry';

export class ObserverSystem {
  public gridObserved = new Uint8Array(GRID_COLS * GRID_ROWS);
  public prevGridObserved = new Uint8Array(GRID_COLS * GRID_ROWS);
  private cachedScreens: SightSegment[] = [];

  /** 更新观测源（巡逻灯、便携信标、光学遮蔽幕阴影、幽灵压制状态）并重算视锥多边形与全图观测网格 */
  public update(
    observers: ObserverState[],
    walls: WallState[],
    devices: DeviceState[],
    elapsedTime: number,
    ambientObserved: boolean
  ): void {
    this.prevGridObserved.set(this.gridObserved);
    this.cachedScreens = extractScreenSegments(devices);

    for (const obs of observers) {
      const effectiveActive =
        obs.active && !obs.permanentlyDisabled && !obs.suppressedByGhost;

      if (obs.sweep && effectiveActive) {
        const phase = obs.sweep.phaseOffset ?? 0;
        obs.angleRad =
          obs.sweep.centerRad +
          Math.sin(elapsedTime * obs.sweep.speedRadPerSec + phase) *
            obs.sweep.amplitudeRad;
      }

      if (effectiveActive) {
        obs.polygon = computeObserverPolygon(
          obs.x,
          obs.y,
          obs.angleRad,
          obs.fovRad,
          obs.range,
          walls,
          this.cachedScreens
        );
      } else {
        obs.polygon = [];
      }
    }

    if (ambientObserved) {
      this.gridObserved.fill(1);
      return;
    }

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
    ambientObserved: boolean,
    ignoreObserverId?: string
  ): boolean {
    if (ambientObserved) return true;
    for (const obs of observers) {
      if (obs.id === ignoreObserverId) continue;
      if (!obs.active || obs.permanentlyDisabled || obs.suppressedByGhost) continue;
      if (
        isPointInObserverCone(
          x,
          y,
          obs.x,
          obs.y,
          obs.angleRad,
          obs.fovRad,
          obs.range,
          walls,
          this.cachedScreens
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
