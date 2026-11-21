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
import { evaluateLiveGuide, GuideHighlightTarget } from './ui/TutorialSystem';

const STORAGE_KEY = 'macro_electron_cleared_v2';
const ONBOARDING_SEEN_KEY = 'macro_electron_onboarding_seen_v1';

function loadClearedSet(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    // ignore storage errors
  }
  return new Set();
}

function saveClearedSet(set: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore storage errors
  }
}

// DOM 引用
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const stageShell = document.querySelector('.stage-shell') as HTMLElement;
const campaignProgressEl = document.getElementById('campaignProgress') as HTMLElement;
const levelTabsEl = document.getElementById('levelTabs') as HTMLElement;
const actBadgeEl = document.getElementById('actBadge') as HTMLElement;
const levelTitleEl = document.getElementById('levelTitle') as HTMLElement;
const levelBriefEl = document.getElementById('levelBrief') as HTMLElement;
const archiveTextEl = document.getElementById('archiveText') as HTMLElement;
const briefViewEl = document.getElementById('briefView') as HTMLElement;
const archiveViewEl = document.getElementById('archiveView') as HTMLElement;
const tabBriefBtn = document.getElementById('tabBriefBtn') as HTMLButtonElement;
const tabArchiveBtn = document.getElementById('tabArchiveBtn') as HTMLButtonElement;

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
const btnShowGuide = document.getElementById('btnShowGuide') as HTMLButtonElement;
const btnAudio = document.getElementById('btnAudio') as HTMLButtonElement;
const btnReset = document.getElementById('btnReset') as HTMLButtonElement;

const liveGuideBar = document.getElementById('liveGuideBar') as HTMLElement;
const guideStepBadge = document.getElementById('guideStepBadge') as HTMLElement;
const guideStepMsg = document.getElementById('guideStepMsg') as HTMLElement;
const btnToggleGhosts = document.getElementById('btnToggleGhosts') as HTMLButtonElement;
const btnCloseGuideBar = document.getElementById('btnCloseGuideBar') as HTMLButtonElement;

const onboardingModal = document.getElementById('onboardingModal') as HTMLElement;
const btnStartGuided = document.getElementById('btnStartGuided') as HTMLButtonElement;

const simStatePill = document.getElementById('simStatePill') as HTMLElement;
const simStateText = document.getElementById('simStateText') as HTMLElement;
const quantumStateVal = document.getElementById('quantumStateVal') as HTMLElement;
const toastBanner = document.getElementById('toastBanner') as HTMLElement;

const resultModal = document.getElementById('resultModal') as HTMLElement;
const resultCard = resultModal.querySelector('.result-card') as HTMLElement;
const resultKicker = document.getElementById('resultKicker') as HTMLElement;
const resultTitle = document.getElementById('resultTitle') as HTMLElement;
const resultDesc = document.getElementById('resultDesc') as HTMLElement;
const resultArchive = document.getElementById('resultArchive') as HTMLElement;
const btnNextLevel = document.getElementById('btnNextLevel') as HTMLButtonElement;
const btnRetryModal = document.getElementById('btnRetryModal') as HTMLButtonElement;

// 状态与核心实例
const sound = new SoundSynth();
const renderer = new BlueprintRenderer(canvas);
const clearedLevelIds = loadClearedSet();
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
  onMacroFusion: () => sound.playMacroFusion(),
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
  showGuideGhosts: true,
  guideGhosts: [],
};

let guideBarVisible = true;
let lastHighlightTarget: GuideHighlightTarget = null;

type DragMode =
  | { kind: 'none' }
  | { kind: 'aim_emitter' }
  | { kind: 'move_device'; deviceId: string; startX: number; startY: number; moved: boolean }
  | { kind: 'rotate_device'; deviceId: string };

let dragMode: DragMode = { kind: 'none' };
let lastLogSignature = '';
let lastStatusShown: string = 'playing';

// 侧栏标签页切换（简报 vs 619 实验档案）
function setSidebarTab(tab: 'brief' | 'archive'): void {
  const isBrief = tab === 'brief';
  tabBriefBtn.classList.toggle('active', isBrief);
  tabArchiveBtn.classList.toggle('active', !isBrief);
  briefViewEl.classList.toggle('hidden', !isBrief);
  archiveViewEl.classList.toggle('hidden', isBrief);
}

tabBriefBtn.addEventListener('click', () => setSidebarTab('brief'));
tabArchiveBtn.addEventListener('click', () => setSidebarTab('archive'));

function selectLevel(index: number): void {
  currentLevelIndex = index;
  const spec = LEVELS[index];
  sound.stopAmbientHum();
  world.loadLevel(spec);

  // 含敌方动态巡逻探照灯的关卡默认实时运转，便于直观捕捉暗区窗口
  if (spec.observers.some((o) => o.sweep)) {
    world.paused = false;
  }

  uiState.selectedDeviceId = null;
  uiState.placementTool = null;
  dragMode = { kind: 'none' };
  lastStatusShown = 'playing';
  resultModal.classList.add('hidden');
  setSidebarTab('brief');

  renderLevelTabs();
  renderStaticLevelInfo();
  renderSpectrumBar();
  renderToolBar();
  lastHighlightTarget = null;
  syncDynamicUI();
}

function renderLevelTabs(): void {
  const campaignLevels = LEVELS.filter((l) => !l.isSandbox);
  const clearedCount = campaignLevels.filter((l) => clearedLevelIds.has(l.id)).length;
  campaignProgressEl.textContent = `战役 ${clearedCount}/${campaignLevels.length}`;

  levelTabsEl.innerHTML = '';
  LEVELS.forEach((lvl, idx) => {
    const btn = document.createElement('button');
    btn.className = 'level-tab';
    if (lvl.isSandbox) btn.classList.add('sandbox-tab');
    if (idx === currentLevelIndex) btn.classList.add('active');
    if (clearedLevelIds.has(lvl.id)) btn.classList.add('cleared');

    btn.title = `${lvl.actTitle} — ${lvl.title}`;
    btn.textContent = lvl.isSandbox ? '沙盒' : String(idx + 1).padStart(2, '0');
    btn.addEventListener('click', () => selectLevel(idx));
    levelTabsEl.appendChild(btn);
  });
}

function renderStaticLevelInfo(): void {
  actBadgeEl.textContent = world.level.actTitle;
  levelTitleEl.textContent = world.level.title;
  levelBriefEl.textContent = world.level.brief;
  archiveTextEl.textContent = world.level.archive;
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
        lastHighlightTarget = null;
        syncDynamicUI();
      }
    });
    spectrumBarEl.appendChild(btn);
  });
}

function renderToolBar(): void {
  toolBarEl.innerHTML = '';
  const allTools: { kind: DeviceKind; label: string; tip: string }[] = [
    {
      kind: 'deflector',
      label: '磁偏转器',
      tip: '点击部署，拖拽外侧圆点可旋转偏转方向，右键回收',
    },
    {
      kind: 'attractor',
      label: '引雷针',
      tip: '吸附经典态宏电子并提供 +38% 能量续命',
    },
    {
      kind: 'screen',
      label: '遮蔽幕',
      tip: '物理阻挡敌方探照灯光锥，在光束下切出阴影暗区',
    },
    {
      kind: 'beacon',
      label: '观测信标',
      tip: '便携式主动观测源：单击开关光束，拖拽移动或转向',
    },
  ];

  // 仅显示本关具备初始配额（或沙盒全开放）的装置，保持底栏克制简洁
  const visibleTools = allTools.filter(
    (t) =>
      world.level.isSandbox ||
      (world.level.inventory[t.kind] ?? 0) > 0 ||
      world.inventory[t.kind] > 0
  );

  if (visibleTools.length === 0) {
    const span = document.createElement('span');
    span.style.fontSize = '11.5px';
    span.style.color = '#5a6c82';
    span.textContent = '本关无额外装置';
    toolBarEl.appendChild(span);
    return;
  }

  for (const t of visibleTools) {
    const count = world.inventory[t.kind];
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.tool = t.kind;
    btn.title = t.tip;
    if (uiState.placementTool === t.kind) btn.classList.add('active');
    btn.disabled = count <= 0 && !world.level.isSandbox;

    const countText = world.level.isSandbox ? '∞' : `${count}`;
    btn.innerHTML = `<span>${t.label}</span><span class="tool-count">${countText}</span>`;
    btn.addEventListener('click', () => {
      uiState.placementTool = uiState.placementTool === t.kind ? null : t.kind;
      renderToolBar();
      lastHighlightTarget = null;
      syncDynamicUI();
    });
    toolBarEl.appendChild(btn);
  }
}

function syncDynamicUI(): void {
  ammoDisplayEl.textContent =
    world.remainingAmmo < 0 ? '宏电子: ∞' : `宏电子: ${world.remainingAmmo}`;

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

  const activeCount = world.activeElectronCount;
  const e = world.electron;
  if (activeCount === 0 || !e || !e.alive) {
    quantumStateVal.textContent = world.level.macroFusionEnabled
      ? '待激发 · 支持双球宏聚变'
      : '基态待激发';
    quantumStateVal.className = 'meter-value';
    stabilityBarEl.style.width = '100%';
    stabilityNumEl.textContent = '100%';
  } else if (activeCount >= 2) {
    quantumStateVal.textContent = `双球共鸣中 (${activeCount}/${world.maxConcurrentElectrons}) · 靠近即宏聚变`;
    quantumStateVal.className = 'meter-value cloud';
    const pct = Math.max(0, Math.round(e.stability));
    stabilityBarEl.style.width = `${pct}%`;
    stabilityNumEl.textContent = `${pct}%`;
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

  const targetPsi = Math.round(world.getTargetMaxPsi() * 100);
  psiBarEl.style.width = `${targetPsi}%`;
  psiNumEl.textContent = `${targetPsi}%`;

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

  btnLaunch.disabled =
    world.status !== 'playing' ||
    world.activeElectronCount >= world.maxConcurrentElectrons ||
    world.remainingAmmo === 0;

  // 实时分步教学引导条 & 按钮呼吸脉冲高亮同步
  const guide = evaluateLiveGuide(world);
  uiState.guideGhosts = guideBarVisible && guide ? guide.ghosts : [];

  if (guideBarVisible && guide) {
    liveGuideBar.classList.remove('hidden');
    guideStepBadge.textContent = guide.badge;
    guideStepMsg.textContent = guide.message;
    btnToggleGhosts.style.display = guide.ghosts.length > 0 ? 'inline-block' : 'none';
    btnToggleGhosts.classList.toggle('active', uiState.showGuideGhosts);
    btnToggleGhosts.textContent = uiState.showGuideGhosts ? '位置虚影: 开' : '位置虚影: 关';
  } else {
    liveGuideBar.classList.add('hidden');
  }

  const nextHighlight: GuideHighlightTarget = guideBarVisible && guide ? guide.highlight : null;
  if (nextHighlight !== lastHighlightTarget) {
    lastHighlightTarget = nextHighlight;
    applyGuideHighlight(nextHighlight);
  }

  const objStates = world.getObjectiveStates();
  objectiveListEl.innerHTML = '';
  if (objStates.length === 0) {
    const li = document.createElement('li');
    li.className = 'objective-item';
    li.textContent = '自由物理沙盒模式：任意测试四元共振、光学遮蔽幕、宏聚变与观测坍缩。';
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

  if (world.status !== lastStatusShown && world.status !== 'playing') {
    lastStatusShown = world.status;
    sound.stopAmbientHum();
    resultModal.classList.remove('hidden');

    if (world.status === 'victory') {
      clearedLevelIds.add(world.level.id);
      saveClearedSet(clearedLevelIds);
      renderLevelTabs();
      resultCard.classList.remove('failed');
      resultKicker.textContent = `${world.level.code} // EXPERIMENT VERIFIED`;
      resultTitle.textContent =
        world.level.id === 'lvl-12' ? '全战役通关 · 宏电子终章' : '物理实验成功';
      resultDesc.textContent = world.statusReason;
      resultArchive.textContent = world.level.archive;
      resultArchive.style.display = 'block';
      const hasNext = currentLevelIndex < LEVELS.length - 1;
      btnNextLevel.style.display = hasNext ? 'inline-block' : 'none';
    } else {
      resultCard.classList.add('failed');
      resultKicker.textContent = `${world.level.code} // CONTAINMENT BREACH`;
      resultTitle.textContent = '实验异常中止';
      resultDesc.textContent = world.statusReason;
      resultArchive.style.display = 'none';
      btnNextLevel.style.display = 'none';
    }
  }
}

function applyGuideHighlight(target: GuideHighlightTarget): void {
  document.querySelectorAll('.guide-pulse').forEach((el) => el.classList.remove('guide-pulse'));
  if (!target) return;

  if (target === 'launch') {
    btnLaunch.classList.add('guide-pulse');
  } else if (target === 'obs') {
    btnToggleObs.classList.add('guide-pulse');
  } else if (target === 'pause') {
    btnPause.classList.add('guide-pulse');
  } else if (target.startsWith('spec:')) {
    const spec = target.slice(5);
    spectrumBarEl.querySelector(`[data-spec="${spec}"]`)?.classList.add('guide-pulse');
  } else if (target.startsWith('tool:')) {
    const tool = target.slice(5);
    toolBarEl.querySelector(`[data-tool="${tool}"]`)?.classList.add('guide-pulse');
  }
}

function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * WORLD_WIDTH,
    y: ((clientY - rect.top) / rect.height) * WORLD_HEIGHT,
  };
}

function getDeviceHandleOffset(kind: DeviceKind): number {
  if (kind === 'deflector') return 46;
  if (kind === 'screen') return 38;
  if (kind === 'beacon') return 42;
  return 0;
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button === 2) {
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

  // 1. 放置装置（若开启位置虚影且靠近推荐虚影，自动温柔吸附并预设建议朝向！）
  if (uiState.placementTool) {
    let placeX = pos.x;
    let placeY = pos.y;
    let placeAngle =
      uiState.placementTool === 'screen'
        ? Math.PI / 2
        : uiState.placementTool === 'beacon'
        ? -Math.PI / 2
        : 0;
    let snapped = false;

    if (uiState.showGuideGhosts) {
      for (const g of uiState.guideGhosts) {
        if (g.kind === uiState.placementTool && dist(pos.x, pos.y, g.x, g.y) <= 44) {
          placeX = g.x;
          placeY = g.y;
          placeAngle = g.angleRad;
          snapped = true;
          break;
        }
      }
    }

    const placed = world.placeDevice(uiState.placementTool, placeX, placeY, placeAngle);
    if (placed) {
      uiState.selectedDeviceId = placed.id;
      uiState.placementTool = null;
      renderToolBar();
      applyGuideHighlight(lastHighlightTarget);
      if (snapped) {
        showToast('已自动吸附至推荐位置与角度（仍可自由拖动微调）');
      } else if (placed.kind === 'deflector') {
        dragMode = { kind: 'rotate_device', deviceId: placed.id };
      }
    }
    return;
  }

  // 2. 点击固定己方观测信标开关（排除便携信标，由装置点击处理）
  for (const obs of world.observers) {
    if (obs.owner === 'player' && !obs.sourceDeviceId && !obs.id.startsWith('obs-emitter')) {
      if (dist(pos.x, pos.y, obs.x, obs.y) <= 26) {
        world.toggleSingleObserver(obs.id);
        syncDynamicUI();
        return;
      }
    }
  }

  // 3. 检测可调装置的旋转手柄或主体
  for (const dev of world.devices) {
    if (dev.fixed) continue;
    const handleDist = getDeviceHandleOffset(dev.kind);
    if (handleDist > 0) {
      const hx = dev.x + Math.cos(dev.angleRad) * handleDist;
      const hy = dev.y + Math.sin(dev.angleRad) * handleDist;
      if (dist(pos.x, pos.y, hx, hy) <= 18) {
        uiState.selectedDeviceId = dev.id;
        dragMode = { kind: 'rotate_device', deviceId: dev.id };
        return;
      }
    }
    const bodyRadius = dev.kind === 'screen' ? 32 : 24;
    if (dist(pos.x, pos.y, dev.x, dev.y) <= bodyRadius) {
      uiState.selectedDeviceId = dev.id;
      dragMode = {
        kind: 'move_device',
        deviceId: dev.id,
        startX: pos.x,
        startY: pos.y,
        moved: false,
      };
      return;
    }
  }

  // 4. 拖拽雷球发生器瞄准
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
    if (dist(pos.x, pos.y, dragMode.startX, dragMode.startY) > 5) {
      dragMode.moved = true;
    }
    if (dragMode.moved) {
      world.moveDevice(dragMode.deviceId, pos.x, pos.y);
    }
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
  // 如果只是单击了便携观测信标而没有拖拽移动，直接原地切换它的光束开关！
  if (dragMode.kind === 'move_device' && !dragMode.moved) {
    const targetId = dragMode.deviceId;
    const dev = world.devices.find((d) => d.id === targetId);
    if (dev?.kind === 'beacon' && dev.linkedObserverId) {
      world.toggleSingleObserver(dev.linkedObserverId);
      syncDynamicUI();
    }
  }
  dragMode = { kind: 'none' };
});

canvas.addEventListener('pointerleave', () => {
  uiState.isHoveringCanvas = false;
});

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

canvas.addEventListener(
  'wheel',
  (ev) => {
    if (!uiState.selectedDeviceId) return;
    const dev = world.devices.find((d) => d.id === uiState.selectedDeviceId);
    if (!dev || dev.fixed) return;
    if (dev.kind !== 'deflector' && dev.kind !== 'screen' && dev.kind !== 'beacon') return;
    ev.preventDefault();
    const step = (ev.deltaY > 0 ? 1 : -1) * (Math.PI / 36);
    world.rotateDevice(dev.id, dev.angleRad + step);
  },
  { passive: false }
);

// 按钮与快捷键
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

btnShowGuide.addEventListener('click', () => {
  guideBarVisible = true;
  onboardingModal.classList.remove('hidden');
  syncDynamicUI();
});

btnStartGuided.addEventListener('click', () => {
  onboardingModal.classList.add('hidden');
  guideBarVisible = true;
  uiState.showGuideGhosts = true;
  try {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    // ignore
  }
  syncDynamicUI();
});

btnToggleGhosts.addEventListener('click', () => {
  uiState.showGuideGhosts = !uiState.showGuideGhosts;
  syncDynamicUI();
});

btnCloseGuideBar.addEventListener('click', () => {
  guideBarVisible = false;
  syncDynamicUI();
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
    if (world.setSpectrum('alpha')) {
      renderSpectrumBar();
      lastHighlightTarget = null;
      syncDynamicUI();
    }
  } else if (key === '2') {
    if (world.setSpectrum('beta')) {
      renderSpectrumBar();
      lastHighlightTarget = null;
      syncDynamicUI();
    }
  } else if (key === '3') {
    if (world.setSpectrum('delta')) {
      renderSpectrumBar();
      lastHighlightTarget = null;
      syncDynamicUI();
    }
  } else if (key === '4') {
    if (world.setSpectrum('gamma')) {
      renderSpectrumBar();
      lastHighlightTarget = null;
      syncDynamicUI();
    }
  }
});

function handleResize(): void {
  const rect = stageShell.getBoundingClientRect();
  renderer.resizeToFit(rect.width - 24, rect.height - 24);
}
window.addEventListener('resize', handleResize);
handleResize();

selectLevel(0);

// 首次进入自动弹出 30 秒新手图解速览卡
try {
  if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) {
    onboardingModal.classList.remove('hidden');
  }
} catch {
  onboardingModal.classList.remove('hidden');
}

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
