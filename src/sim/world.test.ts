import { describe, expect, it } from 'vitest';
import { SimulationWorld } from './World';
import { LEVELS } from '../levels/levels';
import { FIXED_DT } from './types';

function byId(id: string) {
  const lvl = LEVELS.find((l) => l.id === id);
  if (!lvl) throw new Error(`Level ${id} not found`);
  return lvl;
}

function runSteps(world: SimulationWorld, seconds: number): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    world.step(FIXED_DT);
    if (world.status !== 'playing') break;
  }
}

describe('《代号：宏电子》完整四幕 12 关物理与通关全链路自动化验证', () => {
  // === 第一幕：泰山与空泡实验室 ===
  it('EXP-01《空泡与偏转》：直线撞墙失败；2 偏转器经引雷针续能通关', () => {
    const wFail = new SimulationWorld(byId('lvl-01'));
    expect(wFail.launchElectron()).toBe(true);
    runSteps(wFail, 3.0);
    expect(wFail.activeElectronCount).toBe(0);
    expect(wFail.status).toBe('playing');

    const wWin = new SimulationWorld(byId('lvl-01'));
    wWin.placeDevice('deflector', 245, 210, Math.atan2(446 - 210, 372 - 245));
    wWin.placeDevice('deflector', 435, 525, Math.atan2(190 - 525, 805 - 435));
    expect(wWin.launchElectron()).toBe(true);
    runSteps(wWin, 8.0);
    expect(wWin.status).toBe('victory');
  });

  it('EXP-02《金属导流壁》：沿导电金属壁贴壁滑行 + 1 偏转器过引雷针通关', () => {
    const w = new SimulationWorld(byId('lvl-02'));
    // 瞄准金属导流壁左侧下表面 (285, 142)
    w.setEmitterAngle(Math.atan2(142 - 455, 285 - 105));
    // 右侧出口放置 1 个向下偏转器，导向引雷针 (705, 300) 和目标 (705, 470)
    w.placeDevice('deflector', 705, 150, Math.PI / 2);
    expect(w.launchElectron()).toBe(true);
    runSteps(w, 8.0);
    expect(w.status).toBe('victory');
  });

  it('EXP-03《双级磁透镜》：3 偏转器串联双高压引雷针接力通关', () => {
    const w = new SimulationWorld(byId('lvl-03'));
    // 第 1 个偏转器在 (200, 138) 指向引雷针 1 (300, 455)
    w.placeDevice('deflector', 200, 138, Math.atan2(455 - 138, 300 - 200));
    // 经引雷针 1 充能后飞到下方 (350, 525)，用第 2 个偏转器折向右上引雷针 2 (576, 176)
    w.placeDevice('deflector', 350, 525, Math.atan2(176 - 525, 576 - 350));
    // 经引雷针 2 充能后飞到右上方 (645, 108)，用第 3 个偏转器指向右下目标 (838, 455)
    w.placeDevice('deflector', 645, 108, Math.atan2(455 - 108, 838 - 645));
    expect(w.launchElectron()).toBe(true);
    runSteps(w, 10.0);
    expect(w.status).toBe('victory');
  });

  // === 第二幕：619 武器化靶场 ===
  it('EXP-04《外科手术》：误用 β 炸毁黑匣子失败；δ 破门 → α 瘫痪导弹车零伤通关', () => {
    const wFail = new SimulationWorld(byId('lvl-04'));
    wFail.setSpectrum('beta');
    wFail.launchElectron();
    runSteps(wFail, 3.0);
    expect(wFail.status).toBe('failed');

    const wWin = new SimulationWorld(byId('lvl-04'));
    wWin.setSpectrum('delta');
    wWin.launchElectron();
    runSteps(wWin, 3.5);
    expect(wWin.walls.find((x) => x.id === 'w4-door')?.destroyed).toBe(true);

    wWin.setSpectrum('alpha');
    wWin.launchElectron();
    runSteps(wWin, 5.0);
    expect(wWin.status).toBe('victory');
  });

  it('EXP-05《链式殉爆》：1 发 β 触发三连油桶殉爆隔掩体摧毁核心主机并保全黑匣子', () => {
    const w = new SimulationWorld(byId('lvl-05'));
    expect(w.setSpectrum('beta')).toBe(true);
    expect(w.launchElectron()).toBe(true);
    runSteps(w, 4.0);
    expect(w.status).toBe('victory');
    expect(w.entities.find((e) => e.id === 'blackbox-05')?.destroyed).toBe(false);
  });

  it('EXP-06《伦理红线》：γ 碳基频段无害穿透保护主机并精准抹除指令官，燃料罐完好', () => {
    const wFail = new SimulationWorld(byId('lvl-06'));
    wFail.setSpectrum('alpha');
    wFail.launchElectron();
    runSteps(wFail, 4.0);
    expect(wFail.status).toBe('failed');

    const wWin = new SimulationWorld(byId('lvl-06'));
    expect(wWin.setSpectrum('gamma')).toBe(true);
    expect(wWin.launchElectron()).toBe(true);
    runSteps(wWin, 5.0);
    expect(wWin.status).toBe('victory');
    expect(wWin.entities.find((e) => e.id === 'srv-06-prot')?.destroyed).toBe(false);
    expect(wWin.entities.find((e) => e.id === 'fuel-06-prot')?.destroyed).toBe(false);
  });

  // === 第三幕：暗室观测者 ===
  it('EXP-07《看不见的房间》：开灯撞墙；关灯避探照灯量子穿墙再开窗外信标坍缩通关', () => {
    const wBlocked = new SimulationWorld(byId('lvl-07'));
    wBlocked.launchElectron();
    runSteps(wBlocked, 3.0);
    expect(wBlocked.activeElectronCount).toBe(0);

    const wWin = new SimulationWorld(byId('lvl-07'));
    wWin.setPlayerObserversActive(false);
    wWin.paused = false;
    for (let i = 0; i < 900; i++) {
      wWin.step(FIXED_DT);
      const patrol = wWin.observers.find((o) => o.id === 'obs-patrol');
      if (patrol && patrol.angleRad < 0.72 && !wWin.isPointObserved(221, 260)) break;
    }
    expect(wWin.launchElectron()).toBe(true);
    expect(wWin.electron?.mode).toBe('cloud');

    for (let i = 0; i < 360; i++) {
      wWin.step(FIXED_DT);
      if (wWin.getTargetMaxPsi() >= 0.25) break;
    }
    expect(wWin.toggleSingleObserver('obs-window')).toBe(true);
    runSteps(wWin, 0.5);
    expect(wWin.status).toBe('victory');
  });

  it('EXP-08《阴影幕布》：架设光学遮蔽幕挡住敌方固定强光，在阴影走廊穿墙坍缩通关', () => {
    const w = new SimulationWorld(byId('lvl-08'));
    // 横置一块光学遮蔽幕（法线朝下 Math.PI/2 -> 水平板）在敌方强光探头 (295, 68) 正下方挡住光锥
    const scr = w.placeDevice('screen', 295, 130, Math.PI / 2);
    expect(scr).not.toBeNull();
    w.setPlayerObserversActive(false);

    // 确认遮蔽幕成功在走廊下方切出暗区
    expect(w.isPointObserved(211, 270)).toBe(false);
    expect(w.isPointObserved(310, 270)).toBe(false);

    expect(w.launchElectron()).toBe(true);
    expect(w.electron?.mode).toBe('cloud');

    for (let i = 0; i < 360; i++) {
      w.step(FIXED_DT);
      if (w.getTargetMaxPsi() >= 0.25) break;
    }
    w.toggleSingleObserver('obs-window-08');
    runSteps(w, 0.5);
    expect(w.status).toBe('victory');
  });

  it('EXP-09《双室透视》：单台便携观测信标分两阶段移位照亮 A/B 双密室通关', () => {
    const w = new SimulationWorld(byId('lvl-09'));
    // 放置便携信标至 A 室玻璃外 (446, 480) 朝正上，并先关闭己方观测
    const beacon = w.placeDevice('beacon', 446, 480, -Math.PI / 2);
    expect(beacon).not.toBeNull();
    w.setPlayerObserversActive(false);

    // 第 1 发渗入 A 室
    expect(w.launchElectron()).toBe(true);
    for (let i = 0; i < 300; i++) {
      w.step(FIXED_DT);
      if (w.getTargetMaxPsi() >= 0.3) break;
    }
    w.setPlayerObserversActive(true);
    runSteps(w, 0.3);
    expect(w.entities.find((e) => e.id === 'jammer-09a')?.destroyed).toBe(true);

    // 第 2 阶段：关灯并将便携信标拖至 B 室玻璃外 (626, 480)
    w.setPlayerObserversActive(false);
    w.moveDevice(beacon!.id, 626, 480);

    expect(w.launchElectron()).toBe(true);
    for (let i = 0; i < 420; i++) {
      w.step(FIXED_DT);
      if (w.getTargetMaxPsi() >= 0.25) break;
    }
    w.setPlayerObserversActive(true);
    runSteps(w, 0.3);
    expect(w.status).toBe('victory');
  });

  it('EXP-10《盲区借道》：第 1 发 α 烧毁敌方监控探头熄灭红光，第 2 发量子穿墙通关', () => {
    const w = new SimulationWorld(byId('lvl-10'));
    // 第 1 发向上瞄准敌方监控探头 (308, 120) 并摧毁它
    w.setEmitterAngle(Math.atan2(120 - 270, 308 - 185));
    expect(w.launchElectron()).toBe(true);
    runSteps(w, 2.5);
    expect(w.entities.find((e) => e.id === 'cam-10')?.destroyed).toBe(true);
    expect(w.observers.find((o) => o.id === 'obs-cam-10')?.permanentlyDisabled).toBe(true);

    // 第 2 发关己方灯、向右平射进入暗区穿墙
    w.setPlayerObserversActive(false);
    w.setEmitterAngle(0);
    expect(w.launchElectron()).toBe(true);
    expect(w.electron?.mode).toBe('cloud');

    for (let i = 0; i < 360; i++) {
      w.step(FIXED_DT);
      if (w.getTargetMaxPsi() >= 0.25) break;
    }
    w.toggleSingleObserver('obs-window-10');
    runSteps(w, 0.4);
    expect(w.status).toBe('victory');
  });

  // === 第四幕：珠峰微核与芯片危机 ===
  it('EXP-11《宏聚变协议》：2 发宏电子在三间封闭密室中央迎面耦合爆发宏聚变，瞬间清空 3 座阵列', () => {
    const w = new SimulationWorld(byId('lvl-11'));
    // 在中央偏右 (605, 300) 放一个向左折返的偏转器 (angle = PI)
    w.placeDevice('deflector', 605, 300, Math.PI);

    // 发射第 1 发，等 0.45s 发射第 2 发，使两球在中央 (560~610, 300) 迎面耦合触发宏聚变
    expect(w.launchElectron()).toBe(true);
    runSteps(w, 0.45);
    expect(w.launchElectron()).toBe(true);

    runSteps(w, 4.5);
    expect(w.status).toBe('victory');
    expect(w.entities.every((e) => e.destroyed)).toBe(true);
  });

  it('EXP-12《蓝玫瑰的观测》：关闭全部己方观测唤醒蓝玫瑰量子幽灵压制敌方强灯，穿墙定向坍缩通关', () => {
    const w = new SimulationWorld(byId('lvl-12'));
    // 初始开灯状态：蓝玫瑰被窗外灯照亮未显化，敌方强灯开启
    expect(w.entities.find((e) => e.id === 'rose-12')?.ghostActive).toBe(false);
    expect(w.observers.find((o) => o.id === 'obs-boss-12')?.suppressedByGhost).toBe(false);

    // 按 [O] 关闭全部己方观测 -> 蓝玫瑰在暗室显化并压制熄灭走廊敌方强光锁！
    w.setPlayerObserversActive(false);
    expect(w.entities.find((e) => e.id === 'rose-12')?.ghostActive).toBe(true);
    expect(w.observers.find((o) => o.id === 'obs-boss-12')?.suppressedByGhost).toBe(true);
    expect(w.isPointObserved(211, 275)).toBe(false);

    // 发射穿墙
    expect(w.launchElectron()).toBe(true);
    expect(w.electron?.mode).toBe('cloud');

    for (let i = 0; i < 360; i++) {
      w.step(FIXED_DT);
      if (w.getTargetMaxPsi() >= 0.25) break;
    }

    // 开启观测完成终局坍缩！
    w.setPlayerObserversActive(true);
    runSteps(w, 0.4);
    expect(w.status).toBe('victory');
    expect(w.entities.find((e) => e.id === 'core-12')?.destroyed).toBe(true);
  });
});
