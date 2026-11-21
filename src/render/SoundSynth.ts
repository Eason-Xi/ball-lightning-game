import { ElectronMode, SpectrumType } from '../sim/types';

/**
 * 基于 Web Audio API 的实时程序化物理音景合成器
 * 还原原著：空泡激发爆裂、50Hz 宏电子嗡鸣、量子概率云空灵白噪干涉、静谧真空坍缩内爆声
 */
export class SoundSynth {
  private ctx: AudioContext | null = null;
  public enabled = true;

  // 持续运行的宏电子嗡鸣节点
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private cloudNoiseGain: GainNode | null = null;
  private cloudNoiseSource: AudioBufferSourceNode | null = null;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAmbientHum();
    }
  }

  /** 空泡激波激发声 */
  public playLaunch(spectrum: SpectrumType): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const baseFreq: Record<SpectrumType, number> = {
      alpha: 620,
      beta: 420,
      delta: 510,
      gamma: 740,
    };

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq[spectrum] * 1.8, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.16);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);

    this.startAmbientHum('classical');
  }

  /** 启动/切换球状闪电存在期间的实时音景 */
  public startAmbientHum(mode: ElectronMode): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    this.stopAmbientHum();
    const now = ctx.currentTime;

    if (mode === 'classical') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(58, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.12);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);

      this.humOsc = osc;
      this.humGain = gain;
    } else {
      // 概率云态：带通滤波空灵量子干涉声
      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(780, now);
      filter.Q.setValueAtTime(6.5, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.07, now + 0.25);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(now);

      this.cloudNoiseSource = src;
      this.cloudNoiseGain = gain;
    }
  }

  public stopAmbientHum(): void {
    if (this.humOsc && this.humGain && this.ctx) {
      try {
        this.humGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
        this.humOsc.stop(this.ctx.currentTime + 0.15);
      } catch {
        // ignore already stopped
      }
      this.humOsc = null;
      this.humGain = null;
    }
    if (this.cloudNoiseSource && this.cloudNoiseGain && this.ctx) {
      try {
        this.cloudNoiseGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
        this.cloudNoiseSource.stop(this.ctx.currentTime + 0.15);
      } catch {
        // ignore already stopped
      }
      this.cloudNoiseSource = null;
      this.cloudNoiseGain = null;
    }
  }

  /** 波函数坍缩瞬间：高频抽真空内爆脆响（悄然而致命） */
  public playCollapse(hitTarget: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(hitTarget ? 1480 : 880, now + 0.11);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.28);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.31);
  }

  /** 选择性气化声 / β 次生热爆声 */
  public playVaporize(secondaryBlast: boolean): void {
    this.stopAmbientHum();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (secondaryBlast) {
      // 常规高爆轰鸣
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(125, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.55);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } else {
      // 原著特色：高频清脆的“晶格悄然气化”声
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1180, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.22);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    }
  }

  /** 高压引雷针电弧充能声 */
  public playCharge(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.14);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  /** 继电器观测灯开关咔哒声 */
  public playRelayClick(on: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(on ? 920 : 520, now);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** 宏聚变爆发声：深空低频共鸣 + 高频谐振泛音展开 */
  public playMacroFusion(): void {
    this.stopAmbientHum();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 低频深空共振
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.9);
    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.98);

    // 高频晶格清零和弦泛音
    for (const freq of [880, 1320, 1760]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.48, now + 0.65);
      gain.gain.setValueAtTime(0.075, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.72);
    }
  }

  /** 撞墙退激消散声 */
  public playFizzle(): void {
    this.stopAmbientHum();
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.16);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }
}
