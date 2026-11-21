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
    desc: '仅抹除芯片、雷达、监控探头与精密电子设备，不伤人员与建筑',
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
    desc: '选择性气化碳基目标而完整保留精密芯片、金属与高爆器物',
  },
};

export interface Vec2 {
  x: number;
  y: number;
}

export type WallKind = 'concrete' | 'glass' | 'steel_door' | 'metal_rail';

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
  | 'commander'
  | 'jammer'
  | 'camera_node'
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
  /** 若为可破坏监控节点，摧毁其 alpha 层后同步关闭关联的敌方观测源 ID */
  linkedObserverId?: string;
  /** 仅在无观测暗区显现的量子幽灵实体 */
  quantumGhostOnly?: boolean;
  /** 当量子幽灵处于无观测显化态时，可压制（临时关闭）指定的敌方观测源 ID */
  suppressObserverId?: string;
}

export interface EntityState extends EntitySpec {
  remainingMaterials: SpectrumType[];
  destroyed: boolean;
  disabled: boolean;
  blastTriggered: boolean;
  /** 异频无害穿透时的视觉反馈倒计时 */
  phasePassTimer: number;
  /** 量子幽灵当前是否处于无观测激活态 */
  ghostActive: boolean;
}

export type DeviceKind = 'deflector' | 'attractor' | 'screen' | 'beacon';

export interface DeviceSpec {
  id: string;
  kind: DeviceKind;
  x: number;
  y: number;
  /** deflector / screen / beacon 的朝向弧度 */
  angleRad: number;
  /** 电磁作用半径或遮蔽幕半长 */
  radius: number;
  fixed?: boolean;
  /** 仅 beacon 使用：关联生成的观测源是否默认开启 */
  beaconActive?: boolean;
}

export interface DeviceState extends DeviceSpec {
  pulseTimer: number;
  linkedObserverId?: string;
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
  /** 被关联的监控节点摧毁导致永久失能 */
  permanentlyDisabled: boolean;
  /** 被暗区量子幽灵临时压制 */
  suppressedByGhost: boolean;
  /** 是否源自玩家部署的便携信标装置 */
  sourceDeviceId?: string;
}

export interface EmitterSpec {
  x: number;
  y: number;
  angleRad: number;
  minAngleRad?: number;
  maxAngleRad?: number;
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

export interface LevelInventory {
  deflector: number;
  attractor: number;
  screen?: number;
  beacon?: number;
}

export interface LevelSpec {
  id: string;
  act: 1 | 2 | 3 | 4 | 0;
  actTitle: string;
  code: string;
  title: string;
  brief: string;
  hint: string;
  /** 619 项目实验档案碎片（原著风格硬科幻叙事文本） */
  archive: string;
  ammo: number; // -1 表示无限（沙盒模式）
  /** 允许场内同时活跃的最大宏电子数（默认为 1；宏聚变/沙盒关为 2+） */
  maxConcurrentElectrons?: number;
  /** 是否开启双球共鸣宏聚变机制 */
  macroFusionEnabled?: boolean;
  allowedSpectrums: SpectrumType[];
  defaultSpectrum: SpectrumType;
  inventory: LevelInventory;
  emitter: EmitterSpec;
  walls: WallSpec[];
  entities: EntitySpec[];
  devices: DeviceSpec[];
  observers: ObserverSpec[];
  objectives: ObjectiveSpec[];
  /** 是否默认处于全局常亮监控环境 */
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
  passedEntityIds: Set<string>;
}

export interface FxEvent {
  id: number;
  kind:
    | 'collapse_implosion'
    | 'selective_vaporize'
    | 'secondary_blast'
    | 'macro_fusion'
    | 'wall_fizzle'
    | 'charge_arc'
    | 'phase_pass';
  x: number;
  y: number;
  color: string;
  secondaryColor?: string;
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
  onMacroFusion?: () => void;
  onCharge?: () => void;
  onFizzle?: () => void;
  onObserverToggle?: (active: boolean) => void;
  onToast?: (message: string, warn?: boolean) => void;
}
