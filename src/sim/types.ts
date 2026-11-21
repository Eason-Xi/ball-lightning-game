export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 600;
export const FIXED_DT = 1 / 60;

export const GRID_CELL = 12;
export const GRID_COLS = WORLD_WIDTH / GRID_CELL; // 80
export const GRID_ROWS = WORLD_HEIGHT / GRID_CELL; // 50

export type SpectrumType = 'alpha' | 'beta' | 'delta' | 'gamma';

export interface SpectrumMeta {
  id: SpectrumType;
  symbol: string;
  name: string;
  shortName: string;
  color: string;
  glow: string;
  desc: string;
}

export const SPECTRUM_META: Record<SpectrumType, SpectrumMeta> = {
  alpha: {
    id: 'alpha',
    symbol: 'α',
    name: 'α 硅基 / 电子',
    shortName: '硅基电子',
    color: '#00E5FF',
    glow: 'rgba(0, 229, 255, 0.65)',
    desc: '仅抹除芯片、雷达、火控与精密电子设备，不伤人员与建筑',
  },
  beta: {
    id: 'beta',
    symbol: 'β',
    name: 'β 含能 / 高燃',
    shortName: '含能高燃',
    color: '#FF5722',
    glow: 'rgba(255, 87, 34, 0.7)',
    desc: '引爆燃料桶、弹药舱等高能物质，可触发半径次生殉爆',
  },
  delta: {
    id: 'delta',
    symbol: 'δ',
    name: 'δ 金属 / 结构',
    shortName: '结构金属',
    color: '#FFD600',
    glow: 'rgba(255, 214, 0, 0.65)',
    desc: '气化钢制重门、装甲壳与金属屏障，打开物理通路',
  },
  gamma: {
    id: 'gamma',
    symbol: 'γ',
    name: 'γ 有机 / 碳基',
    shortName: '碳基有机',
    color: '#D500F9',
    glow: 'rgba(213, 0, 249, 0.65)',
    desc: '选择性气化碳基目标而保留金属器物（高伦理禁区）',
  },
};

export interface Vec2 {
  x: number;
  y: number;
}

export type WallKind = 'concrete' | 'glass' | 'steel_door';

export interface WallSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: WallKind;
  label?: string;
}

export interface WallState extends WallSpec {
  destroyed: boolean;
}

export type EntityRole =
  | 'server'
  | 'missile_truck'
  | 'fuel_drum'
  | 'blackbox'
  | 'scientist'
  | 'jammer'
  | 'quantum_rose';

export interface EntitySpec {
  id: string;
  name: string;
  role: EntityRole;
  x: number;
  y: number;
  radius: number;
  materials: SpectrumType[];
  isProtected?: boolean;
  /** 完成关卡需要从该实体上摧毁的频段（为空表示非必须目标） */
  requiredDestroyLayers?: SpectrumType[];
  /** 若包含 beta 且被摧毁时的次生爆炸半径 */
  blastRadius?: number;
  /** 仅在无观测暗区显现的量子幽灵彩蛋 */
  quantumGhostOnly?: boolean;
}

export interface EntityState extends EntitySpec {
  remainingMaterials: SpectrumType[];
  destroyed: boolean;
  disabled: boolean;
  blastTriggered: boolean;
  /** 异频无害穿透时的视觉反馈倒计时 */
  phasePassTimer: number;
}

export type DeviceKind = 'deflector' | 'attractor';

export interface DeviceSpec {
  id: string;
  kind: DeviceKind;
  x: number;
  y: number;
  /** 仅 deflector 使用：导向弧度 */
  angleRad: number;
  radius: number;
  fixed?: boolean;
}

export interface DeviceState extends DeviceSpec {
  pulseTimer: number;
}

export interface ObserverSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  angleRad: number;
  fovRad: number;
  range: number;
  active: boolean;
  owner: 'player' | 'enemy';
  /** 敌方探照灯摆动配置 */
  sweep?: {
    centerRad: number;
    amplitudeRad: number;
    speedRadPerSec: number;
    phaseOffset?: number;
  };
}

export interface ObserverState extends ObserverSpec {
  polygon: Vec2[];
}

export interface EmitterSpec {
  x: number;
  y: number;
  angleRad: number;
  minAngleRad?: number;
  maxAngleRad?: number;
  /** 发射器是否自带可随己方观测开关同步的近场监测灯 */
  hasLocalLight: boolean;
  localLightRange?: number;
}

export interface ObjectiveSpec {
  id: string;
  text: string;
  kind: 'destroy_layer' | 'protect';
  entityId: string;
  layer?: SpectrumType;
}

export interface LevelSpec {
  id: string;
  code: string;
  title: string;
  brief: string;
  hint: string;
  ammo: number; // -1 表示无限（沙盒模式）
  allowedSpectrums: SpectrumType[];
  defaultSpectrum: SpectrumType;
  inventory: {
    deflector: number;
    attractor: number;
  };
  emitter: EmitterSpec;
  walls: WallSpec[];
  entities: EntitySpec[];
  devices: DeviceSpec[];
  observers: ObserverSpec[];
  objectives: ObjectiveSpec[];
  /** 是否默认处于全局常亮监控环境（第 1、2 关聚焦动力学与频谱，第 3 关切换至真实观测盲区机制） */
  ambientObserved?: boolean;
  isSandbox?: boolean;
}

export type ElectronMode = 'classical' | 'cloud';

export interface MacroElectronState {
  id: number;
  spectrum: SpectrumType;
  mode: ElectronMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  stability: number; // 0..100
  maxStability: number;
  alive: boolean;
  cloudAge: number;
  trail: Vec2[];
  chargedDeviceIds: Set<string>;
  /** 刚穿过的非匹配实体，避免单次穿过刷屏日志 */
  passedEntityIds: Set<string>;
}

export interface FxEvent {
  id: number;
  kind:
    | 'collapse_implosion'
    | 'selective_vaporize'
    | 'secondary_blast'
    | 'wall_fizzle'
    | 'charge_arc'
    | 'phase_pass';
  x: number;
  y: number;
  color: string;
  radius: number;
  age: number;
  duration: number;
  fromX?: number;
  fromY?: number;
  label?: string;
}

export interface SimLogEntry {
  time: number;
  text: string;
  level: 'info' | 'highlight' | 'warn' | 'success';
}

export type MissionStatus = 'playing' | 'victory' | 'failed';

export interface SimEventCallbacks {
  onLaunch?: (spectrum: SpectrumType) => void;
  onModeChange?: (mode: ElectronMode) => void;
  onCollapse?: (x: number, y: number, hitTarget: boolean) => void;
  onVaporize?: (spectrum: SpectrumType, secondaryBlast: boolean) => void;
  onCharge?: () => void;
  onFizzle?: () => void;
  onObserverToggle?: (active: boolean) => void;
  onToast?: (message: string, warn?: boolean) => void;
}
