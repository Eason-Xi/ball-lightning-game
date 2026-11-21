import './style.css';
import { LEVELS } from './levels/levels';
import { SimulationWorld } from './sim/World';
import {
  DeviceKind,
  FIXED_DT,
  SPECTRUM_META,
  SpectrumType,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './sim/types';
import { dist } from './sim/geometry';
import { BlueprintRenderer, RenderUIState } from './render/BlueprintRenderer';
import { SoundSynth } from './render/SoundSynth';

// DOM 引用
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const stageShell = document.querySelector('.stage-shell') as HTMLElement;
const levelTabsEl = document.getElementById('levelTabs') as HTMLElement;
const levelTitleEl = document.getElementById('levelTitle') as HTMLElement;
const levelBriefEl = document.getElementById('levelBrief') as HTMLElement;
const ammoDisplayEl = document.getElementById('ammoDisplay') as HTMLElement;
const objectiveListEl = document.getElementById('objectiveList') as HTMLElement;
const stabilityBarEl = document.getElementById('stabilityBar') as HTMLElement;
const stabilityNumEl = document.getElementById('stabilityNum') as HTMLElement;
const psiBarEl = document.getElementById('psiBar') as HTMLElement;
const psiNumEl = document.getElementById('psiNum') as HTMLElement;
const hintBoxEl = document.getElementById('hintBox') as HTMLElement;
const eventLogEl = document.getElementById('eventLog') as HTMLElement;

const spectrumBarEl = document.getElementById('spectrumBar') as HTMLElement;
const toolBarEl = document.getElementById('toolBar') as HTMLElement;
const btnToggleObs = document.getElementById('btnToggleObs') as HTMLButtonElement;
const btnToggleObsText = document.getElementById('btnToggleObsText') as HTMLElement;
const btnPause = document.getElementById('btnPause') as HTMLButtonElement;
const btnLaunch = document.getElementById('btnLaunch') as HTMLButtonElement;
const btnBlueprint = document.getElementById('btnBlueprint') as HTMLButtonElement;
const btnAudio = document.getElementById('btnAudio') as HTMLButtonElement;
const btnReset = document.getElementById('btnReset') as HTMLButtonElement;

const simStatePill = document.getElementById('simStatePill') as HTMLElement;
const simStateText = document.getElementById('simStateText') as HTMLElement;
const quantumStateVal = document.getElementById('quantumStateVal') as HTMLElement;
const toastBanner = document.getElementById('toastBanner') as HTMLElement;

const resultModal = document.getElementById('resultModal') as HTMLElement;
const resultCard = resultModal.querySelector('.result-card') as HTMLElement;
const resultKicker = document.getElementById('resultKicker') as HTMLElement;
const resultTitle = document.getElementById('resultTitle') as HTMLElement;
const resultDesc = document.getElementById('resultDesc') as HTMLElement;
const btnNextLevel = document.getElementById('btnNextLevel') as HTMLButtonElement;
const btnRetryModal = document.getElementById('btnRetryModal') as HTMLButtonElement;

// 状态与核心实例
const sound = new SoundSynth();
const renderer = new BlueprintRenderer(canvas);
const clearedLevelIds = new Set<string>();
let currentLevelIndex = 0;

let toastTimer: number | null = null;
function showToast(msg: string, warn = false): void {
  toastBanner.textContent = msg;
  toastBanner.classList.remove('hidden', 'warn');
  if (warn) toastBanner.classList.add('warn');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastBanner.classList.add('hidden');
  }, 3600);
}

const world = new SimulationWorld(LEVELS[0], {
  onLaunch: (spec) => sound.playLaunch(spec),
  onModeChange: (mode) => sound.startAmbientHum(mode),
  onCollapse: (_x, _y, hit) => sound.playCollapse(hit),
  onVaporize: (_spec, secondary) => sound.playVaporize(secondary),
  onCharge: () => sound.playCharge(),
  onFizzle: () => sound.playFizzle(),
  onObserverToggle: (active) => sound.playRelayClick(active),
  onToast: (msg, warn) => showToast(msg, Boolean(warn)),
});

const uiState: RenderUIState = {
  blueprintMode: false,
  selectedDeviceId: null,
  placementTool: null,
  mouseX: 0,
  mouseY: 0,
  isHoveringCanvas: false,
  visualTime: 0,
};

type DragMode =
  | { kind: 'none' }
  | { kind: 'aim_emitter' }
  | { kind: 'move_device'; deviceId: string }
  | { kind: 'rotate_device'; deviceId: string };

let dragMode: DragMode = { kind: 'none' };
let lastLogSignature = '';
let lastStatusShown: string = 'playing';

// 初始化 & 切换关卡
function selectLevel(index: number): void {
  currentLevelIndex = index;
  const spec = LEVELS[index];
  sound.stopAmbientHum();
  world.loadLevel(spec);

  // 含动态敌方巡逻探照灯的关卡默认直接进入实时光锥扫掠，方便玩家观察窗口
  if (spec.observers.some((o) => o.sweep)) {
    world.paused = false;
  }

  uiState.selectedDeviceId = null;
  uiState.placementTool = null;
  dragMode = { kind: 'none' };
  lastStatusShown = 'playing';
  resultModal.classList.add('hidden');

  renderLevelTabs();
  renderStaticLevelInfo();
  renderSpectrumBar();
  renderToolBar();
  syncDynamicUI();
}

function renderLevelTabs(): void {
  levelTabsEl.innerHTML = '';
  LEVELS.forEach((lvl, idx) => {
    const btn = document.createElement('button');
    btn.className = 'level-tab';
    if (idx === currentLevelIndex) btn.classList.add('active');
    if (clearedLevelIds.has(lvl.id)) btn.classList.add('cleared');
    btn.textContent = lvl.title;
    btn.addEventListener('click', () => selectLevel(idx));
    levelTabsEl.appendChild(btn);
  });
}

function renderStaticLevelInfo(): void {
  levelTitleEl.textContent = world.level.title;
  levelBriefEl.textContent = world.level.brief;
  hintBoxEl.textContent = world.level.hint;
}

function renderSpectrumBar(): void {
  spectrumBarEl.innerHTML = '';
  const allSpecs: SpectrumType[] = ['alpha', 'beta', 'delta', 'gamma'];
  allSpecs.forEach((spec, idx) => {
    const meta = SPECTRUM_META[spec];
    const allowed = world.level.allowedSpectrums.includes(spec);
    const btn = document.createElement('button');
    btn.className = 'spec-btn';
    btn.dataset.spec = spec;
    btn.disabled = !allowed;
    btn.title = `${meta.name}：${meta.desc} (快捷键 ${idx + 1})`;
    if (world.selectedSpectrum === spec) btn.classList.add('active');

    btn.innerHTML = `
      <span class="spec-dot" style="background:${meta.color}; box-shadow: 0 0 8px ${meta.color};"></span>
      <span>${meta.symbol} ${meta.shortName}</span>
    `;
    btn.addEventListener('click', () => {
      if (world.setSpectrum(spec)) {
        renderSpectrumBar();
      }
    });
    spectrumBarEl.appendChild(btn);
  });
}

function renderToolBar(): void {
  toolBarEl.innerHTML = '';
  const tools: { kind: DeviceKind; label: string; tip: string }[] = [
    {
      kind: 'deflector',
      label: '磁偏转器',
      tip: '点击画布部署，拖拽外侧圆点可旋转偏转方向，右键可回收',
    },
    {
      kind: 'attractor',
      label: '引雷针',
      tip: '强力吸附经典态宏电子并提供 +38% 能量续命',
    },
  ];

  for (const t of tools) {
    const count = world.inventory[t.kind];
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.title = t.tip;
    if (uiState.placementTool === t.kind) btn.classList.add('active');
    btn.disabled = count <= 0 && !world.level.isSandbox;

    const countText = world.level.isSandbox ? '∞' : `${count}`;
    btn.innerHTML = `<span>${t.label}</span><span class="tool-count">${countText}</span>`;
    btn.addEventListener('click', () => {
      uiState.placementTool = uiState.placementTool === t.kind ? null : t.kind;
      renderToolBar();
    });
    toolBarEl.appendChild(btn);
  }
}

function syncDynamicUI(): void {
  // 弹药显示
  ammoDisplayEl.textContent =
    world.remainingAmmo < 0
      ? '剩余宏电子: ∞'
      : `剩余宏电子: ${world.remainingAmmo}`;

  // 运行/时停徽章
  if (world.paused) {
    simStatePill.className = 'state-pill paused';
    simStateText.textContent = '战术推演中 · PAUSED';
    btnPause.classList.add('paused');
    btnPause.textContent = '继续演算 [Space]';
  } else {
    simStatePill.className = 'state-pill running';
    simStateText.textContent = '实时演算中 · LIVE';
    btnPause.classList.remove('paused');
    btnPause.textContent = '时停推演 [Space]';
  }

  // 宏电子状态指示
  const e = world.electron;
  if (!e || !e.alive) {
    quantumStateVal.textContent = '基态待激发';
    quantumStateVal.className = 'meter-value';
    stabilityBarEl.style.width = '100%';
    stabilityNumEl.textContent = '100%';
  } else if (e.mode === 'cloud') {
    quantumStateVal.textContent = '量子概率云 · 叠加穿墙';
    quantumStateVal.className = 'meter-value cloud';
    const pct = Math.max(0, Math.round(e.stability));
    stabilityBarEl.style.width = `${pct}%`;
    stabilityNumEl.textContent = `${pct}%`;
  } else {
    quantumStateVal.textContent = `经典粒子态 · ${SPECTRUM_META[e.spectrum].symbol}`;
    quantumStateVal.className = 'meter-value classical';
    const pct = Math.max(0, Math.round(e.stability));
    stabilityBarEl.style.width = `${pct}%`;
    stabilityNumEl.textContent = `${pct}%`;
  }

  // 目标区概率幅遥测
  const targetPsi = Math.round(world.getTargetMaxPsi() * 100);
  psiBarEl.style.width = `${targetPsi}%`;
  psiNumEl.textContent = `${targetPsi}%`;

  // 己方观测总开关按钮
  if (world.level.ambientObserved) {
    btnToggleObs.classList.remove('off');
    btnToggleObsText.textContent = '全明靶场 (常亮)';
    btnToggleObs.disabled = true;
  } else {
    btnToggleObs.disabled = false;
    if (world.playerObserversEnabled) {
      btnToggleObs.classList.remove('off');
      btnToggleObsText.textContent = '己方观测: 开启 [O]';
    } else {
      btnToggleObs.classList.add('off');
      btnToggleObsText.textContent = '己方观测: 切断 [O]';
    }
  }

  // 激发按钮禁用条件
  btnLaunch.disabled =
    world.status !== 'playing' ||
    (world.electron !== null && world.electron.alive) ||
    world.remainingAmmo === 0;

  // 目标清单
  const objStates = world.getObjectiveStates();
  objectiveListEl.innerHTML = '';
  if (objStates.length === 0) {
    const li = document.createElement('li');
    li.className = 'objective-item';
    li.textContent = '自由物理沙盒模式：任意测试频段共振、磁场导引与观测坍缩。';
    objectiveListEl.appendChild(li);
  } else {
    for (const o of objStates) {
      const li = document.createElement('li');
      li.className = 'objective-item';
      if (o.kind === 'protect') li.classList.add('constraint');
      if (o.violated) li.classList.add('violated');
      else if (o.done && o.kind === 'destroy_layer') li.classList.add('done');

      const icon = o.violated ? '✕' : o.kind === 'protect' ? '◈' : o.done ? '✓' : '○';
      li.innerHTML = `<span>${icon}</span><span>${o.text}</span>`;
      objectiveListEl.appendChild(li);
    }
  }

  // 日志列表（仅变更时重绘 DOM）
  const logSig = `${world.logs.length}_${world.logs[0]?.text ?? ''}`;
  if (logSig !== lastLogSignature) {
    lastLogSignature = logSig;
    eventLogEl.innerHTML = world.logs
      .slice(0, 14)
      .map(
        (item) =>
          `<div class="log-entry ${item.level}">[${item.time.toFixed(1)}s] ${item.text}</div>`
      )
      .join('');
  }

  // 结算弹窗判定
  if (world.status !== lastStatusShown && world.status !== 'playing') {
    lastStatusShown = world.status;
    sound.stopAmbientHum();
    resultModal.classList.remove('hidden');

    if (world.status === 'victory') {
      clearedLevelIds.add(world.level.id);
      renderLevelTabs();
      resultCard.classList.remove('failed');
      resultKicker.textContent = `${world.level.code} // EXPERIMENT VERIFIED`;
      resultTitle.textContent = '物理实验成功';
      resultDesc.textContent = world.statusReason;
      const hasNext = currentLevelIndex < LEVELS.length - 1;
      btnNextLevel.style.display = hasNext ? 'inline-block' : 'none';
    } else {
      resultCard.classList.add('failed');
      resultKicker.textContent = `${world.level.code} // CONTAINMENT BREACH`;
      resultTitle.textContent = '实验异常中止';
      resultDesc.textContent = world.statusReason;
      btnNextLevel.style.display = 'none';
    }
  }
}

// 坐标转换：屏幕坐标 -> 逻辑世界坐标 (960 x 600)
function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * WORLD_WIDTH,
    y: ((clientY - rect.top) / rect.height) * WORLD_HEIGHT,
  };
}

// 鼠标交互事件绑定
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button === 2) {
    // 右键快速回收可移动装置
    const pos = clientToWorld(ev.clientX, ev.clientY);
    for (const dev of world.devices) {
      if (!dev.fixed && dist(pos.x, pos.y, dev.x, dev.y) <= 28) {
        world.removeDevice(dev.id);
        if (uiState.selectedDeviceId === dev.id) uiState.selectedDeviceId = null;
        renderToolBar();
        return;
      }
    }
    uiState.placementTool = null;
    renderToolBar();
    return;
  }

  if (ev.button !== 0) return;
  const pos = clientToWorld(ev.clientX, ev.clientY);
  uiState.mouseX = pos.x;
  uiState.mouseY = pos.y;

  // 1. 放置工具激活态：直接放置装置
  if (uiState.placementTool) {
    const placed = world.placeDevice(uiState.placementTool, pos.x, pos.y, 0);
    if (placed) {
      uiState.selectedDeviceId = placed.id;
      uiState.placementTool = null;
      renderToolBar();
      // 刚放置磁偏转器后直接允许顺手拖向目标角度
      if (placed.kind === 'deflector') {
        dragMode = { kind: 'rotate_device', deviceId: placed.id };
      }
    }
    return;
  }

  // 2. 点击独立己方观测信标（如窗外信标）直接切换开关
  for (const obs of world.observers) {
    if (obs.owner === 'player' && obs.id !== 'obs-emitter') {
      if (dist(pos.x, pos.y, obs.x, obs.y) <= 26) {
        world.toggleSingleObserver(obs.id);
        syncDynamicUI();
        return;
      }
    }
  }

  // 3. 检测是否点中可调装置的旋转手柄或主体
  for (const dev of world.devices) {
    if (dev.fixed) continue;
    if (dev.kind === 'deflector') {
      const hx = dev.x + Math.cos(dev.angleRad) * 46;
      const hy = dev.y + Math.sin(dev.angleRad) * 46;
      if (dist(pos.x, pos.y, hx, hy) <= 18) {
        uiState.selectedDeviceId = dev.id;
        dragMode = { kind: 'rotate_device', deviceId: dev.id };
        return;
      }
    }
    if (dist(pos.x, pos.y, dev.x, dev.y) <= 24) {
      uiState.selectedDeviceId = dev.id;
      dragMode = { kind: 'move_device', deviceId: dev.id };
      return;
    }
  }

  // 4. 检测是否点中雷球发生器或瞄准手柄
  const aimHx = world.emitterX + Math.cos(world.emitterAngle) * 38;
  const aimHy = world.emitterY + Math.sin(world.emitterAngle) * 38;
  if (
    dist(pos.x, pos.y, world.emitterX, world.emitterY) <= 32 ||
    dist(pos.x, pos.y, aimHx, aimHy) <= 18
  ) {
    dragMode = { kind: 'aim_emitter' };
    return;
  }

  uiState.selectedDeviceId = null;
});

canvas.addEventListener('pointermove', (ev) => {
  const pos = clientToWorld(ev.clientX, ev.clientY);
  uiState.mouseX = pos.x;
  uiState.mouseY = pos.y;
  uiState.isHoveringCanvas = true;

  if (dragMode.kind === 'aim_emitter') {
    const a = Math.atan2(pos.y - world.emitterY, pos.x - world.emitterX);
    world.setEmitterAngle(a);
  } else if (dragMode.kind === 'move_device') {
    world.moveDevice(dragMode.deviceId, pos.x, pos.y);
  } else if (dragMode.kind === 'rotate_device') {
    const targetId = dragMode.deviceId;
    const dev = world.devices.find((d) => d.id === targetId);
    if (dev) {
      const a = Math.atan2(pos.y - dev.y, pos.x - dev.x);
      world.rotateDevice(dev.id, a);
    }
  }
});

window.addEventListener('pointerup', () => {
  dragMode = { kind: 'none' };
});

canvas.addEventListener('pointerleave', () => {
  uiState.isHoveringCanvas = false;
});

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

// 滚轮微调选中偏转器角度
canvas.addEventListener(
  'wheel',
  (ev) => {
    if (!uiState.selectedDeviceId) return;
    const dev = world.devices.find((d) => d.id === uiState.selectedDeviceId);
    if (!dev || dev.fixed || dev.kind !== 'deflector') return;
    ev.preventDefault();
    const step = (ev.deltaY > 0 ? 1 : -1) * (Math.PI / 36); // 每次 5 度
    world.rotateDevice(dev.id, dev.angleRad + step);
  },
  { passive: false }
);

// 按钮与键盘快捷键绑定
btnToggleObs.addEventListener('click', () => {
  world.setPlayerObserversActive(!world.playerObserversEnabled);
  syncDynamicUI();
});

btnPause.addEventListener('click', () => {
  world.togglePause();
  syncDynamicUI();
});

btnLaunch.addEventListener('click', () => {
  world.launchElectron();
  syncDynamicUI();
});

btnBlueprint.addEventListener('click', () => {
  uiState.blueprintMode = !uiState.blueprintMode;
  btnBlueprint.classList.toggle('active', uiState.blueprintMode);
});

btnAudio.addEventListener('click', () => {
  sound.setEnabled(!sound.enabled);
  btnAudio.textContent = sound.enabled ? '声景: 开' : '声景: 关';
});

btnReset.addEventListener('click', () => selectLevel(currentLevelIndex));
btnRetryModal.addEventListener('click', () => selectLevel(currentLevelIndex));
btnNextLevel.addEventListener('click', () => {
  if (currentLevelIndex < LEVELS.length - 1) {
    selectLevel(currentLevelIndex + 1);
  }
});

window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  const key = ev.key.toLowerCase();

  if (key === ' ') {
    ev.preventDefault();
    world.togglePause();
    syncDynamicUI();
  } else if (key === 'f' || key === 'enter') {
    ev.preventDefault();
    world.launchElectron();
    syncDynamicUI();
  } else if (key === 'o') {
    world.setPlayerObserversActive(!world.playerObserversEnabled);
    syncDynamicUI();
  } else if (key === 'r') {
    selectLevel(currentLevelIndex);
  } else if (key === 'tab') {
    ev.preventDefault();
    uiState.blueprintMode = !uiState.blueprintMode;
    btnBlueprint.classList.toggle('active', uiState.blueprintMode);
  } else if (key === 'escape') {
    uiState.placementTool = null;
    uiState.selectedDeviceId = null;
    renderToolBar();
  } else if (key === '1') {
    if (world.setSpectrum('alpha')) renderSpectrumBar();
  } else if (key === '2') {
    if (world.setSpectrum('beta')) renderSpectrumBar();
  } else if (key === '3') {
    if (world.setSpectrum('delta')) renderSpectrumBar();
  } else if (key === '4') {
    if (world.setSpectrum('gamma')) renderSpectrumBar();
  }
});

// 画布尺寸自适应
function handleResize(): void {
  const rect = stageShell.getBoundingClientRect();
  renderer.resizeToFit(rect.width - 24, rect.height - 24);
}
window.addEventListener('resize', handleResize);
handleResize();

// 初始加载第 1 关
selectLevel(0);

// 固定步长仿真 + 60fps 渲染主循环
let lastTime = performance.now();
let accumulator = 0;

function tick(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  uiState.visualTime += dt;

  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    world.step(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  renderer.render(world, uiState);
  syncDynamicUI();

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
