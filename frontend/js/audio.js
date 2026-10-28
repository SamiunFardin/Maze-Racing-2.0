// 18. ROBUST WEB AUDIO SYNTHESIZER FOR COUNTDOWN & IMPACTS
class SoundSystem {
  constructor() {
    this.ctx = null;
    this.bgmEnabled = true;
    this.sfxEnabled = true;
    this.bgmVol = 0.8;
    this.sfxVol = 1.0;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playBeep(frequency, duration, type = 'sine') {
    if (!this.sfxEnabled) return;
    this.init();
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      gain.gain.setValueAtTime(this.sfxVol * 0.5, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.error("Audio error", e);
    }
  }

  playRecoilImpact() {
    if (!this.sfxEnabled) return;
    this.init();
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(this.sfxVol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.15);
    } catch(e) {}
  }

  playVictoryFanfare() {
    if (!this.sfxEnabled) return;
    this.init();
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, i) => {
      setTimeout(() => this.playBeep(freq, 0.25, 'triangle'), i * 120);
    });
  }
}

const audioEngine = new SoundSystem();
