class SoundSystem {
  constructor() {
    this.ctx = null;
    this.bgmEnabled = true;
    this.sfxEnabled = true;
    this.bgmVol = 0.8;
    this.sfxVol = 1.0;
    this.bgmTimer = null;
    this.bgmStep = 0;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setBgmEnabled(enabled) {
    this.bgmEnabled = Boolean(enabled);
    if (!this.bgmEnabled) {
      this.stopBGM();
    } else {
      this.startBGM();
    }
  }

  setBgmVolume(vol) {
    this.bgmVol = Math.max(0, Math.min(1, Number(vol)));
  }

  setSfxEnabled(enabled) {
    this.sfxEnabled = Boolean(enabled);
  }

  setSfxVolume(vol) {
    this.sfxVol = Math.max(0, Math.min(1, Number(vol)));
  }

  startBGM() {
    if (!this.bgmEnabled || this.bgmTimer) return;
    this.init();

    // Upbeat synthwave racing bassline sequence (Hz)
    const bassNotes = [110.0, 110.0, 130.81, 146.83, 164.81, 146.83, 130.81, 98.0];
    this.bgmTimer = setInterval(() => {
      if (!this.bgmEnabled || this.bgmVol <= 0.01) return;
      if (!this.ctx || this.ctx.state !== 'running') return;

      try {
        const freq = bassNotes[this.bgmStep % bassNotes.length];
        this.bgmStep++;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        const level = this.bgmVol * 0.14;
        gain.gain.setValueAtTime(level, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.23);
      } catch (e) {}
    }, 260);
  }

  stopBGM() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  playBeep(frequency, duration, type = 'sine') {
    if (!this.sfxEnabled || this.sfxVol <= 0.01) return;
    this.init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      gain.gain.setValueAtTime(this.sfxVol * 0.35, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  }

  playRecoilImpact() {
    if (!this.sfxEnabled || this.sfxVol <= 0.01) return;
    this.init();
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(32, this.ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(this.sfxVol * 0.45, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.16);
    } catch (e) {}
  }

  playVictoryFanfare() {
    if (!this.sfxEnabled || this.sfxVol <= 0.01) return;
    this.init();
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, i) => {
      setTimeout(() => this.playBeep(freq, 0.25, 'triangle'), i * 120);
    });
  }
}

const audioEngine = new SoundSystem();

// Unlock Web Audio on first user interaction anywhere in the app
['pointerdown', 'touchstart', 'keydown', 'click'].forEach(evt => {
  window.addEventListener(evt, () => {
    audioEngine.init();
    if (audioEngine.bgmEnabled && !audioEngine.bgmTimer) {
      audioEngine.startBGM();
    }
  }, { passive: true });
});
