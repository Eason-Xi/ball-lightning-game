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
import { angleDiff, dist, segmentRectHit, wallBlocksClassical } from './geometry';

export const ELECTRON_BASE_SPEED = 185; // px/s
export const CLASSICAL_DECAY_PER_SEC = 18; // 约 5.5 秒航程 (~1017px)
export const CLOUD_DECAY_PER_SEC = 9; // 概率云更持久，便于穿墙弥散
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
    const dx = dev.x - electron.x;
    const dy = dev.y - electron.y;
    const d = Math.hypot(dx, dy);

    if (d > dev.radius) continue;

    if (dev.kind === 'deflector') {
      // 超导磁偏转器：进入作用圈后强力、平滑地把运动矢量导向 dev.angleRad
      const influence = 1 - d / dev.radius; // 越靠近中心控制力越强
      const targetAngle = dev.angleRad;
      const diff = angleDiff(curAngle, targetAngle);
      const turnRate = 9.5 + influence * 14.0;
      curAngle += diff * Math.min(1, turnRate * dt);

      // 轻微横向束流居中（沿导向轴线收束），显著提升瞄准可预测性与手感
      const axisX = Math.cos(targetAngle);
      const axisY = Math.sin(targetAngle);
      const relX = electron.x - dev.x;
      const relY = electron.y - dev.y;
      const cross = relX * axisY - relY * axisX; // 垂直于导向轴的偏移
      const recenterStrength = 2.4 * influence * dt;
      electron.x += axisY * -cross * recenterStrength;
      electron.y += -axisX * -cross * recenterStrength;
    } else if (dev.kind === 'attractor') {
      // 高压引雷针：未充能前产生明显引力吸附，经过核心即完成充能并释放脱轨
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
 * 为玩家在时停/瞄准阶段推演前瞻虚拟轨道（遇到墙体或进入无观测盲区切换为提示点）
 */
export function predictTrajectory(
  startX: number,
  startY: number,
  angleRad: number,
  spectrum: SpectrumType,
  devices: DeviceState[],
  walls: WallState[],
  isObservedFn: (x: number, y: number) => boolean,
  maxSeconds = 3.2
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
      // 盲区中转为概率云，不再延续确定性经典轨迹，只画到盲区入口
      break;
    }

    const prevX = sim.x;
    const prevY = sim.y;
    applyEMForces(sim, devices, FIXED_DT);

    const nextX = sim.x + sim.vx * FIXED_DT;
    const nextY = sim.y + sim.vy * FIXED_DT;

    // 边界检查
    if (nextX < 4 || nextX > WORLD_WIDTH - 4 || nextY < 4 || nextY > WORLD_HEIGHT - 4) {
      hitWallAt = { x: nextX, y: nextY };
      points.push({ x: nextX, y: nextY, observed: true });
      break;
    }

    // 墙体阻挡预测
    let blocked = false;
    for (const w of walls) {
      if (!wallBlocksClassical(w)) continue;
      const t = segmentRectHit(prevX, prevY, nextX, nextY, w.x, w.y, w.w, w.h, 5);
      if (t !== null) {
        const hx = prevX + (nextX - prevX) * t;
        const hy = prevY + (nextY - prevY) * t;
        hitWallAt = { x: hx, y: hy };
        points.push({ x: hx, y: hy, observed: true });
        // 如果是钢门且当前频段是 delta，提示可气化
        if (w.kind === 'steel_door' && spectrum === 'delta') {
          hitWallAt = undefined;
        }
        blocked = true;
        break;
      }
    }
    if (blocked) break;

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
