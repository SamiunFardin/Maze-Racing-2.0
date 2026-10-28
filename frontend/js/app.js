let currentUser = null;
let userCoins = 100;
let completedLevels = [];
let userStats = {};
let currentAuthMode = 'login';

const backendUrl = window.location.hostname === 'localhost' ? 'http://localhost:8000' : window.location.origin;
const socket = io(backendUrl);

// 15, 19. SPLASH SCREEN & LOCAL STORAGE AUTO-RESTORE
window.addEventListener('load', () => {
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 700);
    }

    const savedUser = localStorage.getItem('tm_logged_username');
    const savedPass = localStorage.getItem('tm_logged_password');
    if (savedUser && savedPass) {
      document.getElementById('auth-username').value = savedUser;
      document.getElementById('auth-password').value = savedPass;
      submitAuth();
    } else {
      document.getElementById('modal-auth').classList.remove('hidden');
    }
  }, 2000);
});

// 9. SWITCH LOGIN / SIGNUP TABS
function switchAuthTab(mode) {
  currentAuthMode = mode;
  const isSignup = mode === 'signup';
  document.getElementById('tab-login').className = isSignup ? 'py-2 rounded-lg text-xs font-bold text-slate-400' : 'py-2 rounded-lg text-xs font-bold bg-blue-600 text-white';
  document.getElementById('tab-signup').className = isSignup ? 'py-2 rounded-lg text-xs font-bold bg-blue-600 text-white' : 'py-2 rounded-lg text-xs font-bold text-slate-400';
  document.getElementById('auth-btn-submit').innerText = isSignup ? 'SIGN UP & PLAY' : 'LOGIN';
  document.getElementById('auth-color-section').classList.toggle('hidden', !isSignup);
}

function submitAuth() {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const color = document.getElementById('auth-color-picker').value || '#3b82f6';

  if (!username || !password) {
    alert("Please enter both username and password.");
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
      completedLevels = response.body.user_data.completed_levels || [];
      userStats = response.body.user_data.stats;
      car.color = response.body.user_data.color;

      localStorage.setItem('tm_logged_username', currentUser);
      localStorage.setItem('tm_logged_password', password);

      applyCarStats();
      updateHUDCoins();

      document.getElementById('menu-player-name').innerText = currentUser;
      document.getElementById('modal-auth').classList.add('hidden');
      document.getElementById('modal-menu').classList.remove('hidden');
    } else {
      alert(response.body.detail);
    }
  });
}

function applyCarStats() {
  car.maxSpeed = userStats.topSpeed.current;
  car.accel = userStats.acceleration.current;
  car.brake = userStats.brake.current;
  car.turnSpeed = userStats.turning.current;
  car.friction = userStats.friction.current;
}

function updateHUDCoins() {
  document.getElementById('hud-coins-val').innerText = userCoins;
  document.getElementById('menu-coins-val').innerText = userCoins;
}

// 6. GARAGE WITH DETAILED DESCRIPTIVE NOTES
const STAT_NOTES = {
  topSpeed: "Increases max velocity. Higher = faster top speed, requires precise braking.",
  acceleration: "Increases velocity gain rate off the line.",
  brake: "Increases deceleration power when stopping before walls.",
  turning: "Increases steering sensitivity for sharper corner cutting.",
  drift: "Adjusts tire traction grip around difficult maze corners.",
  reverse: "Increases backing up speed out of dead ends.",
  friction: "Decreases momentum drag when letting go of gas."
};

function renderGarageUI() {
  const container = document.getElementById('garage-stats-container');
  container.innerHTML = Object.keys(userStats).map(stat => {
    const s = userStats[stat];
    const note = STAT_NOTES[stat] || "";
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
            <span>Unlocked Cap: ${s.unlocked} (Max: ${s.max})</span>
            <span class="font-mono text-cyan-400 font-bold" id="val-${stat}">${s.current}</span>
          </div>
          <input type="range" min="${s.min}" max="${s.unlocked}" step="${s.step}" value="${s.current}"
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
      userStats = data.stats;
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
      userStats = data.stats;
      applyCarStats();
    }
  });
}

// 8. MULTIPLAYER QUEUE WITH WAITING ROOM
function joinMultiplayerQueue() {
  if (userCoins < 1) {
    alert("Insufficient coins! Multiplayer entry requires 1 coin.");
    return;
  }
  document.getElementById('modal-menu').classList.add('hidden');
  document.getElementById('modal-waiting-room').classList.remove('hidden');
  socket.emit('join_multiplayer', { username: currentUser, grid_size: 25, color: car.color });
}

function cancelMultiplayerQueue() {
  document.getElementById('modal-waiting-room').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
}

socket.on('waiting_room_update', (data) => {
  window.currentRoomId = data.room_id;
  document.getElementById('waiting-count').innerText = data.count;
  document.getElementById('waiting-players-list').innerHTML = data.players.map(p => `<div>• ${p}</div>`).join('');
});

socket.on('start_multiplayer_race', (data) => {
  document.getElementById('modal-waiting-room').classList.add('hidden');
  const dailyConfig = { id: 8888, name: "Multiplayer Arena", size: 25, seed: Math.floor(Math.random()*10000) };
  prepareAndStartLevel(dailyConfig);
});

function handleCampaignVictory(level_id, time_ms) {
  fetch(`${backendUrl}/api/campaign/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, level_id, time_ms })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      userCoins = data.total_coins;
      completedLevels = data.completed_levels;
      updateHUDCoins();
      document.getElementById('victory-coin-payout').innerText = data.first_time ? "+10 Coins (First Clear!)" : "+0 Coins (Already Cleared)";
      document.getElementById('victory-rank-display').innerText = `Rank #${data.rank} | World Record: ${formatTime(data.world_record)}`;
    }
  });
}

// 1, 12, 13. UI & MODAL EVENT BINDINGS
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function openLevelsModal() {
  openModal('modal-levels');
  renderCategoryTabs();
  renderLevelSelector();
}

function openGarageModal() {
  openModal('modal-garage');
  renderGarageUI();
}

function openSettingsModal() {
  openModal('modal-settings');
}

function openProfileModal() {
  document.getElementById('profile-username').innerText = currentUser;
  document.getElementById('profile-coins').innerText = userCoins;
  document.getElementById('profile-cleared-count').innerText = `${completedLevels.length} / 100`;
  document.getElementById('profile-total-wealth').innerText = userCoins;
  openModal('modal-profile');
}

function openLeaderboardsModal() {
  openModal('modal-leaderboards');
  const sel = document.getElementById('lb-level-select');
  sel.innerHTML = CAMPAIGN_100_LEVELS.map(m => `<option value="${m.id}">${m.name} (${m.size}x${m.size})</option>`).join('');
  fetchLeaderboard(1);
}

function fetchLeaderboard(level_id) {
  fetch(`${backendUrl}/api/leaderboard/level/${level_id}`)
    .then(res => res.json())
    .then(records => {
      const list = document.getElementById('lb-list-container');
      if (records.length === 0) {
        list.innerHTML = '<div class="text-center text-slate-400 py-4 text-xs">No records yet.</div>';
        return;
      }
      list.innerHTML = records.map((r, i) => `
        <div class="p-2.5 bg-slate-800 rounded-xl flex justify-between items-center text-xs">
          <span class="font-bold ${i===0?'text-amber-400':'text-slate-300'}">#${i+1} ${r.driver}</span>
          <span class="font-mono text-emerald-400 font-bold">${formatTime(r.timeMs)}</span>
        </div>
      `).join('');
    });
}

function renderCategoryTabs() {
  const container = document.getElementById('category-tabs');
  container.innerHTML = SIZE_CATEGORIES.map(cat => `
    <button class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${selectedCategoryFilter === cat.key ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}" onclick="filterCategory(${cat.key})">${cat.label}</button>
  `).join('');
}

window.filterCategory = function(size) {
  selectedCategoryFilter = size;
  renderCategoryTabs();
  renderLevelSelector();
};

function renderLevelSelector() {
  const container = document.getElementById('levels-container');
  container.innerHTML = '';
  CAMPAIGN_100_LEVELS.filter(m => m.size === selectedCategoryFilter).forEach(cfg => {
    const isUnlocked = cfg.id === 1 || completedLevels.includes(cfg.id - 1);
    const isCleared = completedLevels.includes(cfg.id);

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

// HUD Button Wiring
document.getElementById('btn-back-menu').onclick = () => {
  gameActive = false;
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
};
document.getElementById('btn-pause-game').onclick = () => togglePause();
document.getElementById('btn-full-map').onclick = () => {
  openModal('modal-full-map');
  renderFullMazeMap();
};
document.getElementById('btn-open-settings').onclick = () => openSettingsModal();

function togglePause() {
  if (!gameActive) return;
  isPaused = !isPaused;
  document.getElementById('modal-pause').classList.toggle('hidden', !isPaused);
}

function restartCurrentLevel() {
  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
  prepareAndStartLevel(currentMaze);
}

function returnToMenuFromPause() {
  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
  gameActive = false;
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
}

function returnToMenuFromVictory() {
  document.getElementById('modal-victory').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
}

function playNextLevel() {
  document.getElementById('modal-victory').classList.add('hidden');
  if (currentMaze && currentMaze.id < 100) {
    const nextCfg = CAMPAIGN_100_LEVELS.find(m => m.id === currentMaze.id + 1);
    if (nextCfg) prepareAndStartLevel(nextCfg);
  }
}

socket.on('player_payout', (data) => {
  userCoins = data.total_coins;
  updateHUDCoins();
  alert(`Multiplayer Finished! Rank #${data.rank} - Earned ${data.payout} Coins!`);
});

socket.on('error_message', (data) => alert(data.detail));
