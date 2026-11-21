import { DeviceKind, SpectrumType } from '../sim/types';
import { SimulationWorld } from '../sim/World';
import { angleDiff, dist } from '../sim/geometry';

export type GuideHighlightTarget =
  | `tool:${DeviceKind}`
  | `spec:${SpectrumType}`
  | 'obs'
  | 'launch'
  | 'pause'
  | null;

export interface GuideGhost {
  kind: 'deflector' | 'screen' | 'beacon' | 'aim';
  x: number;
  y: number;
  angleRad: number;
  label: string;
}

export interface LiveGuideStep {
  badge: string;
  message: string;
  highlight: GuideHighlightTarget;
  ghosts: GuideGhost[];
}

function hasDeviceNear(
  world: SimulationWorld,
  kind: DeviceKind,
  x: number,
  y: number,
  maxDist = 58
): boolean {
  return world.devices.some(
    (d) => !d.fixed && d.kind === kind && dist(d.x, d.y, x, y) <= maxDist
  );
}

/**
 * 实时分步引导状态机：根据当前关卡与物理状态，精准告诉玩家“下一步点什么、放哪里”
 */
export function evaluateLiveGuide(world: SimulationWorld): LiveGuideStep | null {
  if (world.status !== 'playing') return null;

  const id = world.level.id;

  // =========================================================================
  // EXP-01《空泡与偏转》
  // =========================================================================
  if (id === 'lvl-01') {
    const a1 = Math.atan2(446 - 210, 372 - 245);
    const a2 = Math.atan2(190 - 525, 805 - 435);
    const g1: GuideGhost = { kind: 'deflector', x: 245, y: 210, angleRad: a1, label: '建议位 ①' };
    const g2: GuideGhost = { kind: 'deflector', x: 435, y: 525, angleRad: a2, label: '建议位 ②' };
    const placed = world.devices.filter((d) => !d.fixed && d.kind === 'deflector');

    if (world.activeElectronCount > 0) {
      return {
        badge: '观察轨道',
        message: '球状闪电正在飞行！经过下方引雷针将自动充能 +38% 并飞向右侧主机。',
        highlight: null,
        ghosts: [],
      };
    }
    if (placed.length === 0) {
      return {
        badge: '步骤 1/3',
        message: '先点底部闪烁的【磁偏转器】，再点击画布中「建议位 ①」放置并沿箭头指向下方引雷针。',
        highlight: 'tool:deflector',
        ghosts: [g1, g2],
      };
    }
    if (placed.length === 1) {
      return {
        badge: '步骤 2/3',
        message: '很好！再点一次底部【磁偏转器】，放到右下角「建议位 ②」并把箭头对准右上方的目标主机。',
        highlight: 'tool:deflector',
        ghosts: [g1, g2],
      };
    }
    return {
      badge: '步骤 3/3',
      message: '微调两个偏转器外侧蓝点（或鼠标滚轮）让青色预测虚线直通目标主机，再按 [F] 或点右下角【激发宏电子】！',
      highlight: 'launch',
      ghosts: [g1, g2],
    };
  }

  // =========================================================================
  // EXP-02《金属导流壁》
  // =========================================================================
  if (id === 'lvl-02') {
    const aimAngle = Math.atan2(142 - 455, 285 - 105);
    const gAim: GuideGhost = {
      kind: 'aim',
      x: world.emitterX,
      y: world.emitterY,
      angleRad: aimAngle,
      label: '瞄准导流壁',
    };
    const gDef: GuideGhost = {
      kind: 'deflector',
      x: 705,
      y: 150,
      angleRad: Math.PI / 2,
      label: '偏转向下',
    };

    if (world.activeElectronCount > 0) {
      return {
        badge: '贴壁滑行',
        message: '注意看：宏电子接触银青色金属导流壁时不会碎裂，而是沿金属表面自动向右滑行！',
        highlight: null,
        ghosts: [],
      };
    }
    if (Math.abs(angleDiff(world.emitterAngle, aimAngle)) > 0.25) {
      return {
        badge: '步骤 1/3',
        message: '按住左下角【雷球发生器】的白点向上拖拽，让青色虚线斜着打到上方银青色金属导流壁。',
        highlight: null,
        ghosts: [gAim, gDef],
      };
    }
    if (!hasDeviceNear(world, 'deflector', 705, 150, 95)) {
      return {
        badge: '步骤 2/3',
        message: '点击底部【磁偏转器】，放置到导流壁右侧出口处（虚影圈），箭头垂直朝下指向引雷针与主机。',
        highlight: 'tool:deflector',
        ghosts: [gDef],
      };
    }
    return {
      badge: '步骤 3/3',
      message: '轨道已接通！点击【激发宏电子】或按 [F] 开始实验。',
      highlight: 'launch',
      ghosts: [gDef],
    };
  }

  // =========================================================================
  // EXP-03《双级磁透镜》
  // =========================================================================
  if (id === 'lvl-03') {
    const g1: GuideGhost = {
      kind: 'deflector',
      x: 200,
      y: 138,
      angleRad: Math.atan2(455 - 138, 300 - 200),
      label: '偏转 ①',
    };
    const g2: GuideGhost = {
      kind: 'deflector',
      x: 350,
      y: 525,
      angleRad: Math.atan2(176 - 525, 576 - 350),
      label: '偏转 ②',
    };
    const g3: GuideGhost = {
      kind: 'deflector',
      x: 645,
      y: 108,
      angleRad: Math.atan2(455 - 108, 838 - 645),
      label: '偏转 ③',
    };
    const count = world.devices.filter((d) => !d.fixed && d.kind === 'deflector').length;
    if (world.activeElectronCount > 0) {
      return {
        badge: '双重接力',
        message: '正在执行双引雷针电磁接力，观察寿命条两次充能跃升！',
        highlight: null,
        ghosts: [],
      };
    }
    if (count < 3) {
      return {
        badge: `步骤 ${count + 1}/4`,
        message: `点击【磁偏转器】依次布置第 ${count + 1} 个偏转器（可点右侧“虚影提示”查看 3 个建议坐标），串联两根引雷针。`,
        highlight: 'tool:deflector',
        ghosts: [g1, g2, g3],
      };
    }
    return {
      badge: '步骤 4/4',
      message: '确认预测虚线绕过双隔墙并指向右下主机，按 [F] 激发！',
      highlight: 'launch',
      ghosts: [g1, g2, g3],
    };
  }

  // =========================================================================
  // EXP-04《外科手术》
  // =========================================================================
  if (id === 'lvl-04') {
    const doorAlive = !world.walls.find((w) => w.id === 'w4-door')?.destroyed;
    if (world.activeElectronCount > 0) {
      return {
        badge: '选择性共振',
        message: '观察宏电子无害穿透异频的高爆燃料桶，仅气化与其频段一致的物质！',
        highlight: null,
        ghosts: [],
      };
    }
    if (doorAlive) {
      if (world.selectedSpectrum !== 'delta') {
        return {
          badge: '步骤 1/4',
          message: '前方钢制重门标有 [δ]！先点击底部黄色【δ 结构金属】频段（快捷键 3），它不会引爆油桶。',
          highlight: 'spec:delta',
          ghosts: [],
        };
      }
      return {
        badge: '步骤 2/4',
        message: '保持直线瞄准，按 [F] 或点击【激发宏电子】——它将无害穿过燃料桶并精准气化钢制重门！',
        highlight: 'launch',
        ghosts: [],
      };
    }
    if (world.selectedSpectrum !== 'alpha') {
      return {
        badge: '步骤 3/4',
        message: '钢门已开！现在切回底部青色【α 硅基电子】（快捷键 1），只烧毁导弹车火控芯片，切勿选 β 炸伤科研员！',
        highlight: 'spec:alpha',
        ghosts: [],
      };
    }
    return {
      badge: '步骤 4/4',
      message: '频段已就绪！按 [F] 发射第 2 颗宏电子，外科手术般瘫痪导弹车火控系统！',
      highlight: 'launch',
      ghosts: [],
    };
  }

  // =========================================================================
  // EXP-05《链式殉爆》
  // =========================================================================
  if (id === 'lvl-05') {
    if (world.selectedSpectrum !== 'beta') {
      return {
        badge: '步骤 1/2',
        message: '掩体挡住了直射路线！点击底部橙色【β 含能高燃】（快捷键 2），利用燃料桶连锁爆炸隔山打牛。',
        highlight: 'spec:beta',
        ghosts: [],
      };
    }
    return {
      badge: '步骤 2/2',
      message: '已切换至 β 频段，直接按 [F] 激发点燃 1 号燃料桶，引发三连殉爆摧毁掩体后主机！',
      highlight: 'launch',
      ghosts: [],
    };
  }

  // =========================================================================
  // EXP-06《伦理红线》
  // =========================================================================
  if (id === 'lvl-06') {
    if (world.selectedSpectrum !== 'gamma') {
      return {
        badge: '步骤 1/2',
        message: '前后分别是受保护的数据库 [α] 与燃料罐 [β]！切换至紫色【γ 碳基有机】（快捷键 4）跳过一切设备。',
        highlight: 'spec:gamma',
        ghosts: [],
      };
    }
    return {
      badge: '步骤 2/2',
      message: '按 [F] 激发 γ 频段球状闪电：它将无害穿过机密数据库，仅气化中间目标！',
      highlight: 'launch',
      ghosts: [],
    };
  }

  // =========================================================================
  // EXP-07《看不见的房间》（核心观察者效应教学）
  // =========================================================================
  if (id === 'lvl-07') {
    const e = world.electron;
    if (e && e.alive && e.mode === 'cloud') {
      const psi = world.getTargetMaxPsi();
      if (psi >= 0.2) {
        return {
          badge: '步骤 4/4 · 坍缩!',
          message: `目标概率幅已达 ${Math.round(psi * 100)}%！立即按 [O] 或点底部【己方观测】，光线穿过防弹玻璃瞬间坍缩引爆！`,
          highlight: 'obs',
          ghosts: [],
        };
      }
      return {
        badge: '步骤 3/4 · 穿墙中',
        message: '保持黑暗！幽蓝概率云正在穿透混凝土实墙向密室主站弥散，待右侧 Ψ 超过 25% 即可开灯坍缩…',
        highlight: null,
        ghosts: [],
      };
    }
    if (world.playerObserversEnabled) {
      return {
        badge: '步骤 1/4 · 关灯',
        message: '墙体挡住了经典态雷球！先按 [O] 或点击底部绿色【己方观测】关闭己方灯光（注意右上角浮现的蓝玫瑰）。',
        highlight: 'obs',
        ghosts: [],
      };
    }
    const corridorLit =
      world.isPointObserved(221, 260) || world.isPointObserved(315, 260);
    if (corridorLit) {
      return {
        badge: '步骤 2/4 · 等窗口',
        message: '稍等 1~2 秒，待左侧红色敌方探照灯向右上方转开、通道变暗的瞬间再发射！',
        highlight: null,
        ghosts: [],
      };
    }
    return {
      badge: '步骤 2/4 · 激发!',
      message: '通道已完全陷入黑暗！立即按 [F] 或点【激发宏电子】，让它化为量子概率云穿透实墙！',
      highlight: 'launch',
      ghosts: [],
    };
  }

  // =========================================================================
  // EXP-08《阴影幕布》
  // =========================================================================
  if (id === 'lvl-08') {
    const gScr: GuideGhost = {
      kind: 'screen',
      x: 295,
      y: 130,
      angleRad: Math.PI / 2,
      label: '横置挡住敌灯',
    };
    const e = world.electron;
    if (e && e.alive && e.mode === 'cloud') {
      const psi = world.getTargetMaxPsi();
      if (psi >= 0.2) {
        return {
          badge: '步骤 4/4 · 坍缩!',
          message: `目标已被覆盖 (${Math.round(psi * 100)}%)！按 [O] 开启窗外信标瞬间坍缩主站！`,
          highlight: 'obs',
          ghosts: [],
        };
      }
      return {
        badge: '步骤 3/4 · 穿墙中',
        message: '概率云已沿着阴影走廊穿透实墙，等待其覆及密室中央主站…',
        highlight: null,
        ghosts: [],
      };
    }
    const hasScreen = world.devices.some((d) => d.kind === 'screen');
    if (!hasScreen) {
      return {
        badge: '步骤 1/4',
        message: '敌方固定红灯永不熄灭！点击底部【遮蔽幕】，放到上方敌方红灯正下方（虚影处）截断红色光锥！',
        highlight: 'tool:screen',
        ghosts: [gScr],
      };
    }
    if (world.playerObserversEnabled) {
      return {
        badge: '步骤 2/4',
        message: '阴影走廊已切出！现在按 [O] 关闭己方灯光（包括密室窗外灯），准备量子穿墙。',
        highlight: 'obs',
        ghosts: [gScr],
      };
    }
    return {
      badge: '步骤 3/4',
      message: '按 [F] 在阴影里激发宏电子，穿过实墙后再按 [O] 开灯坍缩！',
      highlight: 'launch',
      ghosts: [gScr],
    };
  }

  // =========================================================================
  // EXP-09《双室透视》
  // =========================================================================
  if (id === 'lvl-09') {
    const aAlive = !world.entities.find((x) => x.id === 'jammer-09a')?.destroyed;
    const targetX = aAlive ? 446 : 626;
    const gBeacon: GuideGhost = {
      kind: 'beacon',
      x: targetX,
      y: 480,
      angleRad: -Math.PI / 2,
      label: aAlive ? '先照 A 室玻璃' : '拖至 B 室玻璃',
    };
    const e = world.electron;
    if (e && e.alive && e.mode === 'cloud') {
      const psi = world.getTargetMaxPsi();
      if (psi >= 0.22) {
        return {
          badge: '坍缩时机!',
          message: `概率云已覆盖${aAlive ? ' A 室' : ' B 室'}主站！按 [O] 开启便携信标立即坍缩！`,
          highlight: 'obs',
          ghosts: [gBeacon],
        };
      }
      return {
        badge: '穿墙渗透中',
        message: `保持黑暗，等待概率云穿墙覆盖${aAlive ? ' A 室' : '更深处的 B 室'}目标主站…`,
        highlight: null,
        ghosts: [gBeacon],
      };
    }
    const hasBeacon = world.devices.some((d) => d.kind === 'beacon');
    if (!hasBeacon) {
      return {
        badge: '步骤 1/3',
        message: '点击底部【观测信标】，先放到 A 室防弹玻璃外下方（绿色虚影处），随后按 [O] 关灯发射穿墙。',
        highlight: 'tool:beacon',
        ghosts: [gBeacon],
      };
    }
    if (!aAlive && !hasDeviceNear(world, 'beacon', 626, 480, 95)) {
      return {
        badge: '阶段 2',
        message: 'A 室已摧毁！按住便携信标拖到右侧 B 室玻璃外下方，关灯再发第 2 颗穿透两层墙体！',
        highlight: null,
        ghosts: [gBeacon],
      };
    }
    if (world.playerObserversEnabled) {
      return {
        badge: '关灯准备',
        message: '先按 [O] 关闭己方全部观测灯，才能让宏电子化作概率云穿墙。',
        highlight: 'obs',
        ghosts: [gBeacon],
      };
    }
    return {
      badge: '激发穿墙',
      message: `暗区已就绪！按 [F] 激发穿墙覆盖${aAlive ? ' A 室' : ' B 室'}，再按 [O] 开启信标坍缩。`,
      highlight: 'launch',
      ghosts: [gBeacon],
    };
  }

  // =========================================================================
  // EXP-10《盲区借道》
  // =========================================================================
  if (id === 'lvl-10') {
    const camAlive = !world.entities.find((x) => x.id === 'cam-10')?.destroyed;
    const camAngle = Math.atan2(120 - 270, 308 - 185);
    if (camAlive) {
      const gAim: GuideGhost = {
        kind: 'aim',
        x: world.emitterX,
        y: world.emitterY,
        angleRad: camAngle,
        label: '先打监控探头',
      };
      if (Math.abs(angleDiff(world.emitterAngle, camAngle)) > 0.2) {
        return {
          badge: '步骤 1/3',
          message: '拖动发生器向上瞄准上方红色【敌方监控探头】[α]，用经典态球状闪电直接烧毁它以永久熄灭红光！',
          highlight: null,
          ghosts: [gAim],
        };
      }
      return {
        badge: '步骤 1/3',
        message: '已锁定敌方监控探头！按 [F] 激发将其烧毁，走廊将彻底转入盲区。',
        highlight: 'launch',
        ghosts: [gAim],
      };
    }
    const e = world.electron;
    if (e && e.alive && e.mode === 'cloud') {
      const psi = world.getTargetMaxPsi();
      if (psi >= 0.2) {
        return {
          badge: '步骤 3/3 · 坍缩!',
          message: '概率云已笼罩核控主站！按 [O] 开启窗外信标完成坍缩！',
          highlight: 'obs',
          ghosts: [],
        };
      }
      return {
        badge: '穿墙中',
        message: '等待概率云穿过混凝土实墙覆盖密室主站…',
        highlight: null,
        ghosts: [],
      };
    }
    if (world.playerObserversEnabled) {
      return {
        badge: '步骤 2/3',
        message: '敌灯已永久熄灭！把发生器拖回水平朝右，并按 [O] 关闭己方灯光。',
        highlight: 'obs',
        ghosts: [],
      };
    }
    return {
      badge: '步骤 2/3',
      message: '按 [F] 朝右侧密室激发穿墙，随后按 [O] 开灯坍缩！',
      highlight: 'launch',
      ghosts: [],
    };
  }

  // =========================================================================
  // EXP-11《宏聚变协议》
  // =========================================================================
  if (id === 'lvl-11') {
    const gFlip: GuideGhost = {
      kind: 'deflector',
      x: 605,
      y: 300,
      angleRad: Math.PI,
      label: '箭头朝左 180° 折返',
    };
    const hasFlip = world.devices.some((d) => d.kind === 'deflector');
    if (!hasFlip) {
      return {
        badge: '步骤 1/3 · 布设折返点',
        message: '仅 2 颗宏电子却要拆 3 座密室！点击【磁偏转器】放到中央虚影处，把箭头朝正左 (180°) 让第 1 颗球原路折返！',
        highlight: 'tool:deflector',
        ghosts: [gFlip],
      };
    }
    if (world.activeElectronCount === 0) {
      return {
        badge: '步骤 2/3 · 发第 1 颗',
        message: '先按 [F] 发射第 1 颗宏电子，准备间隔约 0.5 秒后再发第 2 颗让它们在三间密室中央迎面相撞！',
        highlight: 'launch',
        ghosts: [gFlip],
      };
    }
    if (world.activeElectronCount === 1 && world.remainingAmmo > 0) {
      return {
        badge: '步骤 3/3 · 耦合聚变!',
        message: '立即再按 [F] 发射第 2 颗宏电子！两球在中央迎面相撞将引爆半径 250px 隔墙宏聚变脉冲！',
        highlight: 'launch',
        ghosts: [],
      };
    }
    return {
      badge: '双球耦合中',
      message: '两颗宏电子正在逼近中央共振区，即将爆发无视实墙的宏聚变脉冲！',
      highlight: null,
      ghosts: [],
    };
  }

  // =========================================================================
  // EXP-12《蓝玫瑰的观测》
  // =========================================================================
  if (id === 'lvl-12') {
    const e = world.electron;
    if (e && e.alive && e.mode === 'cloud') {
      const psi = world.getTargetMaxPsi();
      if (psi >= 0.2) {
        return {
          badge: '终局坍缩!',
          message: '终极微核控制中枢已被概率云笼罩！按下 [O] 开启观测，完成最后一击！',
          highlight: 'obs',
          ghosts: [],
        };
      }
      return {
        badge: '量子渗透中',
        message: '蓝玫瑰正替你压制着敌方强光锁！等待概率云穿透隔离壁覆及终极控制中枢…',
        highlight: null,
        ghosts: [],
      };
    }
    if (world.playerObserversEnabled) {
      return {
        badge: '步骤 1/3 · 闭上眼睛',
        message: '没有遮蔽幕也没关系——按 [O] 彻底关闭全部己方灯光，让密室暗处的「Ψ 蓝玫瑰」显化并替你压制敌方强灯！',
        highlight: 'obs',
        ghosts: [],
      };
    }
    return {
      badge: '步骤 2/3 · 最后的激发',
      message: '奇迹发生了：蓝玫瑰在黑暗中熄灭了敌方强光锁！立即按 [F] 激发穿墙，覆盖中枢后再按 [O] 坍缩！',
      highlight: 'launch',
      ghosts: [],
    };
  }

  return null;
}
