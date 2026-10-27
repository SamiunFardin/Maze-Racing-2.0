// --- SEEDED LCG PSEUDO-RANDOM GENERATOR ---
function LCG(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// --- COMPLEX DFS MAZE GENERATOR ---
function generateDFSComplexMaze(cols, rows, seed) {
  const rng = LCG(seed);
  const gridCols = cols % 2 === 0 ? cols + 1 : cols;
  const gridRows = rows % 2 === 0 ? rows + 1 : rows;

  const grid = Array(gridRows).fill().map(() => Array(gridCols).fill(1));
  const visited = Array(gridRows).fill().map(() => Array(gridCols).fill(false));

  function getNeighbors(r, c) {
    const neighbors = [];
    const dirs = [[-2, 0], [2, 0], [0, -2], [0, 2]];
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr > 0 && nr < gridRows - 1 && nc > 0 && nc < gridCols - 1 && !visited[nr][nc]) {
        neighbors.push([nr, nc, dr / 2, dc / 2]);
      }
    }
    return neighbors;
  }

  const stack = [[1, 1]];
  grid[1][1] = 0;
  visited[1][1] = true;

  while (stack.length > 0) {
    const [cr, cc] = stack[stack.length - 1];
    const neighbors = getNeighbors(cr, cc);

    if (neighbors.length > 0) {
      const idx = Math.floor(rng() * neighbors.length);
      const [nr, nc, wallR, wallC] = neighbors[idx];

      grid[cr + wallR][cc + wallC] = 0;
      grid[nr][nc] = 0;
      visited[nr][nc] = true;
      stack.push([nr, nc]);
    } else {
      stack.pop();
    }
  }

  grid[1][1] = 0; grid[1][2] = 0; grid[2][1] = 0;
  grid[gridRows - 2][gridCols - 2] = 0;
  grid[gridRows - 2][gridCols - 3] = 0;
  grid[gridRows - 3][gridCols - 2] = 0;

  return {
    grid,
    cols: gridCols,
    rows: gridRows,
    start: { x: 1, y: 1 },
    finish: { x: gridCols - 2, y: gridRows - 2 }
  };
}

// GENERATE ALL 100 CAMPAIGN LEVEL CONFIGURATIONS
const SIZE_CATEGORIES = [
  { key: 25, label: "25x25 (Levels 1-20)" },
  { key: 50, label: "50x50 (Levels 21-40)" },
  { key: 75, label: "75x75 (Levels 41-60)" },
  { key: 100, label: "100x100 (Levels 61-80)" },
  { key: 150, label: "150x150 (Levels 81-90)" },
  { key: 200, label: "200x200 (Levels 91-100)" }
];

const CAMPAIGN_100_LEVELS = [];
for (let i = 1; i <= 100; i++) {
  let size = 25;
  if (i > 20 && i <= 40) size = 50;
  else if (i > 40 && i <= 60) size = 75;
  else if (i > 60 && i <= 80) size = 100;
  else if (i > 80 && i <= 90) size = 150;
  else if (i > 90) size = 200;

  CAMPAIGN_100_LEVELS.push({
    id: i,
    name: `Level ${i}`,
    size: size,
    seed: 1000 + i * 37
  });
}

const generatedMazesCache = {};
function getOrGenerateMaze(cfg) {
  if (!generatedMazesCache[cfg.id]) {
    const gen = generateDFSComplexMaze(cfg.size, cfg.size, cfg.seed);
    generatedMazesCache[cfg.id] = { ...cfg, ...gen, sizeLabel: `${cfg.size}x${cfg.size}` };
  }
  return generatedMazesCache[cfg.id];
}

let currentMaze = null;
let selectedCategoryFilter = 25;

const car = {
  x: 0,
  y: 0,
  angle: 0,
  speed: 0,
  maxSpeed: 6.5,
  accel: 0.050,
  brake: 0.065,
  friction: 0.990,
  turnSpeed: 0.040,
  width: 28,
  height: 48,
  color: '#3b82f6',
  isColliding: false
};

let multiplayerGhosts = {};
let carTrailPath = [];

const inputs = { gas: false, brake: false, steerLeft: false, steerRight: false };

let gameActive = false;
let isPaused = false;
let startTime = 0;
let pausedTimeTotal = 0;
let pauseStartedAt = 0;
let elapsedTime = 0;
let animFrameId = null;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fullMapCanvas = document.getElementById('fullMapCanvas');
const fullMapCtx = fullMapCanvas.getContext('2d');

const TILE_SIZE = 70;

window.addEventListener('load', () => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  setupControls();
});

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
}

function setupControls() {
  const bindPedal = (id, prop) => {
    const el = document.getElementById(id);
    if (!el) return;
    const start = (e) => { e.preventDefault(); inputs[prop] = true; el.classList.add('active'); };
    const end = (e) => { e.preventDefault(); inputs[prop] = false; el.classList.remove('active'); };
    el.addEventListener('touchstart', start); el.addEventListener('touchend', end);
    el.addEventListener('mousedown', start); el.addEventListener('mouseup', end);
  };
  bindPedal('btn-pedal-gas', 'gas');
  bindPedal('btn-pedal-brake', 'brake');

  const bindSteer = (id, dir) => {
    const el = document.getElementById(id);
    if (!el) return;
    const start = (e) => { e.preventDefault(); if (dir==='left') inputs.steerLeft = true; else inputs.steerRight = true; };
    const end = (e) => { e.preventDefault(); if (dir==='left') inputs.steerLeft = false; else inputs.steerRight = false; };
    el.addEventListener('touchstart', start); el.addEventListener('touchend', end);
    el.addEventListener('mousedown', start); el.addEventListener('mouseup', end);
  };
  bindSteer('btn-steer-left', 'left');
  bindSteer('btn-steer-right', 'right');

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'w') inputs.gas = true;
    if (e.key === 'ArrowDown' || e.key === 's') inputs.brake = true;
    if (e.key === 'ArrowLeft' || e.key === 'a') inputs.steerLeft = true;
    if (e.key === 'ArrowRight' || e.key === 'd') inputs.steerRight = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'w') inputs.gas = false;
    if (e.key === 'ArrowDown' || e.key === 's') inputs.brake = false;
    if (e.key === 'ArrowLeft' || e.key === 'a') inputs.steerLeft = false;
    if (e.key === 'ArrowRight' || e.key === 'd') inputs.steerRight = false;
  });
}

function startLevel(mazeConfig) {
  currentMaze = getOrGenerateMaze(mazeConfig);
  document.getElementById('hud-level-title').innerText = `${currentMaze.name} (${currentMaze.sizeLabel})`;

  carTrailPath = [];
  car.x = (currentMaze.start.x + 0.5) * TILE_SIZE;
  car.y = (currentMaze.start.y + 0.5) * TILE_SIZE;
  car.speed = 0;
  car.angle = 0;
  car.isColliding = false;
  carTrailPath.push({ x: car.x, y: car.y });

  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));

  gameActive = true;
  isPaused = false;
  startTime = performance.now();
  pausedTimeTotal = 0;

  if (animFrameId) cancelAnimationFrame(animFrameId);
  gameLoop();
}

function updatePhysics() {
  let turnInput = 0;
  if (inputs.steerLeft) turnInput = -1;
  if (inputs.steerRight) turnInput = 1;

  if (Math.abs(car.speed) > 0.1) {
    car.angle += turnInput * car.turnSpeed * (car.speed > 0 ? 1 : -1);
  }

  if (inputs.gas) {
    car.speed = Math.min(car.speed + car.accel, car.maxSpeed);
  } else if (inputs.brake) {
    car.speed = Math.max(car.speed - car.brake, -car.maxSpeed * 0.4);
  } else {
    car.speed *= car.friction;
  }

  const vx = Math.sin(car.angle) * car.speed;
  const vy = -Math.cos(car.angle) * car.speed;

  const nextX = car.x + vx;
  const nextY = car.y + vy;

  const checkCollision = (px, py) => {
    const col = Math.floor(px / TILE_SIZE);
    const row = Math.floor(py / TILE_SIZE);
    if (row < 0 || row >= currentMaze.rows || col < 0 || col >= currentMaze.cols) return true;
    return currentMaze.grid[row][col] === 1;
  };

  const collisionRadius = 18;
  let collided = false;

  if (!checkCollision(nextX + (vx > 0 ? collisionRadius : -collisionRadius), car.y)) {
    car.x = nextX;
  } else {
    if (Math.abs(car.speed) > 1.5) audioEngine.playRecoilImpact();
    car.speed = -car.speed * 0.4;
    collided = true;
  }

  if (!checkCollision(car.x, nextY + (vy > 0 ? collisionRadius : -collisionRadius))) {
    car.y = nextY;
  } else {
    if (Math.abs(car.speed) > 1.5) audioEngine.playRecoilImpact();
    car.speed = -car.speed * 0.4;
    collided = true;
  }

  car.isColliding = collided;

  if (typeof socket !== 'undefined' && socket.connected && window.currentRoomId) {
    socket.emit('player_move', {
      room_id: window.currentRoomId,
      x: car.x,
      y: car.y,
      angle: car.angle
    });
  }

  const lastPoint = carTrailPath[carTrailPath.length - 1];
  if (Math.hypot(car.x - lastPoint.x, car.y - lastPoint.y) > 10) {
    carTrailPath.push({ x: car.x, y: car.y });
  }

  const currentCol = Math.floor(car.x / TILE_SIZE);
  const currentRow = Math.floor(car.y / TILE_SIZE);
  if (currentCol === currentMaze.finish.x && currentRow === currentMaze.finish.y) {
    triggerVictory();
  }
}

function renderWorld() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const screenCenterX = canvas.width / 2;
  const screenCenterY = canvas.height / 2;

  ctx.save();
  ctx.translate(screenCenterX, screenCenterY);
  ctx.rotate(-car.angle);
  ctx.translate(-car.x, -car.y);

  for (let r = 0; r < currentMaze.rows; r++) {
    for (let c = 0; c < currentMaze.cols; c++) {
      const x = c * TILE_SIZE;
      const y = r * TILE_SIZE;
      if (currentMaze.grid[r][c] === 1) {
        ctx.fillStyle = '#1e293b'; ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      } else {
        ctx.fillStyle = '#0f172a'; ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  if (carTrailPath.length > 1) {
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(carTrailPath[0].x, carTrailPath[0].y);
    for (let i = 1; i < carTrailPath.length; i++) ctx.lineTo(carTrailPath[i].x, carTrailPath[i].y);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
  ctx.fillRect(currentMaze.start.x * TILE_SIZE, currentMaze.start.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.4)';
  ctx.fillRect(currentMaze.finish.x * TILE_SIZE, currentMaze.finish.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

  for (let sid in multiplayerGhosts) {
    let g = multiplayerGhosts[sid];
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = g.color || '#94a3b8';
    ctx.fillRect(-car.width/2, -car.height/2, car.width, car.height);
    ctx.restore();
  }

  ctx.restore();

  ctx.save();
  ctx.translate(screenCenterX, screenCenterY);
  ctx.fillStyle = car.isColliding ? '#dc2626' : car.color;
  ctx.beginPath();
  ctx.roundRect(-car.width / 2, -car.height / 2, car.width, car.height, 8);
  ctx.fill();
  ctx.strokeStyle = car.isColliding ? '#f87171' : '#38bdf8';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  if (gameActive && !isPaused) renderMiniMap();
}

function renderMiniMap() {
  const mapSize = 105;
  const x = canvas.width - mapSize - 12;
  const y = 65;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(x, y, mapSize, mapSize);
  ctx.strokeStyle = '#334155';
  ctx.strokeRect(x, y, mapSize, mapSize);

  const scaleX = mapSize / (currentMaze.cols * TILE_SIZE);
  const scaleY = mapSize / (currentMaze.rows * TILE_SIZE);

  const carMinimapX = x + car.x * scaleX;
  const carMinimapY = y + car.y * scaleY;

  ctx.save();
  ctx.translate(carMinimapX, carMinimapY);
  ctx.rotate(car.angle);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.fill();
  ctx.restore();
}

function triggerVictory() {
  gameActive = false;
  audioEngine.playVictoryFanfare();
  document.getElementById('victory-final-time').innerText = formatTime(elapsedTime);
  document.getElementById('modal-victory').classList.remove('hidden');

  if (currentMaze.isDaily) {
    handleDailySubmission(elapsedTime);
  } else {
    handleCampaignVictory(currentMaze.id, elapsedTime);
  }
}

function gameLoop() {
  if (!gameActive || isPaused) return;
  updatePhysics();
  renderWorld();
  elapsedTime = performance.now() - startTime - pausedTimeTotal;
  document.getElementById('hud-timer').innerText = formatTime(elapsedTime);
  animFrameId = requestAnimationFrame(gameLoop);
}

function formatTime(ms) {
  if (!ms || isNaN(ms)) return '00:00.000';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
