import { describe, expect, it } from 'vitest';
import { SimulationWorld } from './World';
import { LEVELS } from '../levels/levels';
import { FIXED_DT } from './types';

function runSteps(world: SimulationWorld, seconds: number): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    world.step(FIXED_DT);
    if (world.status !== 'playing') break;
  }
}

describe('《代号：宏电子》核心物理与 3 关 Demo 通关验证', () => {
  it('关卡 01《空泡与偏转》：直线发射撞墙失败，使用 2 个磁偏转器经过引雷针续能可 100% 通关', () => {
    // 1. 直接发射会撞上中央隔墙退激
    const wFail = new SimulationWorld(LEVELS[0]);
    expect(wFail.launchElectron()).toBe(true);
    runSteps(wFail, 3.0);
    expect(wFail.electron?.alive).toBe(false);
    expect(wFail.status).toBe('playing'); // 还有剩余弹药

    // 2. 标准解法：放置 2 个超导磁偏转器，引导经过下方引雷针 (372, 446) 充能并指向目标主机 (805, 190)
    const wWin = new SimulationWorld(LEVELS[0]);
    const angle1 = Math.atan2(446 - 210, 372 - 245);
    const d1 = wWin.placeDevice('deflector', 245, 210, angle1);
    expect(d1).not.toBeNull();

    // 经过引雷针 (372, 446) 充能后，在右下方 (435, 525) 放第 2 个偏转器指向目标主机 (805, 190)
    const angle2 = Math.atan2(190 - 525, 805 - 435);
    const d2 = wWin.placeDevice('deflector', 435, 525, angle2);
    expect(d2).not.toBeNull();

    expect(wWin.launchElectron()).toBe(true);
    runSteps(wWin, 8.0);
    expect(wWin.status).toBe('victory');
    expect(wWin.entities[0].destroyed).toBe(true);
  });

  it('关卡 02《外科手术》：误用 β 引爆油桶炸毁黑匣子即失败；先 δ 破门再 α 瘫痪导弹车零伤通关', () => {
    // 1. 错误示范：直接用 β 频段引爆挡路油桶 -> 波及黑匣子失败
    const wFail = new SimulationWorld(LEVELS[1]);
    expect(wFail.setSpectrum('beta')).toBe(true);
    expect(wFail.launchElectron()).toBe(true);
    runSteps(wFail, 3.0);
    expect(wFail.status).toBe('failed');
    const blackbox = wFail.entities.find((e) => e.id === 'blackbox-01');
    expect(blackbox?.destroyed).toBe(true);

    // 2. 正确解法：第 1 发 δ 穿透油桶融化钢门，第 2 发 α 穿透油桶烧毁导弹车火控芯片
    const wWin = new SimulationWorld(LEVELS[1]);
    expect(wWin.setSpectrum('delta')).toBe(true);
    expect(wWin.launchElectron()).toBe(true);
    runSteps(wWin, 3.5);

    const door = wWin.walls.find((w) => w.id === 'w2-door');
    expect(door?.destroyed).toBe(true);
    expect(wWin.status).toBe('playing');

    // 第 2 发切回 α 频段
    expect(wWin.setSpectrum('alpha')).toBe(true);
    expect(wWin.launchElectron()).toBe(true);
    runSteps(wWin, 5.0);

    expect(wWin.status).toBe('victory');
    const truck = wWin.entities.find((e) => e.id === 'missile-01');
    const sci = wWin.entities.find((e) => e.id === 'sci-01');
    const bb = wWin.entities.find((e) => e.id === 'blackbox-01');
    expect(truck?.disabled).toBe(true);
    expect(truck?.remainingMaterials).toEqual(['delta', 'beta']); // 只烧毁了 alpha 层！
    expect(sci?.destroyed).toBe(false);
    expect(bb?.destroyed).toBe(false);
  });

  it('关卡 03《看不见的房间》：开灯直发射被墙阻挡；关灯避开探照灯穿墙成概率云再开窗外信标定向坍缩通关', () => {
    // 1. 开灯发射保持经典态，撞密室混凝土实墙失败
    const wBlocked = new SimulationWorld(LEVELS[2]);
    expect(wBlocked.launchElectron()).toBe(true);
    runSteps(wBlocked, 3.0);
    expect(wBlocked.electron?.alive).toBe(false);
    expect(wBlocked.status).toBe('playing');

    // 2. 正确解法：关闭己方观测 -> 避开探照灯窗口发射进入概率云 -> 穿墙覆盖密室主站 -> 打开观测信标定向坍缩！
    const wWin = new SimulationWorld(LEVELS[2]);
    wWin.setPlayerObserversActive(false);

    // 等待探照灯摆向右上密室墙顶方向（离开走廊通道），打开清晰的量子渗透窗口
    wWin.paused = false;
    let safeWindowFound = false;
    for (let i = 0; i < 900; i++) {
      wWin.step(FIXED_DT);
      const patrol = wWin.observers.find((o) => o.id === 'obs-patrol');
      if (
        patrol &&
        patrol.angleRad < 0.72 &&
        !wWin.isPointObserved(221, 260) &&
        !wWin.isPointObserved(315, 260)
      ) {
        safeWindowFound = true;
        break;
      }
    }
    expect(safeWindowFound).toBe(true);

    // 激发宏电子，立即进入概率云
    expect(wWin.launchElectron()).toBe(true);
    expect(wWin.electron?.mode).toBe('cloud');

    // 让概率云穿过混凝土实墙并弥散覆盖密室内干扰主站 (668, 256)
    let reachedTarget = false;
    for (let i = 0; i < 360; i++) {
      wWin.step(FIXED_DT);
      if (wWin.getTargetMaxPsi() >= 0.25) {
        reachedTarget = true;
        break;
      }
    }
    expect(reachedTarget).toBe(true);

    // 此时开启窗外主动观测信标，波函数透过防弹玻璃在干扰主站处瞬间坍缩！
    expect(wWin.toggleSingleObserver('obs-window')).toBe(true);
    runSteps(wWin, 0.5);

    expect(wWin.status).toBe('victory');
    const jammer = wWin.entities.find((e) => e.id === 'jammer-01');
    expect(jammer?.destroyed).toBe(true);
  });
});
