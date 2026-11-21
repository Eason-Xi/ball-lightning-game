import { Vec2, WallState, WORLD_HEIGHT, WORLD_WIDTH } from './types';

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function normalizeAngle(rad: number): number {
  let a = rad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angleDiff(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export function pointInRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  pad = 0
): boolean {
  return (
    px >= rx - pad &&
    px <= rx + rw + pad &&
    py >= ry - pad &&
    py <= ry + rh + pad
  );
}

/**
 * 线段 (x1,y1)->(x2,y2) 与轴对齐矩形 [rx, ry, rw, rh] 的最近交点参数 t in [0, 1]
 * 不相交返回 null
 */
export function segmentRectHit(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  pad = 0
): number | null {
  const minX = rx - pad;
  const maxX = rx + rw + pad;
  const minY = ry - pad;
  const maxY = ry + rh + pad;

  const dx = x2 - x1;
  const dy = y2 - y1;

  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dx) < 1e-8) {
    if (x1 < minX || x1 > maxX) return null;
  } else {
    const invD = 1 / dx;
    let t1 = (minX - x1) * invD;
    let t2 = (maxX - x1) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (Math.abs(dy) < 1e-8) {
    if (y1 < minY || y1 > maxY) return null;
  } else {
    const invD = 1 / dy;
    let t1 = (minY - y1) * invD;
    let t2 = (maxY - y1) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin;
}

/** 墙体是否阻挡光学观测射线（glass 透明允许光线穿过！） */
export function wallBlocksSight(wall: WallState): boolean {
  if (wall.destroyed) return false;
  return wall.kind === 'concrete' || wall.kind === 'steel_door';
}

/** 墙体是否阻挡经典态球状闪电 */
export function wallBlocksClassical(wall: WallState): boolean {
  return !wall.destroyed;
}

/**
 * 射线 (ox, oy) 沿 angleRad 方向、最大距离 maxDist，检测所有遮光墙体的最近交点
 */
export function castSightRay(
  ox: number,
  oy: number,
  angleRad: number,
  maxDist: number,
  walls: WallState[]
): Vec2 {
  const ex = ox + Math.cos(angleRad) * maxDist;
  const ey = oy + Math.sin(angleRad) * maxDist;
  let bestT = 1;

  // 场景边界裁剪
  const borderHits: number[] = [];
  const dx = ex - ox;
  const dy = ey - oy;
  if (dx < -1e-6) borderHits.push((0 - ox) / dx);
  if (dx > 1e-6) borderHits.push((WORLD_WIDTH - ox) / dx);
  if (dy < -1e-6) borderHits.push((0 - oy) / dy);
  if (dy > 1e-6) borderHits.push((WORLD_HEIGHT - oy) / dy);
  for (const bt of borderHits) {
    if (bt >= 0 && bt < bestT) bestT = bt;
  }

  for (const w of walls) {
    if (!wallBlocksSight(w)) continue;
    const t = segmentRectHit(ox, oy, ex, ey, w.x, w.y, w.w, w.h, 0);
    if (t !== null && t < bestT) {
      bestT = t;
    }
  }

  return {
    x: ox + dx * bestT,
    y: oy + dy * bestT,
  };
}

/** 判断一点是否在某观测扇形视锥内且无遮挡 */
export function isPointInObserverCone(
  px: number,
  py: number,
  ox: number,
  oy: number,
  angleRad: number,
  fovRad: number,
  range: number,
  walls: WallState[]
): boolean {
  const dx = px - ox;
  const dy = py - oy;
  const d2 = dx * dx + dy * dy;
  if (d2 > range * range) return false;
  if (d2 < 4) return true;

  if (fovRad < Math.PI * 1.99) {
    const dirToPt = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(angleRad, dirToPt)) > fovRad * 0.5) {
      return false;
    }
  }

  // 检测连线是否被遮光墙体阻挡（终点微缩避免刚好在目标边界误挡）
  const d = Math.sqrt(d2);
  const shrink = Math.max(0, (d - 1.5) / d);
  const tx = ox + dx * shrink;
  const ty = oy + dy * shrink;

  for (const w of walls) {
    if (!wallBlocksSight(w)) continue;
    const hit = segmentRectHit(ox, oy, tx, ty, w.x, w.y, w.w, w.h, 0);
    if (hit !== null && hit > 0.001 && hit < 0.999) {
      return false;
    }
  }
  return true;
}

/** 计算观测源的精确 2D 视锥可见多边形 */
export function computeObserverPolygon(
  ox: number,
  oy: number,
  angleRad: number,
  fovRad: number,
  range: number,
  walls: WallState[]
): Vec2[] {
  const isFullCircle = fovRad >= Math.PI * 1.99;
  const halfFov = fovRad * 0.5;
  const offsets: number[] = [];

  // 均匀采样确保扇形外弧圆滑
  const steps = isFullCircle ? 72 : Math.max(24, Math.ceil((fovRad / Math.PI) * 56));
  for (let i = 0; i <= steps; i++) {
    const off = isFullCircle
      ? -Math.PI + (i / steps) * Math.PI * 2
      : -halfFov + (i / steps) * fovRad;
    offsets.push(off);
  }

  // 补充遮光墙体的角点射线（边缘刀锋阴影）
  const eps = 0.0008;
  for (const w of walls) {
    if (!wallBlocksSight(w)) continue;
    const corners: [number, number][] = [
      [w.x, w.y],
      [w.x + w.w, w.y],
      [w.x, w.y + w.h],
      [w.x + w.w, w.y + w.h],
    ];
    for (const [cx, cy] of corners) {
      const a = Math.atan2(cy - oy, cx - ox);
      const rel = angleDiff(angleRad, a);
      if (isFullCircle || Math.abs(rel) <= halfFov) {
        offsets.push(rel - eps, rel, rel + eps);
      }
    }
  }

  offsets.sort((a, b) => a - b);

  const pts: Vec2[] = [];
  if (!isFullCircle) {
    pts.push({ x: ox, y: oy });
  }

  for (const off of offsets) {
    const clampedOff = isFullCircle ? off : clamp(off, -halfFov, halfFov);
    pts.push(castSightRay(ox, oy, angleRad + clampedOff, range, walls));
  }

  return pts;
}
