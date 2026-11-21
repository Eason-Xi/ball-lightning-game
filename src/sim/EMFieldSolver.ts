import {
  DeviceState,
  FIXED_DT,
  MacroElectronState,
  SpectrumType,
  Vec2,
  WallState,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './types';
import {
  angleDiff,
  computeMetalRailSlide,
  dist,
  segmentRectHit,
  wallBlocksClassical,
} from './geometry';

export const ELECTRON_BASE_SPEED = 185; // px/s
export const CLASSICAL_DECAY_PER_SEC = 18; // ~5.5s 基础寿命
export const CLOUD_DECAY_PER_SEC = 9;
export const ATTRACTOR_CHARGE_AMOUNT = 38;

export interface StepEMResult {
  chargedDevice?: DeviceState;
}

/**
 * 计算单步电磁场（超导磁偏转器 + 高压引雷针）对经典态球状闪电的速度导向
 */
export function applyEMForces(
  electron: Pick<
    MacroElectronState,
    'x' | 'y' | 'vx' | 'vy' | 'speed' | 'stability' | 'maxStability' | 'chargedDeviceIds'
  >,
  devices: DeviceState[],
  dt: number
): StepEMResult {
  let curAngle = Math.atan2(electron.vy, electron.vx);
  let chargedDevice: DeviceState | undefined;

  for (const dev of devices) {
    if (dev.kind !== 'deflector' && dev.kind !== 'attractor') continue;

    const dx = dev.x - electron.x;
    const dy = dev.y - electron.y;
    const d = Math.hypot(dx, dy);

    if (d > dev.radius) continue;

    if (dev.kind === 'deflector') {
      const influence = 1 - d / dev.radius;
      const targetAngle = dev.angleRad;
      const diff = angleDiff(curAngle, targetAngle);
      // 越靠近中心磁透镜核心转向越果断，防止在作用圈外缘过早拐弯导致平行偏移
      const turnRate = 3.5 + influence * influence * 28.0;
      curAngle += diff * Math.min(1, turnRate * dt);

      // 沿导向轴线强力束流收束（所见即所得：出射轨迹紧贴箭头指向线）
      const axisX = Math.cos(targetAngle);
      const axisY = Math.sin(targetAngle);
      const relX = electron.x - dev.x;
      const relY = electron.y - dev.y;
      const cross = relX * axisY - relY * axisX;
      const recenterStrength = (1.5 + influence * 6.5) * dt;
      electron.x += axisY * -cross * recenterStrength;
      electron.y += -axisX * -cross * recenterStrength;
    } else if (dev.kind === 'attractor') {
      if (!electron.chargedDeviceIds.has(dev.id)) {
        if (d < 24) {
          electron.chargedDeviceIds.add(dev.id);
          electron.stability = Math.min(
            electron.maxStability,
            electron.stability + ATTRACTOR_CHARGE_AMOUNT
          );
          chargedDevice = dev;
        } else {
          const toCenter = Math.atan2(dy, dx);
          const diff = angleDiff(curAngle, toCenter);
          const pull = (1 - d / dev.radius) * 7.5 + 2.2;
          curAngle += diff * Math.min(1, pull * dt);
        }
      }
    }
  }

  electron.vx = Math.cos(curAngle) * electron.speed;
  electron.vy = Math.sin(curAngle) * electron.speed;
  return { chargedDevice };
}

export interface PredictionPoint extends Vec2 {
  observed: boolean;
}

/**
 * 为玩家在时停/瞄准阶段推演前瞻虚拟轨道（支持磁偏转、引雷针、金属壁贴壁滑行与盲区入口标注）
 */
export function predictTrajectory(
  startX: number,
  startY: number,
  angleRad: number,
  spectrum: SpectrumType,
  devices: DeviceState[],
  walls: WallState[],
  isObservedFn: (x: number, y: number) => boolean,
  maxSeconds = 3.6
): {
  points: PredictionPoint[];
  enteredBlindZoneAt?: Vec2;
  hitWallAt?: Vec2;
} {
  const sim = {
    x: startX,
    y: startY,
    vx: Math.cos(angleRad) * ELECTRON_BASE_SPEED,
    vy: Math.sin(angleRad) * ELECTRON_BASE_SPEED,
    speed: ELECTRON_BASE_SPEED,
    stability: 100,
    maxStability: 100,
    chargedDeviceIds: new Set<string>(),
  };

  const points: PredictionPoint[] = [];
  const totalSteps = Math.floor(maxSeconds / FIXED_DT);
  let enteredBlindZoneAt: Vec2 | undefined;
  let hitWallAt: Vec2 | undefined;

  for (let i = 0; i < totalSteps; i++) {
    const obs = isObservedFn(sim.x, sim.y);
    if (i % 2 === 0) {
      points.push({ x: sim.x, y: sim.y, observed: obs });
    }

    if (!obs) {
      enteredBlindZoneAt = { x: sim.x, y: sim.y };
      break;
    }

    const prevX = sim.x;
    const prevY = sim.y;
    applyEMForces(sim, devices, FIXED_DT);

    const nextX = sim.x + sim.vx * FIXED_DT;
    const nextY = sim.y + sim.vy * FIXED_DT;

    if (nextX < 4 || nextX > WORLD_WIDTH - 4 || nextY < 4 || nextY > WORLD_HEIGHT - 4) {
      hitWallAt = { x: nextX, y: nextY };
      points.push({ x: nextX, y: nextY, observed: true });
      break;
    }

    let closestWall: WallState | null = null;
    let closestT = Infinity;
    for (const w of walls) {
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
      if (closestWall.kind === 'metal_rail') {
        const slid = computeMetalRailSlide(hx, hy, sim.vx, sim.vy, sim.speed, closestWall);
        sim.x = slid.x;
        sim.y = slid.y;
        sim.vx = slid.vx;
        sim.vy = slid.vy;
        sim.stability -= CLASSICAL_DECAY_PER_SEC * FIXED_DT;
        continue;
      }
      hitWallAt = { x: hx, y: hy };
      points.push({ x: hx, y: hy, observed: true });
      if (closestWall.kind === 'steel_door' && spectrum === 'delta') {
        hitWallAt = undefined;
      }
      break;
    }

    sim.x = nextX;
    sim.y = nextY;
    sim.stability -= CLASSICAL_DECAY_PER_SEC * FIXED_DT;
    if (sim.stability <= 0) break;
  }

  return { points, enteredBlindZoneAt, hitWallAt };
}

export function findDeviceAt(
  x: number,
  y: number,
  devices: DeviceState[]
): DeviceState | undefined {
  let best: DeviceState | undefined;
  let bestD = Infinity;
  for (const d of devices) {
    const dd = dist(x, y, d.x, d.y);
    if (dd <= 24 && dd < bestD) {
      best = d;
      bestD = dd;
    }
  }
  return best;
}
