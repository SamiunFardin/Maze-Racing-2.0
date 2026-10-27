// Web Audio Synthesizer for BGM & SFX
class SoundSystem {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.bgmEnabled = true;
    this.sfxEnabled = true;
    this.bgmVol = 0.8;
    this.sfxVol = 1.0;
  }

  playRecoilImpact() {
    if (!this.sfxEnabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(this.sfxVol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playVictoryFanfare() {
    if (!this.sfxEnabled) return;
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(this.sfxVol * 0.7, this.ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + i * 0.12);
      osc.stop(this.ctx.currentTime + i * 0.12 + 0.3);
    });
  }
}

const audioEngine = new SoundSystem();
