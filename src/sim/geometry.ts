import { DeviceState, Vec2, WallState, WORLD_HEIGHT, WORLD_WIDTH } from './types';

export interface SightSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

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
 * 两条线段 (a->b) 与 (c->d) 求交，返回沿第一条线段的参数 t in [0, 1]
 */
export function segmentSegmentHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): number | null {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-8) return null;

  const qpx = cx - ax;
  const qpy = cy - ay;
  const t = (qpx * sY - qpy * sX) / denom;
  const u = (qpx * rY - qpy * rX) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return t;
  }
  return null;
}

/**
 * 线段 (x1,y1)->(x2,y2) 与轴对齐矩形 [rx, ry, rw, rh] 的最近交点参数 t in [0, 1]
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

/** 获取所有光学遮蔽幕（screen）的挡光线段 */
export function extractScreenSegments(devices: DeviceState[]): SightSegment[] {
  const segs: SightSegment[] = [];
  for (const d of devices) {
    if (d.kind !== 'screen') continue;
    const half = d.radius;
    // 遮蔽幕垂直于其法线朝向 angleRad（即沿着 angleRad + PI/2 方向延展）
    const tx = -Math.sin(d.angleRad) * half;
    const ty = Math.cos(d.angleRad) * half;
    segs.push({
      x1: d.x - tx,
      y1: d.y - ty,
      x2: d.x + tx,
      y2: d.y + ty,
    });
  }
  return segs;
}

/** 墙体是否阻挡光学观测射线（glass 透明允许光线穿过） */
export function wallBlocksSight(wall: WallState): boolean {
  if (wall.destroyed) return false;
  return wall.kind === 'concrete' || wall.kind === 'steel_door' || wall.kind === 'metal_rail';
}

/** 墙体是否阻挡经典态球状闪电 */
export function wallBlocksClassical(wall: WallState): boolean {
  return !wall.destroyed;
}

/** 射线检测所有遮光墙体与光学遮蔽幕的最近交点 */
export function castSightRay(
  ox: number,
  oy: number,
  angleRad: number,
  maxDist: number,
  walls: WallState[],
  screens: SightSegment[] = []
): Vec2 {
  const ex = ox + Math.cos(angleRad) * maxDist;
  const ey = oy + Math.sin(angleRad) * maxDist;
  let bestT = 1;

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
    if (t !== null && t < bestT) bestT = t;
  }

  for (const s of screens) {
    const t = segmentSegmentHit(ox, oy, ex, ey, s.x1, s.y1, s.x2, s.y2);
    if (t !== null && t < bestT) bestT = t;
  }

  return {
    x: ox + dx * bestT,
    y: oy + dy * bestT,
  };
}

/** 判断一点是否在某观测扇形视锥内且不被墙体或遮蔽幕遮挡 */
export function isPointInObserverCone(
  px: number,
  py: number,
  ox: number,
  oy: number,
  angleRad: number,
  fovRad: number,
  range: number,
  walls: WallState[],
  screens: SightSegment[] = []
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

  for (const s of screens) {
    const hit = segmentSegmentHit(ox, oy, tx, ty, s.x1, s.y1, s.x2, s.y2);
    if (hit !== null && hit > 0.001 && hit < 0.999) {
      return false;
    }
  }

  return true;
}

/** 计算观测源的精确 2D 视锥可见多边形（含光学遮蔽幕锐利阴影） */
export function computeObserverPolygon(
  ox: number,
  oy: number,
  angleRad: number,
  fovRad: number,
  range: number,
  walls: WallState[],
  screens: SightSegment[] = []
): Vec2[] {
  const isFullCircle = fovRad >= Math.PI * 1.99;
  const halfFov = fovRad * 0.5;
  const offsets: number[] = [];

  const steps = isFullCircle ? 72 : Math.max(24, Math.ceil((fovRad / Math.PI) * 56));
  for (let i = 0; i <= steps; i++) {
    const off = isFullCircle
      ? -Math.PI + (i / steps) * Math.PI * 2
      : -halfFov + (i / steps) * fovRad;
    offsets.push(off);
  }

  const eps = 0.0008;
  const pushCorner = (cx: number, cy: number) => {
    const a = Math.atan2(cy - oy, cx - ox);
    const rel = angleDiff(angleRad, a);
    if (isFullCircle || Math.abs(rel) <= halfFov) {
      offsets.push(rel - eps, rel, rel + eps);
    }
  };

  for (const w of walls) {
    if (!wallBlocksSight(w)) continue;
    pushCorner(w.x, w.y);
    pushCorner(w.x + w.w, w.y);
    pushCorner(w.x, w.y + w.h);
    pushCorner(w.x + w.w, w.y + w.h);
  }

  for (const s of screens) {
    pushCorner(s.x1, s.y1);
    pushCorner(s.x2, s.y2);
  }

  offsets.sort((a, b) => a - b);

  const pts: Vec2[] = [];
  if (!isFullCircle) {
    pts.push({ x: ox, y: oy });
  }

  for (const off of offsets) {
    const clampedOff = isFullCircle ? off : clamp(off, -halfFov, halfFov);
    pts.push(castSightRay(ox, oy, angleRad + clampedOff, range, walls, screens));
  }

  return pts;
}

/**
 * 导电金属壁（metal_rail）贴壁滑行求解：
 * 当经典态球状闪电命中 metal_rail 时，根据命中边法线将其速度重定向为沿金属表面切向滑行，并微推离壁面防嵌入。
 */
export function computeMetalRailSlide(
  hx: number,
  hy: number,
  vx: number,
  vy: number,
  speed: number,
  wall: WallState
): { x: number; y: number; vx: number; vy: number } {
  const pad = 7.5;
  const distLeft = Math.abs(hx - wall.x);
  const distRight = Math.abs(hx - (wall.x + wall.w));
  const distTop = Math.abs(hy - wall.y);
  const distBottom = Math.abs(hy - (wall.y + wall.h));
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  let nx = hx;
  let ny = hy;
  let nvx = vx;
  let nvy = vy;

  if (minDist === distTop || minDist === distBottom) {
    // 命中上/下水平面 -> 沿水平方向切向滑行
    ny = minDist === distTop ? wall.y - pad : wall.y + wall.h + pad;
    const signX = Math.abs(vx) > 5 ? Math.sign(vx) : hx < wall.x + wall.w / 2 ? -1 : 1;
    nvx = signX * speed;
    nvy = 0;
  } else {
    // 命中左/右垂直面 -> 沿垂直方向切向滑行
    nx = minDist === distLeft ? wall.x - pad : wall.x + wall.w + pad;
    const signY = Math.abs(vy) > 5 ? Math.sign(vy) : hy < wall.y + wall.h / 2 ? -1 : 1;
    nvx = 0;
    nvy = signY * speed;
  }

  return { x: nx, y: ny, vx: nvx, vy: nvy };
}
