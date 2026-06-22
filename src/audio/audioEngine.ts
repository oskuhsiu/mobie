// 音效引擎：全程序化合成（零取樣 / 零侵權資產）。
// Tone.js 只在 unlock()（iOS 首次觸控）時才動態 import，不進主 bundle。
// 戰鬥邏輯只認識這個介面，不綁 Tone。

export type SfxId =
  | 'select' | 'attack' | 'hit' | 'super' | 'crit'
  | 'faint' | 'switch' | 'lowhp' | 'victory' | 'defeat' | 'capture'

export interface AudioEngine {
  /** iOS 首次觸控時呼叫：解鎖 AudioContext、載入 Tone、建合成器、開 BGM */
  unlock(): Promise<void>
  isReady(): boolean
  play(id: SfxId): void
  startBgm(): void
  stopBgm(): void
  /** 0..1，越高越緊張（低血量）：調暗 BGM 濾波 + 觸發警報嗶 */
  setIntensity(level: number): void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type ToneMod = typeof import('tone')

class ToneAudioEngine implements AudioEngine {
  private Tone: ToneMod | null = null
  private ready = false
  private filter: any = null
  private vol: any = null
  private sfxLead: any = null
  private sfxNoise: any = null
  private bgmLead: any = null
  private bgmBass: any = null
  private seq: any = null
  private bassSeq: any = null
  private bgmStarted = false
  private intensity = 0
  private lastAlarm = 0

  isReady() { return this.ready }

  async unlock() {
    if (this.ready) return
    try {
      const Tone = await import('tone')
      this.Tone = Tone
      await Tone.start()
      this.build()
      this.ready = true
      this.startBgm()
    } catch (e) {
      // 音效失敗絕不影響遊戲
      console.warn('[audio] unlock failed', e)
    }
  }

  private build() {
    const T = this.Tone!
    this.vol = new T.Volume(-9).toDestination()
    this.filter = new T.Filter(9000, 'lowpass').connect(this.vol)

    this.sfxLead = new T.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.004, decay: 0.1, sustain: 0.15, release: 0.12 },
    }).connect(this.filter)
    this.sfxNoise = new T.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.13, sustain: 0 },
    }).connect(this.filter)

    // BGM 專用合成器（與 SFX 分開，互不打斷）
    this.bgmLead = new T.Synth({
      oscillator: { type: 'pulse', width: 0.5 } as any,
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.25, release: 0.1 },
      volume: -10,
    }).connect(this.filter)
    this.bgmBass = new T.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.2 },
      volume: -8,
    }).connect(this.filter)

    // chiptune loop（程序化，零取樣）
    const melody = ['E4', 'G4', 'A4', 'B4', 'A4', 'G4', 'E4', 'D4', 'E4', 'G4', 'C5', 'B4', 'A4', 'G4', 'E4', null]
    const bass = ['E2', null, 'A2', null, 'C3', null, 'B2', null]
    this.seq = new T.Sequence((time, n) => { if (n) this.bgmLead.triggerAttackRelease(n, '8n', time, 0.6) }, melody, '8n')
    this.bassSeq = new T.Sequence((time, n) => { if (n) this.bgmBass.triggerAttackRelease(n, '4n', time, 0.8) }, bass, '4n')
  }

  startBgm() {
    if (!this.ready || this.bgmStarted) return
    try {
      const T = this.Tone!
      const tr = T.getTransport()
      tr.bpm.value = 132
      this.seq.start(0)
      this.bassSeq.start(0)
      tr.start()
      this.bgmStarted = true
    } catch (e) { console.warn('[audio] bgm', e) }
  }

  stopBgm() {
    if (!this.ready || !this.bgmStarted) return
    try {
      const tr = this.Tone!.getTransport()
      tr.stop()
      this.seq.stop(); this.bassSeq.stop()
      this.bgmStarted = false
    } catch { /* noop */ }
  }

  /** 連續快放幾顆音（arpeggio / jingle） */
  private arp(notes: string[], step = 0.06, dur = '16n', vel = 0.7) {
    const T = this.Tone!
    const now = T.now()
    notes.forEach((n, i) => this.sfxLead.triggerAttackRelease(n, dur, now + i * step, vel))
  }

  play(id: SfxId) {
    if (!this.ready) return
    try {
      const T = this.Tone!
      const now = T.now()
      switch (id) {
        case 'select': this.sfxLead.triggerAttackRelease('C5', '32n', now, 0.5); break
        case 'attack': this.sfxNoise.triggerAttackRelease('16n', now, 0.5); break
        case 'hit':
          this.sfxNoise.triggerAttackRelease('8n', now, 0.7)
          this.sfxLead.triggerAttackRelease('C3', '16n', now, 0.6)
          break
        case 'super': this.arp(['C5', 'E5', 'G5'], 0.05, '16n', 0.7); break
        case 'crit':
          this.sfxNoise.triggerAttackRelease('16n', now, 0.8)
          this.arp(['G5', 'C6', 'E6'], 0.045, '16n', 0.8)
          break
        case 'faint': this.arp(['A4', 'F4', 'D4', 'A3'], 0.08, '16n', 0.6); break
        case 'switch': this.arp(['E4', 'A4'], 0.06, '16n', 0.6); break
        case 'lowhp': this.arp(['E6', 'E6'], 0.14, '32n', 0.5); break
        case 'victory': this.arp(['C5', 'E5', 'G5', 'C6'], 0.1, '8n', 0.7); break
        case 'defeat': this.arp(['C4', 'A3', 'F3', 'D3'], 0.13, '8n', 0.6); break
        case 'capture': this.arp(['C6', 'G5', 'C6'], 0.07, '16n', 0.6); break
      }
    } catch (e) { console.warn('[audio] play', id, e) }
  }

  setIntensity(level: number) {
    if (!this.ready) return
    this.intensity = Math.max(0, Math.min(1, level))
    try {
      // 越緊張越悶（低通降頻）
      const cutoff = 1500 + (1 - this.intensity) * 7500
      this.filter.frequency.rampTo(cutoff, 0.4)
      // 低血量警報嗶（節流，不停 transport）
      const t = this.Tone!.now()
      if (this.intensity >= 0.85 && t - this.lastAlarm > 0.7) {
        this.lastAlarm = t
        this.sfxLead.triggerAttackRelease('A5', '32n', t, 0.35)
      }
    } catch { /* noop */ }
  }
}

/** 全域單例。SSR 安全：只在用到時才動態載 Tone。 */
export const audio: AudioEngine = new ToneAudioEngine()
