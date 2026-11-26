/**
 * app.js
 * ------
 * Frontend client controller managing UI modals, user authentication,
 * fault-tolerant storage persistence (with fallback when localStorage is blocked),
 * garage stats interaction, audio settings, lifetime earnings display,
 * top-100 leaderboards, daily penalty breakdown, and Socket.io event listeners.
 */

let currentUser = null;
let userCoins = 100;
let userLifetimeEarnings = 0;
let completedLevels = [];
let completedNightLevels = [];
let userStats = {};
let currentAuthMode = 'login';
let isNewRegistration = false;
window.currentRoomId = null;
window.mpRaceStartTs = null;
let pendingJoinPayload = null;

// Fault-tolerant storage wrapper: tries localStorage first, falls back safely if restricted
const _memoryStorageFallback = new Map();

function safeStorageGet(key) {
  try {
    if (window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null && val !== undefined) return val;
    }
  } catch (err) {
    // localStorage restricted or unavailable
  }
  try {
    if (window.name && window.name.startsWith('__TM_STATE__:')) {
      const parsed = JSON.parse(window.name.slice('__TM_STATE__:'.length));
      if (parsed && Object.prototype.hasOwnProperty.call(parsed, key)) {
        return parsed[key];
      }
    }
  } catch (err) {
    // Ignore malformed window.name
  }
  return _memoryStorageFallback.has(key) ? _memoryStorageFallback.get(key) : null;
}

function safeStorageSet(key, value) {
  const strVal = String(value);
  _memoryStorageFallback.set(key, strVal);
  try {
    if (window.localStorage) {
      window.localStorage.setItem(key, strVal);
    }
  } catch (err) {
    // Fallback to window.name & memory when localStorage is blocked
  }
  try {
    let currentObj = {};
    if (window.name && window.name.startsWith('__TM_STATE__:')) {
      currentObj = JSON.parse(window.name.slice('__TM_STATE__:'.length)) || {};
    }
    currentObj[key] = strVal;
    window.name = '__TM_STATE__:' + JSON.stringify(currentObj);
  } catch (err) {
    // Ignore window.name serialization limits
  }
}

function safeStorageRemove(key) {
  _memoryStorageFallback.delete(key);
  try {
    if (window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch (err) {
    // Ignore restricted storage
  }
  try {
    if (window.name && window.name.startsWith('__TM_STATE__:')) {
      const currentObj = JSON.parse(window.name.slice('__TM_STATE__:'.length)) || {};
      delete currentObj[key];
      window.name = '__TM_STATE__:' + JSON.stringify(currentObj);
    }
  } catch (err) {
    // Ignore
  }
}

const backendUrl = window.location.hostname === 'localhost' ? 'http://localhost:8000' : window.location.origin;

const socket = io(backendUrl, {
  transports: ['polling', 'websocket'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

socket.on('connect', () => {
  console.log('[SOCKET] Connected with ID:', socket.id);
  if (pendingJoinPayload) {
    socket.emit('join_multiplayer', pendingJoinPayload);
    pendingJoinPayload = null;
  }
});

socket.on('connect_error', (err) => {
  console.error('[SOCKET] Connection error:', err);
});

socket.on('waiting_room_update', (data) => {
  console.log('[SOCKET] waiting_room_update:', data);
  window.currentRoomId = data.room_id;
  document.getElementById('waiting-count').innerText = data.count;
  document.getElementById('waiting-players-list').innerHTML = data.players.map(p => `<div>• ${p}</div>`).join('');
});

socket.on('waiting_countdown_tick', (data) => {
  const timerElem = document.getElementById('waiting-countdown-val');
  if (timerElem) {
    timerElem.innerText = data.remaining;
  }
});

socket.on('start_multiplayer_race', (data) => {
  console.log('[SOCKET] start_multiplayer_race received! Launching shared maze...', data);
  window.currentRoomId = data.room_id;
  // Sync backend start timestamp (server sends Unix seconds; convert to client ms)
  window.mpRaceStartTs = data.race_start_ts ? data.race_start_ts * 1000 : Date.now() + 3000;
  multiplayerGhosts = {};
  userCoins = Math.max(0, userCoins - 1);
  updateHUDCoins();

  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));

  const gridSz = Number(data.grid_size) || 25;
  const sharedSeed = Number(data.seed);
  const mpConfig = {
    id: `mp_${data.room_id}`,
    name: "Multiplayer Arena",
    size: gridSz,
    seed: sharedSeed
  };
  prepareAndStartLevel(mpConfig);
});

socket.on('ghost_update', (data) => {
  for (let sid in data) {
    multiplayerGhosts[sid] = data[sid];
  }
});

socket.on('ghost_removed', (data) => {
  if (data && data.sid && multiplayerGhosts[data.sid]) {
    delete multiplayerGhosts[data.sid];
  }
});

socket.on('reward_payout_received', (data) => {
  if (!currentUser || !data || !data.payouts) return;
  const myPayouts = data.payouts.filter(p => p.driver === currentUser || !p.driver);
  if (myPayouts.length > 0) {
    const gained = myPayouts.reduce((sum, p) => sum + (p.coins || 0), 0);
    if (gained > 0) {
      userCoins += gained;
      userLifetimeEarnings += gained;
      updateHUDCoins();
      const summary = myPayouts.map(p => `${p.source} (#${p.rank}): +${p.coins} coins`).join(' | ');
      alert(`Leaderboard Reward Received!\n${summary}`);
    }
  }
});

function renderMultiplayerStandings(standings) {
  const box = document.getElementById('victory-mp-standings');
  if (!box) return;
  if (!standings || standings.length === 0) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `<div class="text-[10px] uppercase font-bold text-slate-400 mb-1">Live Room Standings</div>` +
    standings.map(s => `
      <div class="flex justify-between items-center text-xs py-1 border-b border-slate-700/60 last:border-none">
        <span class="font-bold ${s.status.includes('Forfeit') ? 'text-rose-400' : 'text-slate-200'}">
          #${s.rank} ${s.username}
        </span>
        <span class="font-mono text-[11px] ${s.status.includes('Forfeit') ? 'text-rose-400' : 'text-emerald-400'}">
          ${s.time_ms !== null ? formatTime(s.time_ms) : s.status}
        </span>
      </div>
    `).join('');
}

socket.on('race_standings_update', (data) => {
  if (data && data.standings) {
    renderMultiplayerStandings(data.standings);
  }
});

socket.on('player_payout', (data) => {
  userCoins = data.total_coins;
  if (typeof data.lifetime_earnings === 'number') {
    userLifetimeEarnings = data.lifetime_earnings;
  } else {
    userLifetimeEarnings += Number(data.payout || 0);
  }
  updateHUDCoins();
  document.getElementById('victory-final-time').innerText = formatTime(data.time_ms);
  document.getElementById('victory-rank-display').innerText = `Multiplayer Rank #${data.rank} of ${data.total_players}`;
  document.getElementById('victory-coin-payout').innerText = `+${data.payout} Coins Earned!`;
  if (data.standings) {
    renderMultiplayerStandings(data.standings);
  }
});

socket.on('error_message', (data) => alert(data.detail));

window.addEventListener('load', () => {
  setupAudioSettingsControls();

  const splashTip = document.getElementById('splash-tip-text');
  if (splashTip) {
    splashTip.innerText = GAME_TIPS[Math.floor(Math.random() * GAME_TIPS.length)];
  }

  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => {
        if (splash && splash.parentNode) splash.remove();
      }, 700);
    }

    const savedUser = safeStorageGet('tm_logged_username');
    const savedPass = safeStorageGet('tm_logged_password');
    if (savedUser && savedPass) {
      document.getElementById('auth-username').value = savedUser;
      document.getElementById('auth-password').value = savedPass;
      submitAuth(true);
    } else {
      document.getElementById('modal-auth').classList.remove('hidden');
    }
  }, 2000);
});

function setupAudioSettingsControls() {
  const bgmToggle = document.getElementById('setting-bgm-toggle');
  const bgmVol = document.getElementById('setting-bgm-vol');
  const sfxToggle = document.getElementById('setting-sfx-toggle');
  const sfxVol = document.getElementById('setting-sfx-vol');

  if (bgmToggle) {
    bgmToggle.addEventListener('change', (e) => {
      audioEngine.setBgmEnabled(e.target.checked);
    });
  }
  if (bgmVol) {
    bgmVol.addEventListener('input', (e) => {
      audioEngine.setBgmVolume(e.target.value);
    });
  }
  if (sfxToggle) {
    sfxToggle.addEventListener('change', (e) => {
      audioEngine.setSfxEnabled(e.target.checked);
      if (e.target.checked) audioEngine.playBeep(660, 0.12);
    });
  }
  if (sfxVol) {
    sfxVol.addEventListener('input', (e) => {
      audioEngine.setSfxVolume(e.target.value);
    });
  }
}

function switchAuthTab(mode) {
  currentAuthMode = mode;
  const isSignup = mode === 'signup';
  isNewRegistration = isSignup;
  document.getElementById('tab-login').className = isSignup ? 'py-2 rounded-lg text-xs font-bold text-slate-400' : 'py-2 rounded-lg text-xs font-bold bg-blue-600 text-white';
  document.getElementById('tab-signup').className = isSignup ? 'py-2 rounded-lg text-xs font-bold bg-blue-600 text-white' : 'py-2 rounded-lg text-xs font-bold text-slate-400';
  document.getElementById('auth-btn-submit').innerText = isSignup ? 'SIGN UP & PLAY' : 'LOGIN';
  document.getElementById('auth-color-section').classList.toggle('hidden', !isSignup);
}

function normalizeStatsConfig(statsObj) {
  const normalized = statsObj && typeof statsObj === 'object' ? { ...statsObj } : {};
  if (normalized.turning && typeof normalized.turning === 'object') {
    normalized.turning = {
      ...normalized.turning,
      min: 0.001,
      max: 0.5,
      step: 0.001,
      unlocked: Math.min(0.5, Number(normalized.turning.unlocked ?? 0.025)),
      current: Math.min(Math.min(0.5, Number(normalized.turning.unlocked ?? 0.025)), Number(normalized.turning.current ?? 0.025))
    };
  }
  return normalized;
}

function submitAuth(isAuto = false) {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const color = document.getElementById('auth-color-picker').value || '#3b82f6';

  if (!username || !password) {
    if (!isAuto) alert("Please enter both username and password.");
    return;
  }

  fetch(`${backendUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_signup: currentAuthMode === 'signup', username, password, color })
  })
  .then(res => res.json().then(data => ({ status: res.status, body: data })))
  .then(response => {
    if (response.status === 200) {
      currentUser = response.body.username;
      userCoins = response.body.user_data.coins;
      userLifetimeEarnings = response.body.user_data.lifetime_earnings || 0;
      completedLevels = response.body.user_data.completed_levels || [];
      completedNightLevels = response.body.user_data.completed_night_levels || [];
      userStats = normalizeStatsConfig(response.body.user_data.stats);
      car.color = response.body.user_data.color;

      const colorPicker = document.getElementById('settings-color-picker');
      if (colorPicker && car.color) colorPicker.value = car.color;

      if (response.body.user_data.control_pos) {
        applyControlPosition(response.body.user_data.control_pos);
      }

      safeStorageSet('tm_logged_username', currentUser);
      safeStorageSet('tm_logged_password', password);

      applyCarStats();
      updateHUDCoins();

      if (Array.isArray(response.body.pending_rewards) && response.body.pending_rewards.length > 0) {
        const msg = response.body.pending_rewards
          .map(r => `${r.source} (Rank #${r.rank}): +${r.coins} Coins`)
          .join('\n');
        alert(`You received leaderboard rewards!\n${msg}`);
      }

      document.getElementById('menu-player-name').innerText = currentUser;
      document.getElementById('modal-auth').classList.add('hidden');

      if (isNewRegistration && !isAuto) {
        isNewRegistration = false;
        document.getElementById('modal-adjust-prompt').classList.remove('hidden');
      } else {
        document.getElementById('modal-menu').classList.remove('hidden');
      }
    } else {
      if (!isAuto) alert(response.body.detail);
      safeStorageRemove('tm_logged_username');
      safeStorageRemove('tm_logged_password');
      document.getElementById('modal-auth').classList.remove('hidden');
    }
  })
  .catch(() => {
    if (!isAuto) {
      alert("Unable to reach server. Please try again.");
    } else {
      document.getElementById('modal-auth').classList.remove('hidden');
    }
  });
}

function applyCarStats() {
  userStats = normalizeStatsConfig(userStats);
  if (userStats.topSpeed) car.maxSpeed = userStats.topSpeed.current;
  if (userStats.acceleration) car.accel = userStats.acceleration.current;
  if (userStats.brake) car.brake = userStats.brake.current;
  if (userStats.turning) car.turnSpeed = userStats.turning.current;
  if (userStats.friction) car.friction = userStats.friction.current;
}

function updateHUDCoins() {
  const hudCoinsEl = document.getElementById('hud-coins-val');
  if (hudCoinsEl) hudCoinsEl.innerText = userCoins;
  const menuCoinsEl = document.getElementById('menu-coins-val');
  if (menuCoinsEl) menuCoinsEl.innerText = userCoins;
}

const STAT_NOTES = {
  topSpeed: "Increases max velocity. Higher = faster top speed, requires precise braking.",
  acceleration: "Increases velocity gain rate off the line.",
  brake: "Increases deceleration power when stopping before walls.",
  turning: "Increases steering sensitivity (step: 0.001, max: 0.5) for sharper corner cutting.",
  drift: "Adjusts tire traction grip around difficult maze corners.",
  reverse: "Increases backing up speed out of dead ends.",
  friction: "Decreases momentum drag when letting go of gas."
};

function renderGarageUI() {
  userStats = normalizeStatsConfig(userStats);
  const container = document.getElementById('garage-stats-container');
  container.innerHTML = Object.keys(userStats).map(stat => {
    const s = userStats[stat];
    const note = STAT_NOTES[stat] || "";
    const minVal = stat === 'turning' ? 0.001 : s.min;
    const maxCapVal = stat === 'turning' ? Math.min(0.5, s.unlocked) : s.unlocked;
    const maxPossibleVal = stat === 'turning' ? 0.5 : s.max;
    const stepVal = stat === 'turning' ? 0.001 : s.step;
    return `
      <div class="p-3 bg-slate-800 rounded-xl border border-slate-700 space-y-2">
        <div class="flex justify-between items-center">
          <div>
            <div class="font-bold text-xs uppercase text-slate-200">${stat}</div>
            <div class="text-[10px] text-slate-400">${note}</div>
          </div>
          <button onclick="upgradeStatCap('${stat}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1 rounded-lg text-xs whitespace-nowrap">
            + Tier (10c)
          </button>
        </div>
        <div>
          <div class="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>Unlocked Cap: ${maxCapVal} (Max: ${maxPossibleVal})</span>
            <span class="font-mono text-cyan-400 font-bold" id="val-${stat}">${s.current}</span>
          </div>
          <input type="range" min="${minVal}" max="${maxCapVal}" step="${stepVal}" value="${s.current}"
            onchange="tuneCurrentStat('${stat}', this.value)" oninput="document.getElementById('val-${stat}').innerText = this.value" class="w-full">
        </div>
      </div>
    `;
  }).join('');
}

function upgradeStatCap(stat_name) {
  fetch(`${backendUrl}/api/garage/upgrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, stat_name })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      userCoins = data.coins;
      if (typeof data.lifetime_earnings === 'number') {
        userLifetimeEarnings = data.lifetime_earnings;
      }
      userStats = normalizeStatsConfig(data.stats);
      applyCarStats();
      updateHUDCoins();
      renderGarageUI();
    } else {
      alert(data.detail);
    }
  });
}

function tuneCurrentStat(stat_name, value) {
  fetch(`${backendUrl}/api/garage/tune`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, stat_name, value })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      userStats = normalizeStatsConfig(data.stats);
      applyCarStats();
    }
  });
}

function skipControlAdjustment() {
  document.getElementById('modal-adjust-prompt').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
}

function startControlAdjustment() {
  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
  document.getElementById('edit-layout-banner').classList.remove('hidden');
}

document.getElementById('btn-save-controls').onclick = () => {
  document.getElementById('edit-layout-banner').classList.add('hidden');
  const leftW = document.getElementById('ctrl-buttons-wrapper');
  const pos = { left: parseInt(leftW.style.left) || 24, bottom: parseInt(leftW.style.bottom) || 24 };
  
  fetch(`${backendUrl}/api/settings/controls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, pos })
  });
  
  if (gameActive) {
    document.getElementById('modal-pause').classList.remove('hidden');
  } else {
    document.getElementById('modal-menu').classList.remove('hidden');
  }
};

document.getElementById('btn-reset-controls').onclick = () => {
  const leftW = document.getElementById('ctrl-buttons-wrapper');
  const rightW = document.getElementById('ctrl-pedals-wrapper');
  leftW.style.left = '24px'; leftW.style.bottom = '24px'; leftW.style.top = 'auto';
  rightW.style.right = '24px'; rightW.style.bottom = '20px'; rightW.style.top = 'auto';
};

function applyControlPosition(pos) {
  const leftW = document.getElementById('ctrl-buttons-wrapper');
  if (pos && pos.left) {
    leftW.style.left = `${pos.left}px`;
    leftW.style.bottom = `${pos.bottom}px`;
    leftW.style.top = 'auto';
  }
}

function openMultiplayerSizeModal() {
  document.getElementById('modal-menu').classList.add('hidden');
  document.getElementById('modal-mp-size').classList.remove('hidden');
}

function joinMultiplayerWithGrid(gridSize) {
  if (userCoins < 1) {
    alert("Insufficient coins! Multiplayer entry requires 1 coin.");
    return;
  }
  document.getElementById('modal-mp-size').classList.add('hidden');
  document.getElementById('modal-waiting-room').classList.remove('hidden');
  document.getElementById('waiting-countdown-val').innerText = "10";
  document.getElementById('waiting-players-list').innerHTML = `<div>• ${currentUser || 'Driver'}</div>`;
  window.currentRoomId = null;
  window.mpRaceStartTs = null;
  
  const payload = { username: currentUser, grid_size: gridSize, color: car.color };

  if (socket.connected) {
    socket.emit('join_multiplayer', payload);
  } else {
    pendingJoinPayload = payload;
    socket.connect();
  }
}

function cancelMultiplayerQueue() {
  pendingJoinPayload = null;
  if (socket.connected) {
    socket.emit('leave_multiplayer', { room_id: window.currentRoomId });
  }
  window.currentRoomId = null;
  window.mpRaceStartTs = null;
  document.getElementById('modal-waiting-room').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
}

function openDailyChallengeMenu() {
  document.getElementById('modal-menu').classList.add('hidden');
  document.getElementById('modal-daily-menu').classList.remove('hidden');
}

function startDailyChallenge() {
  const d = new Date();
  const dateSeed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const dailyConfig = { id: 9999, name: "Daily Challenge Arena", size: 50, seed: dateSeed, isDaily: true };
  prepareAndStartLevel(dailyConfig);
}

function openDailyLeaderboard() {
  document.getElementById('modal-daily-menu').classList.add('hidden');
  openLeaderboardsModal();
  document.getElementById('lb-level-select').value = "9999";
  fetchLeaderboard(9999);
}

function handleCampaignVictory(level_id, time_ms, is_daily = false, is_night_drive = false, grid_size = 25) {
  const mpStandingsBox = document.getElementById('victory-mp-standings');
  if (mpStandingsBox) mpStandingsBox.classList.add('hidden');

  fetch(`${backendUrl}/api/campaign/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentUser,
      level_id,
      time_ms,
      is_daily,
      is_night_drive,
      grid_size
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      userCoins = data.total_coins;
      if (typeof data.lifetime_earnings === 'number') {
        userLifetimeEarnings = data.lifetime_earnings;
      }
      if (Array.isArray(data.completed_levels)) {
        completedLevels = data.completed_levels;
      }
      if (Array.isArray(data.completed_night_levels)) {
        completedNightLevels = data.completed_night_levels;
      }
      updateHUDCoins();
      document.getElementById('victory-coin-payout').innerText = is_daily
        ? "Daily Challenge Completed! (Top-100 Daily Rewards Paid Every Day)"
        : (data.first_time
            ? `+${data.earned_coins} Coins (First Clear!)`
            : "+0 Coins (Already Cleared)");
      document.getElementById('victory-rank-display').innerText = `Rank #${data.rank} | World Record: ${formatTime(data.world_record)}`;
    }
  });
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');

  // Prevent blank screen / dead-end if closing a modal leaves no active modal or game screen visible
  const anyModalOpen = Array.from(document.querySelectorAll('[id^="modal-"]'))
    .some(m => !m.classList.contains('hidden'));

  if (!anyModalOpen) {
    if (gameActive && isPaused) {
      openModal('modal-pause');
    } else if (!gameActive) {
      if (currentUser) {
        openModal('modal-menu');
      } else {
        openModal('modal-auth');
      }
    }
  }
}

function openLevelsModal() {
  openModal('modal-levels');
  renderLevelSelector(CAMPAIGN_100_LEVELS, 'levels-container', false);
}

function openNightDriveLevelsModal() {
  openModal('modal-night-levels');
  renderLevelSelector(NIGHT_DRIVE_1300_LEVELS, 'night-levels-container', true);
}

function openGarageModal() {
  document.querySelectorAll('[id^="modal-"]').forEach(m => {
    if (m.id !== 'modal-pause') m.classList.add('hidden');
  });
  openModal('modal-garage');
  renderGarageUI();
}

function openSettingsModal() {
  document.querySelectorAll('[id^="modal-"]').forEach(m => {
    if (m.id !== 'modal-pause') m.classList.add('hidden');
  });
  openModal('modal-settings');
}

function openProfileModal() {
  const totalCleared = completedLevels.length + completedNightLevels.length;
  document.getElementById('profile-username').innerText = currentUser;
  document.getElementById('profile-coins').innerText = userCoins;
  document.getElementById('profile-cleared-count').innerText = `${totalCleared} / 2600`;
  document.getElementById('profile-total-wealth').innerText = userLifetimeEarnings;
  openModal('modal-profile');
}

function openLeaderboardsModal() {
  openModal('modal-leaderboards');
  const sel = document.getElementById('lb-level-select');
  sel.innerHTML = `<option value="richest">💰 Richest Players (Lifetime Earnings)</option>` +
    `<option value="9999">🌟 Daily Challenge Arena (Top 100 • Daily Payout)</option>` +
    CAMPAIGN_100_LEVELS.map(m => `<option value="${m.id}">${m.name} (${m.size}x${m.size} • Weekly Payout)</option>`).join('') +
    NIGHT_DRIVE_1300_LEVELS.map(m => `<option value="${10000 + m.id}">${m.name} (${m.size}x${m.size} • Weekly Payout)</option>`).join('');
  fetchLeaderboard("richest");
}

function openRewardTiersModal() {
  openModal('modal-reward-tiers');
}

function fetchLeaderboard(level_id) {
  const endpoint = level_id === "richest"
    ? `${backendUrl}/api/leaderboard/richest`
    : `${backendUrl}/api/leaderboard/level/${level_id}`;
  fetch(endpoint)
    .then(res => res.json())
    .then(records => {
      const list = document.getElementById('lb-list-container');
      if (!Array.isArray(records) || records.length === 0) {
        list.innerHTML = '<div class="text-center text-slate-400 py-4 text-xs">No records yet (Top 100 shown).</div>';
        return;
      }
      if (level_id === "richest") {
        list.innerHTML = records.slice(0, 100).map((r, i) => `
          <div class="p-2.5 bg-slate-800 rounded-xl flex justify-between items-center text-xs">
            <span class="font-bold ${i===0?'text-amber-400':'text-slate-300'}">#${i+1} ${r.driver}</span>
            <span class="font-mono text-emerald-400 font-bold"><i class="fa-solid fa-sack-dollar mr-1"></i>${r.lifetime_earnings ?? 0} Earned <span class="text-slate-400 text-[10px]">(${r.coins ?? 0} bal)</span></span>
          </div>
        `).join('');
      } else {
        // Ensure only best time per driver is shown even if cached/older data had duplicates
        const bestByDriver = new Map();
        records.forEach(r => {
          const prev = bestByDriver.get(r.driver);
          if (!prev || Number(r.timeMs) < Number(prev.timeMs)) {
            bestByDriver.set(r.driver, r);
          }
        });
        const uniqueRecords = Array.from(bestByDriver.values())
          .sort((a, b) => Number(a.timeMs) - Number(b.timeMs))
          .slice(0, 100);

        list.innerHTML = uniqueRecords.map((r, i) => `
          <div class="p-2.5 bg-slate-800 rounded-xl flex justify-between items-center text-xs">
            <span class="font-bold ${i===0?'text-amber-400':'text-slate-300'}">#${i+1} ${r.driver}</span>
            <span class="font-mono text-emerald-400 font-bold">${formatTime(r.timeMs)}</span>
          </div>
        `).join('');
      }
    });
}

function renderLevelSelector(levelsArray, containerId, isNight = false) {
  const container = document.getElementById(containerId);
  const clearedSet = isNight ? completedNightLevels : completedLevels;
  container.innerHTML = '';
  levelsArray.forEach(cfg => {
    const isUnlocked = cfg.id === 1 || clearedSet.includes(cfg.id - 1);
    const isCleared = clearedSet.includes(cfg.id);

    const card = document.createElement('div');
    card.className = `p-3 rounded-xl flex justify-between items-center ${isUnlocked ? 'bg-slate-800 cursor-pointer hover:bg-slate-700' : 'bg-slate-900 opacity-50 cursor-not-allowed'}`;
    card.innerHTML = `
      <div>
        <div class="flex items-center space-x-2">
          <span class="font-bold text-xs text-white">${cfg.name} (${cfg.size}x${cfg.size})</span>
          ${isCleared ? '<span class="text-[9px] bg-emerald-900 text-emerald-300 px-1.5 py-0.5 rounded">Cleared</span>' : ''}
        </div>
        <div class="text-[10px] text-slate-400 mt-0.5">Status: ${isUnlocked ? 'Unlocked' : 'Locked'}</div>
      </div>
      <button class="bg-blue-600 text-white p-2 rounded-lg text-xs" ${!isUnlocked ? 'disabled' : ''}>
        <i class="fa-solid ${isUnlocked ? 'fa-play' : 'fa-lock'}"></i>
      </button>
    `;

    if (isUnlocked) {
      card.onclick = () => prepareAndStartLevel(cfg);
    }
    container.appendChild(card);
  });
}

function updateCarColor(color) {
  car.color = color;
  fetch(`${backendUrl}/api/settings/color`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, color })
  });
}

function forfeitAndExitMultiplayer() {
  if (window.currentRoomId && socket.connected) {
    socket.emit('leave_multiplayer', { room_id: window.currentRoomId });
  }
  window.currentRoomId = null;
  window.mpRaceStartTs = null;
  multiplayerGhosts = {};
  gameActive = false;
  isPaused = false;
  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
}

document.getElementById('btn-back-menu').onclick = () => {
  if (isMultiplayerMatch()) {
    const confirmLeave = confirm("Leaving a multiplayer race forfeits the match! You will receive 0 rewards and place last. Leave race?");
    if (!confirmLeave) return;
    forfeitAndExitMultiplayer();
    return;
  }
  gameActive = false;
  isPaused = false;
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
};

document.getElementById('btn-pause-game').onclick = () => togglePause();
document.getElementById('btn-edit-controls-hud').onclick = () => startControlAdjustment();
document.getElementById('btn-full-map').onclick = () => {
  openFullMapModal();
};
document.getElementById('btn-open-settings').onclick = () => openSettingsModal();

function togglePause() {
  if (!gameActive) return;
  isPaused = !isPaused;
  const pauseModal = document.getElementById('modal-pause');
  const titleEl = document.getElementById('pause-modal-title');
  const subtitleEl = document.getElementById('pause-modal-subtitle');
  const restartBtn = document.getElementById('btn-pause-restart');
  const menuBtn = document.getElementById('btn-pause-main-menu');

  if (isMultiplayerMatch()) {
    // Multiplayer Pause Menu: Timer & race continue running in the background
    if (titleEl) titleEl.innerText = "MULTIPLAYER OPTIONS";
    if (subtitleEl) {
      subtitleEl.innerText = "Race timer stays live! Leaving forfeits rewards & places you last.";
      subtitleEl.classList.remove('hidden');
    }
    if (restartBtn) restartBtn.classList.add('hidden');
    if (menuBtn) menuBtn.innerText = "Forfeit & Main Menu";
    pauseModal.classList.toggle('hidden', !isPaused);
  } else {
    // Singleplayer Pause Menu: Stops timer & loop cleanly
    if (titleEl) titleEl.innerText = "GAME PAUSED";
    if (subtitleEl) subtitleEl.classList.add('hidden');
    if (restartBtn) restartBtn.classList.remove('hidden');
    if (menuBtn) menuBtn.innerText = "Main Menu";

    pauseModal.classList.toggle('hidden', !isPaused);
    if (isPaused) {
      pauseStartedAt = performance.now();
    } else {
      if (pauseStartedAt > 0) {
        pausedTimeTotal += performance.now() - pauseStartedAt;
        pauseStartedAt = 0;
      }
      lastFrameTime = performance.now();
      physicsAccumulator = 0;
      gameLoop();
    }
  }
}

function restartCurrentLevel() {
  if (isMultiplayerMatch()) return;
  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
  prepareAndStartLevel(currentMaze);
}

function returnToMenuFromPause() {
  if (isMultiplayerMatch()) {
    forfeitAndExitMultiplayer();
    return;
  }
  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
  gameActive = false;
  isPaused = false;
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
}

function returnToMenuFromVictory() {
  if (isMultiplayerMatch() && socket.connected) {
    socket.emit('leave_multiplayer', { room_id: window.currentRoomId });
  }
  document.getElementById('modal-victory').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  window.currentRoomId = null;
  window.mpRaceStartTs = null;
  multiplayerGhosts = {};
  document.getElementById('modal-menu').classList.remove('hidden');
}

function playNextLevel() {
  document.getElementById('modal-victory').classList.add('hidden');
  if (isMultiplayerMatch()) {
    window.currentRoomId = null;
    window.mpRaceStartTs = null;
    multiplayerGhosts = {};
    document.getElementById('game-hud').classList.add('hidden');
    openMultiplayerSizeModal();
    return;
  }
  if (currentMaze && currentMaze.id < 1300) {
    const listArray = currentMaze.isNightDrive ? NIGHT_DRIVE_1300_LEVELS : CAMPAIGN_100_LEVELS;
    const nextCfg = listArray.find(m => m.id === currentMaze.id + 1);
    if (nextCfg) prepareAndStartLevel(nextCfg);
  }
}
