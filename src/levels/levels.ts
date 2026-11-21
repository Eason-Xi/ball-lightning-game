import { LevelSpec } from '../sim/types';

export const LEVELS: LevelSpec[] = [
  // =========================================================================
  // LEVEL 01: 《空泡与偏转》—— 基础电磁场导引与引雷针能量续命
  // =========================================================================
  {
    id: 'lvl-01',
    code: 'EXP-01',
    title: '01 // 空泡与偏转',
    brief:
      '球状闪电并非直线弹道，其寿命有限且易受导体与磁场牵引。利用超导磁偏转器绕过混凝土隔墙，并借由下方高压引雷针过载续能，摧毁右侧目标服务器。',
    hint: '操作提示：在底部选中【磁偏转器】，点击空白处放置 2 个偏转器（拖拽箭头可旋转方向），引导雷球先经过底部【引雷针】补能，再折向右上命中目标主机。',
    ammo: 3,
    allowedSpectrums: ['alpha'],
    defaultSpectrum: 'alpha',
    inventory: {
      deflector: 2,
      attractor: 0,
    },
    ambientObserved: true,
    emitter: {
      x: 98,
      y: 210,
      angleRad: 0,
      hasLocalLight: false,
    },
    walls: [
      // 中央主混凝土隔墙（贴顶封死，强制从下方绕行）
      {
        id: 'w1-mid',
        x: 355,
        y: 0,
        w: 32,
        h: 356,
        kind: 'concrete',
        label: '混凝土隔墙',
      },
      // 右上导流护墙（构成实验靶道空间美感）
      {
        id: 'w1-top-guard',
        x: 640,
        y: 0,
        w: 24,
        h: 110,
        kind: 'concrete',
      },
    ],
    entities: [
      {
        id: 'srv-01',
        name: '目标计算主机',
        role: 'server',
        x: 805,
        y: 190,
        radius: 26,
        materials: ['alpha'],
        requiredDestroyLayers: ['alpha'],
      },
    ],
    devices: [
      // 预设底部高压引雷针（提供向心牵引与 +38% 能量续命）
      {
        id: 'attr-fixed-01',
        kind: 'attractor',
        x: 372,
        y: 446,
        angleRad: 0,
        radius: 108,
        fixed: true,
      },
    ],
    observers: [],
    objectives: [
      {
        id: 'obj-1',
        text: '使用 α 硅基频段摧毁目标计算主机',
        kind: 'destroy_layer',
        entityId: 'srv-01',
        layer: 'alpha',
      },
    ],
  },

  // =========================================================================
  // LEVEL 02: 《外科手术》—— 四元选择性频谱共振与零附带损伤
  // =========================================================================
  {
    id: 'lvl-02',
    code: 'EXP-02',
    title: '02 // 外科手术',
    brief:
      '球状闪电仅与同频段物质发生共振毁灭，对其余物质则如幽灵般无害穿透。穿过前方的易爆燃料桶（严禁引爆伤及黑匣子），先融化钢制重门，再精准烧毁堡垒内导弹车的火控芯片。',
    hint: '操作提示：仅 2 颗宏电子！第 1 发切至 [3] δ 金属频段直射，无害穿透燃料桶并气化钢制重门；第 2 发切至 [1] α 硅基频段直射，瘫痪导弹车火控芯片而不触发弹药殉爆。',
    ammo: 2,
    allowedSpectrums: ['alpha', 'beta', 'delta'],
    defaultSpectrum: 'alpha',
    inventory: {
      deflector: 1,
      attractor: 0,
    },
    ambientObserved: true,
    emitter: {
      x: 92,
      y: 300,
      angleRad: 0,
      hasLocalLight: false,
    },
    walls: [
      // 堡垒围墙
      { id: 'w2-top', x: 500, y: 120, w: 356, h: 24, kind: 'concrete' },
      { id: 'w2-bot', x: 500, y: 456, w: 356, h: 24, kind: 'concrete' },
      { id: 'w2-right', x: 832, y: 120, w: 24, h: 360, kind: 'concrete' },
      { id: 'w2-left-top', x: 500, y: 144, w: 24, h: 106, kind: 'concrete' },
      { id: 'w2-left-bot', x: 500, y: 350, w: 24, h: 106, kind: 'concrete' },
      // 唯一入口：δ 钢制重门
      {
        id: 'w2-door',
        x: 500,
        y: 250,
        w: 24,
        h: 100,
        kind: 'steel_door',
        label: '钢制重门 [δ]',
      },
    ],
    entities: [
      // 挡路的高爆燃料桶（β），紧邻受保护的黑匣子
      {
        id: 'fuel-01',
        name: '高爆燃料桶 A',
        role: 'fuel_drum',
        x: 285,
        y: 300,
        radius: 21,
        materials: ['beta'],
        blastRadius: 112,
      },
      {
        id: 'fuel-02',
        name: '高爆燃料桶 B',
        role: 'fuel_drum',
        x: 285,
        y: 356,
        radius: 21,
        materials: ['beta'],
        blastRadius: 112,
      },
      // 受保护的机密黑匣子（α），位于油桶爆炸半径 112px 之内
      {
        id: 'blackbox-01',
        name: '机密黑匣子',
        role: 'blackbox',
        x: 285,
        y: 214,
        radius: 20,
        materials: ['alpha'],
        isProtected: true,
      },
      // 堡垒内的复合目标导弹车（δ装甲 + α火控 + β弹药舱）
      {
        id: 'missile-01',
        name: '复合装甲导弹车',
        role: 'missile_truck',
        x: 716,
        y: 300,
        radius: 30,
        materials: ['delta', 'alpha', 'beta'],
        requiredDestroyLayers: ['alpha'],
        blastRadius: 115,
      },
      // 堡垒内紧邻导弹车的受困科研人员（γ），若误用 β 引爆导弹车会波及伤亡
      {
        id: 'sci-01',
        name: '受困科研人员',
        role: 'scientist',
        x: 716,
        y: 214,
        radius: 19,
        materials: ['gamma'],
        isProtected: true,
      },
    ],
    devices: [],
    observers: [],
    objectives: [
      {
        id: 'obj-2-1',
        text: '仅烧毁导弹车的 α 火控芯片使其瘫痪',
        kind: 'destroy_layer',
        entityId: 'missile-01',
        layer: 'alpha',
      },
      {
        id: 'obj-2-2',
        text: '保护机密黑匣子毫发无损',
        kind: 'protect',
        entityId: 'blackbox-01',
      },
      {
        id: 'obj-2-3',
        text: '保护堡垒内的科研人员安全',
        kind: 'protect',
        entityId: 'sci-01',
      },
    ],
  },

  // =========================================================================
  // LEVEL 03: 《看不见的房间》—— 观察者效应、量子穿墙与定向坍缩（核心高光）
  // =========================================================================
  {
    id: 'lvl-03',
    code: 'EXP-03',
    title: '03 // 看不见的房间',
    brief:
      '右侧干扰主站锁死在无门混凝土密室中，唯有底部一块防弹玻璃透光。没有观察者时，宏电子退化为可穿墙的概率云；开启观测的瞬间，波函数立即在光束内坍缩。',
    hint: '操作提示：1. 按 [O] 关闭己方观测源（注意观察角落神秘蓝玫瑰信号）；2. 趁左侧敌方探照灯转开时按 [F] 朝密室激发；3. 待概率云穿透实墙覆盖密室主站（Ψ > 40%），立即按 [O] 开启窗外信标触发定向坍缩！',
    ammo: 3,
    allowedSpectrums: ['alpha'],
    defaultSpectrum: 'alpha',
    inventory: {
      deflector: 0,
      attractor: 0,
    },
    ambientObserved: false,
    emitter: {
      x: 195,
      y: 260,
      angleRad: 0,
      hasLocalLight: true,
      localLightRange: 130,
    },
    walls: [
      // 全封闭防核混凝土密室（左、上、右全混凝土，下中嵌防弹玻璃窗）
      {
        id: 'w3-left',
        x: 416,
        y: 108,
        w: 24,
        h: 300,
        kind: 'concrete',
        label: '防核实墙',
      },
      { id: 'w3-top', x: 416, y: 108, w: 380, h: 24, kind: 'concrete' },
      { id: 'w3-right', x: 772, y: 108, w: 24, h: 300, kind: 'concrete' },
      { id: 'w3-bot-l', x: 416, y: 384, w: 104, h: 24, kind: 'concrete' },
      {
        id: 'w3-glass',
        x: 520,
        y: 384,
        w: 172,
        h: 24,
        kind: 'glass',
        label: '防弹玻璃 (透光)',
      },
      { id: 'w3-bot-r', x: 692, y: 384, w: 104, h: 24, kind: 'concrete' },
    ],
    entities: [
      {
        id: 'jammer-01',
        name: '宏电子干扰主站',
        role: 'jammer',
        x: 606,
        y: 256,
        radius: 28,
        materials: ['alpha'],
        requiredDestroyLayers: ['alpha'],
      },
      // 致敬刘慈欣原著：仅在无人观测的绝对黑暗中显现的量子蓝玫瑰
      {
        id: 'rose-01',
        name: '量子蓝玫瑰 Ψ',
        role: 'quantum_rose',
        x: 724,
        y: 178,
        radius: 16,
        materials: [],
        quantumGhostOnly: true,
      },
    ],
    devices: [],
    observers: [
      // 己方发射器近场监控灯（覆盖至密室左墙外侧；随 [O] 一键开关）
      {
        id: 'obs-emitter',
        name: '发射区监控灯',
        x: 195,
        y: 260,
        angleRad: 0,
        fovRad: Math.PI * 2,
        range: 240,
        active: true,
        owner: 'player',
      },
      // 己方窗外主动观测信标（透过防弹玻璃照亮密室全境！）
      {
        id: 'obs-window',
        name: '窗外主动观测信标',
        x: 606,
        y: 498,
        angleRad: -Math.PI / 2,
        fovRad: 1.38,
        range: 420,
        active: true,
        owner: 'player',
      },
      // 敌方巡逻探照灯（慢速摆动，扫向右侧墙顶时在通道留出清晰的 5 秒暗区窗口）
      {
        id: 'obs-patrol',
        name: '敌方巡逻探照灯',
        x: 310,
        y: 62,
        angleRad: 1.55,
        fovRad: 0.42,
        range: 420,
        active: true,
        owner: 'enemy',
        sweep: {
          centerRad: 1.48,
          amplitudeRad: 0.98,
          speedRadPerSec: 0.42,
          phaseOffset: 0.3,
        },
      },
    ],
    objectives: [
      {
        id: 'obj-3-1',
        text: '通过量子穿墙与波函数坍缩摧毁密室内干扰主站',
        kind: 'destroy_layer',
        entityId: 'jammer-01',
        layer: 'alpha',
      },
    ],
  },

  // =========================================================================
  // LEVEL 04: 《619 量子沙盒》—— 自由物理实验场（全四元频谱 + 无限装置）
  // =========================================================================
  {
    id: 'lvl-04',
    code: 'SANDBOX',
    title: '04 // 619 自由实验室',
    brief:
      '开放全部四元谐振频段（含 γ 碳基频段）、无限宏电子与自由电磁装置布设，支持任意组合观察者盲区穿墙与复合材质剥离实验。',
    hint: '自由实验：点击场景中的绿色信标可单独开关某盏灯；右键已部署装置可回收；拖动发射器或偏转器箭头调整任意角度。',
    ammo: -1,
    allowedSpectrums: ['alpha', 'beta', 'delta', 'gamma'],
    defaultSpectrum: 'alpha',
    inventory: {
      deflector: 99,
      attractor: 99,
    },
    ambientObserved: false,
    isSandbox: true,
    emitter: {
      x: 105,
      y: 300,
      angleRad: 0,
      hasLocalLight: true,
    },
    walls: [
      { id: 'sb-w1', x: 460, y: 120, w: 24, h: 170, kind: 'concrete' },
      { id: 'sb-w2', x: 460, y: 290, w: 24, h: 90, kind: 'steel_door', label: '钢门 [δ]' },
      { id: 'sb-w3', x: 460, y: 380, w: 24, h: 110, kind: 'concrete' },
      { id: 'sb-g1', x: 600, y: 466, w: 180, h: 24, kind: 'glass', label: '观察玻璃' },
      { id: 'sb-top', x: 460, y: 120, w: 380, h: 24, kind: 'concrete' },
      { id: 'sb-right', x: 816, y: 120, w: 24, h: 370, kind: 'concrete' },
    ],
    entities: [
      {
        id: 'sb-fuel',
        name: '测试燃料桶',
        role: 'fuel_drum',
        x: 310,
        y: 330,
        radius: 21,
        materials: ['beta'],
        blastRadius: 110,
      },
      {
        id: 'sb-truck',
        name: '四元复合靶车',
        role: 'missile_truck',
        x: 685,
        y: 260,
        radius: 30,
        materials: ['delta', 'alpha', 'beta', 'gamma'],
        blastRadius: 110,
      },
      {
        id: 'sb-srv',
        name: '密室实验终端',
        role: 'server',
        x: 685,
        y: 385,
        radius: 24,
        materials: ['alpha'],
      },
      {
        id: 'sb-rose',
        name: '量子蓝玫瑰 Ψ',
        role: 'quantum_rose',
        x: 765,
        y: 195,
        radius: 16,
        materials: [],
        quantumGhostOnly: true,
      },
    ],
    devices: [
      {
        id: 'sb-attr-1',
        kind: 'attractor',
        x: 310,
        y: 165,
        angleRad: 0,
        radius: 108,
        fixed: false,
      },
    ],
    observers: [
      {
        id: 'sb-obs-1',
        name: '左侧观测灯',
        x: 105,
        y: 300,
        angleRad: 0,
        fovRad: Math.PI * 2,
        range: 190,
        active: true,
        owner: 'player',
      },
      {
        id: 'sb-obs-2',
        name: '南侧玻璃观测信标',
        x: 690,
        y: 540,
        angleRad: -Math.PI / 2,
        fovRad: 1.5,
        range: 460,
        active: true,
        owner: 'player',
      },
    ],
    objectives: [],
  },
];
