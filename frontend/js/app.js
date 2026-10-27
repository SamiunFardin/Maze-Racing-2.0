let currentUser = null;
let userCoins = 100;
let completedLevels = [];
let userStats = {};

const backendUrl = window.location.hostname === 'localhost' ? 'http://localhost:8000' : window.location.origin;
const socket = io(backendUrl);

function handleAuthLogin() {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const color = document.getElementById('auth-color-picker').value;

  if (!username || !password) {
    alert("Please enter both username and password.");
    return;
  }

  fetch(`${backendUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, color })
  })
  .then(res => res.json().then(data => ({ status: res.status, body: data })))
  .then(response => {
    if (response.status === 200) {
      currentUser = response.body.username;
      userCoins = response.body.user_data.coins;
      completedLevels = response.body.user_data.completed_levels || [];
      userStats = response.body.user_data.stats;
      car.color = response.body.user_data.color;

      applyCarStats();

      document.getElementById('hud-coins-val').innerText = userCoins;
      document.getElementById('modal-auth').classList.add('hidden');
      document.getElementById('modal-menu').classList.remove('hidden');
    } else {
      alert(response.body.detail);
    }
  })
  .catch(err => console.error("Auth login error:", err));
}

function applyCarStats() {
  car.maxSpeed = userStats.topSpeed.current;
  car.accel = userStats.acceleration.current;
  car.brake = userStats.brake.current;
  car.turnSpeed = userStats.turning.current;
  car.friction = userStats.friction.current;
}

function renderGarageUI() {
  const container = document.getElementById('garage-stats-container');
  container.innerHTML = Object.keys(userStats).map(stat => {
    const s = userStats[stat];
    return `
      <div class="p-3 bg-slate-800 rounded-xl border border-slate-700 space-y-2">
        <div class="flex justify-between items-center">
          <div>
            <div class="font-bold text-xs uppercase text-slate-200">${stat}</div>
            <div class="text-[10px] text-slate-400">Unlocked Cap: ${s.unlocked}</div>
          </div>
          <button onclick="upgradeStatCap('${stat}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2.5 py-1 rounded-lg text-xs">
            + Tier (10 Coins)
          </button>
        </div>
        <div>
          <div class="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>Tuning Slider</span>
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
      document.getElementById('hud-coins-val').innerText = userCoins;
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
      document.getElementById('hud-coins-val').innerText = userCoins;
      document.getElementById('victory-coin-payout').innerText = data.first_time ? "+10 Coins (First Clear!)" : "+0 Coins (Already Cleared)";
    }
  });
}

function handleDailySubmission(time_ms) {
  fetch(`${backendUrl}/api/daily/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, time_ms })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === 'success') {
      document.getElementById('victory-coin-payout').innerText = `Daily Challenge Rank #${data.rank} Recorded!`;
    }
  });
}

// Menu Bindings
document.getElementById('menu-btn-play').onclick = () => {
  document.getElementById('modal-levels').classList.remove('hidden');
  renderCategoryTabs();
  renderLevelSelector();
};

document.getElementById('menu-btn-daily').onclick = () => {
  const d = new Date();
  const dateSeed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const dailyConfig = { id: 9999, name: "Daily Challenge", size: 50, seed: dateSeed, isDaily: true };
  startLevel(dailyConfig);
};

document.getElementById('menu-btn-multiplayer').onclick = () => {
  socket.emit('join_multiplayer', { username: currentUser, grid_size: 25, color: car.color });
};

document.getElementById('menu-btn-garage').onclick = () => {
  document.getElementById('modal-garage').classList.remove('hidden');
  renderGarageUI();
};

document.getElementById('btn-back-menu').onclick = () => {
  gameActive = false;
  document.getElementById('modal-menu').classList.remove('hidden');
};

document.getElementById('victory-btn-home').onclick = () => {
  document.getElementById('modal-victory').classList.add('hidden');
  document.getElementById('modal-menu').classList.remove('hidden');
};

document.getElementById('victory-btn-restart').onclick = () => startLevel(currentMaze);

document.getElementById('victory-btn-next').onclick = () => {
  if (currentMaze && currentMaze.id < 100) {
    const nextCfg = CAMPAIGN_100_LEVELS.find(m => m.id === currentMaze.id + 1);
    if (nextCfg) startLevel(nextCfg);
  }
};

function renderCategoryTabs() {
  const container = document.getElementById('category-tabs');
  container.innerHTML = SIZE_CATEGORIES.map(cat => `
    <button class="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${selectedCategoryFilter === cat.key ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}" onclick="filterCategory(${cat.key})">
      ${cat.label}
    </button>
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
    card.className = `p-3 rounded-xl flex justify-between items-center ${isUnlocked ? 'bg-slate-800 cursor-pointer' : 'bg-slate-900 opacity-50 cursor-not-allowed'}`;
    card.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="font-bold text-xs">${cfg.name} (${cfg.size}x${cfg.size})</span>
        ${isCleared ? '<span class="text-[9px] bg-emerald-900 text-emerald-300 px-1.5 py-0.5 rounded">Cleared</span>' : ''}
      </div>
      <button class="bg-blue-600 text-white p-2 rounded-lg text-xs" ${!isUnlocked ? 'disabled' : ''}>
        <i class="fa-solid ${isUnlocked ? 'fa-play' : 'fa-lock'}"></i>
      </button>
    `;

    if (isUnlocked) {
      card.onclick = () => startLevel(cfg);
    }
    container.appendChild(card);
  });
}

socket.on('player_payout', (data) => {
  userCoins = data.total_coins;
  document.getElementById('hud-coins-val').innerText = userCoins;
  alert(`Multiplayer Finished! Rank #${data.rank} - Earned ${data.payout} Coins!`);
});

socket.on('error_message', (data) => alert(data.detail));
