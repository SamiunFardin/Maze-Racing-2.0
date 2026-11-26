function LCG(seed) {
  let s = Math.floor(Number(seed)) || 123456;
  return function() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

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

const CAMPAIGN_100_LEVELS = [];
for (let i = 1; i <= 1300; i++) {
  let size = 25;
  if (i > 10 && i <= 50) size = 50;
  else if (i > 50 && i <= 140) size = 75;
  else if (i > 140 && i <= 300) size = 100;
  else if (i > 300 && i <= 660) size = 150;
  else if (i > 660) size = 200;

  CAMPAIGN_100_LEVELS.push({ id: i, name: `Level ${i}`, size: size, seed: 1000 + i * 37 });
}

const NIGHT_DRIVE_1300_LEVELS = [];
for (let i = 1; i <= 1300; i++) {
  let size = 25;
  if (i > 10 && i <= 50) size = 50;
  else if (i > 50 && i <= 140) size = 75;
  else if (i > 140 && i <= 300) size = 100;
  else if (i > 300 && i <= 660) size = 150;
  else if (i > 660) size = 200;

  NIGHT_DRIVE_1300_LEVELS.push({ id: i, name: `Night Level ${i}`, size: size, seed: 99999 + i * 53, isNightDrive: true });
}

const generatedMazesCache = {};
function getOrGenerateMaze(cfg) {
  const numericSize = Number(cfg.size);
  const numericSeed = Math.floor(Number(cfg.seed));
  const cacheKey = `${cfg.isNightDrive ? 'night_' : 'std_'}_${cfg.id}_${numericSize}_${numericSeed}`;
  if (!generatedMazesCache[cacheKey]) {
    const gen = generateDFSComplexMaze(numericSize, numericSize, numericSeed);
    generatedMazesCache[cacheKey] = { ...cfg, size: numericSize, seed: numericSeed, ...gen, sizeLabel: `${numericSize}x${numericSize}` };
  }
  return generatedMazesCache[cacheKey];
}

let currentMaze = null;

const car = {
  x: 0,
  y: 0,
  angle: 0,
  speed: 0,
  maxSpeed: 5.0,
  accel: 0.03,
  brake: 0.04,
  friction: 0.975,
  turnSpeed: 0.025,
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

// Fixed-timestep physics accumulator (60 Hz reference step) so speed is identical across all devices/refresh rates
const FIXED_PHYSICS_DT = 1 / 60;
const MAX_FRAME_DT = 0.05;
let lastFrameTime = 0;
let physicsAccumulator = 0;

// Daily Challenge collision penalty state (2 seconds = 2000 ms per collision)
const DAILY_COLLISION_PENALTY_MS = 2000;
let dailyCollisionCount = 0;

// Minimap bounding box for touch/click detection
let minimapRect = { x: 0, y: 76, size: 110 };

// Full Map Zoom & Pan state
let fullMapState = {
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isDragging: false,
  lastX: 0,
  lastY: 0,
  initialPinchDist: null,
  initialZoom: 1.0
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fullMapCanvas = document.getElementById('fullMapCanvas');
const fullMapCtx = fullMapCanvas.getContext('2d');
const TILE_SIZE = 70;

window.addEventListener('load', () => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  setupControls();
  setupControlDragging();
  setupMinimapTap();
  setupFullMapGestures();
});

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  if (container) {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  }
}

function isMultiplayerMatch() {
  return Boolean(window.currentRoomId);
}

function isDailyChallengeMatch() {
  return Boolean(currentMaze && currentMaze.isDaily);
}

function updateHUDDailyCollisions() {
  const badge = document.getElementById('hud-daily-collisions');
  const valEl = document.getElementById('hud-daily-collisions-val');
  if (!badge || !valEl) return;
  if (isDailyChallengeMatch()) {
    badge.classList.remove('hidden');
    valEl.innerText = dailyCollisionCount;
  } else {
    badge.classList.add('hidden');
  }
}

function setupMinimapTap() {
  const handleTap = (clientX, clientY) => {
    if (!gameActive || !currentMaze || currentMaze.isNightDrive) return;
    if (!document.getElementById('edit-layout-banner').classList.contains('hidden')) return;

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (
      x >= minimapRect.x &&
      x <= minimapRect.x + minimapRect.size &&
      y >= minimapRect.y &&
      y <= minimapRect.y + minimapRect.size
    ) {
      openFullMapModal();
    }
  };

  canvas.addEventListener('click', (e) => handleTap(e.clientX, e.clientY));
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      handleTap(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });
}

function openFullMapModal() {
  if (!currentMaze) return;
  resetFullMapTransform();
  openModal('modal-full-map');
  renderFullMazeMap();
}

function resetFullMapTransform() {
  fullMapState.zoom = 1.0;
  fullMapState.panX = 0;
  fullMapState.panY = 0;
  fullMapState.isDragging = false;
  fullMapState.initialPinchDist = null;
}

function setupFullMapGestures() {
  if (!fullMapCanvas) return;

  // 1-Finger Touch Pan & 2-Finger Pinch-to-Zoom
  fullMapCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      fullMapState.isDragging = true;
      fullMapState.lastX = e.touches[0].clientX;
      fullMapState.lastY = e.touches[0].clientY;
      fullMapState.initialPinchDist = null;
    } else if (e.touches.length === 2) {
      fullMapState.isDragging = false;
      fullMapState.initialPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      fullMapState.initialZoom = fullMapState.zoom;
    }
  }, { passive: false });

  fullMapCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && fullMapState.isDragging) {
      const dx = e.touches[0].clientX - fullMapState.lastX;
      const dy = e.touches[0].clientY - fullMapState.lastY;
      fullMapState.panX += dx;
      fullMapState.panY += dy;
      fullMapState.lastX = e.touches[0].clientX;
      fullMapState.lastY = e.touches[0].clientY;
      renderFullMazeMap();
    } else if (e.touches.length === 2 && fullMapState.initialPinchDist) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scaleFactor = dist / fullMapState.initialPinchDist;
      fullMapState.zoom = Math.max(0.5, Math.min(8.0, fullMapState.initialZoom * scaleFactor));
      renderFullMazeMap();
    }
  }, { passive: false });

  fullMapCanvas.addEventListener('touchend', () => {
    fullMapState.isDragging = false;
    fullMapState.initialPinchDist = null;
  });

  // Desktop Mouse Drag Pan & Wheel Zoom support
  fullMapCanvas.addEventListener('mousedown', (e) => {
    fullMapState.isDragging = true;
    fullMapState.lastX = e.clientX;
    fullMapState.lastY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!fullMapState.isDragging) return;
    const dx = e.clientX - fullMapState.lastX;
    const dy = e.clientY - fullMapState.lastY;
    fullMapState.panX += dx;
    fullMapState.panY += dy;
    fullMapState.lastX = e.clientX;
    fullMapState.lastY = e.clientY;
    renderFullMazeMap();
  });

  window.addEventListener('mouseup', () => {
    fullMapState.isDragging = false;
  });

  fullMapCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    fullMapState.zoom = Math.max(0.5, Math.min(8.0, fullMapState.zoom * factor));
    renderFullMazeMap();
  }, { passive: false });
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

function setupControlDragging() {
  const leftWrapper = document.getElementById('ctrl-buttons-wrapper');
  const rightWrapper = document.getElementById('ctrl-pedals-wrapper');

  let activeDrag = null;
  let startX = 0, startY = 0;

  const onDragStart = (e, el) => {
    if (!document.getElementById('edit-layout-banner').classList.contains('hidden')) {
      activeDrag = el;
      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX - el.offsetLeft;
      startY = touch.clientY - el.offsetTop;
      e.preventDefault();
    }
  };

  const onDragMove = (e) => {
    if (!activeDrag) return;
    const touch = e.touches ? e.touches[0] : e;
    const x = touch.clientX - startX;
    const y = touch.clientY - startY;
    activeDrag.style.left = `${Math.max(10, Math.min(window.innerWidth - activeDrag.offsetWidth - 10, x))}px`;
    activeDrag.style.bottom = 'auto';
    activeDrag.style.top = `${Math.max(10, Math.min(window.innerHeight - activeDrag.offsetHeight - 10, y))}px`;
  };

  const onDragEnd = () => { activeDrag = null; };

  leftWrapper.addEventListener('mousedown', (e) => onDragStart(e, leftWrapper));
  leftWrapper.addEventListener('touchstart', (e) => onDragStart(e, leftWrapper));
  rightWrapper.addEventListener('mousedown', (e) => onDragStart(e, rightWrapper));
  rightWrapper.addEventListener('touchstart', (e) => onDragStart(e, rightWrapper));

  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('touchmove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('touchend', onDragEnd);
}

const GAME_TIPS = [
  "Upgrade your car from the garage for better performance and higher top speeds!",
  "In Daily Challenge, every wall collision adds a +2.0s penalty to your final time!",
  "Larger multiplayer grids award massive doubled coin multipliers for 1st place!",
  "Tap the top-right minimap anytime to open the zoomable full maze map.",
  "Top-100 leaderboards pay out daily for Daily Challenge and weekly for Campaign levels!"
];

function getRandomTip() {
  return GAME_TIPS[Math.floor(Math.random() * GAME_TIPS.length)];
}

function prepareAndStartLevel(mazeConfig) {
  currentMaze = getOrGenerateMaze(mazeConfig);
  document.getElementById('hud-level-title').innerText = `${currentMaze.name} (${currentMaze.sizeLabel})`;

  dailyCollisionCount = 0;
  updateHUDDailyCollisions();
  carTrailPath = [];
  car.x = (currentMaze.start.x + 0.5) * TILE_SIZE;
  car.y = (currentMaze.start.y + 0.5) * TILE_SIZE;
  car.speed = 0;
  car.angle = 0;
  car.isColliding = false;
  carTrailPath.push({ x: car.x, y: car.y });

  // Reset inputs so car never auto-accelerates
  inputs.gas = false;
  inputs.brake = false;
  inputs.steerLeft = false;
  inputs.steerRight = false;

  document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));

  const countdownModal = document.getElementById('modal-countdown');
  const numElem = document.getElementById('countdown-number');
  const tipElem = document.getElementById('countdown-tip-text');
  
  tipElem.innerText = getRandomTip();
  countdownModal.classList.remove('hidden');

  let count = 3;
  numElem.innerText = count;
  audioEngine.playBeep(440, 0.2);

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      numElem.innerText = count;
      audioEngine.playBeep(440, 0.2);
    } else if (count === 0) {
      numElem.innerText = "GO!";
      audioEngine.playBeep(880, 0.4);
    } else {
      clearInterval(timer);
      countdownModal.classList.add('hidden');
      startGameLoop();
    }
  }, 1000);
}

function startGameLoop() {
  document.getElementById('game-hud').classList.remove('hidden');
  updateHUDDailyCollisions();
  gameActive = true;
  isPaused = false;
  const now = performance.now();
  startTime = now;
  lastFrameTime = now;
  physicsAccumulator = 0;
  pausedTimeTotal = 0;
  pauseStartedAt = 0;
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
    if (Math.abs(car.speed) > 1.0) audioEngine.playRecoilImpact();
    car.speed = -car.speed * 0.4;
    collided = true;
  }

  if (!checkCollision(car.x, nextY + (vy > 0 ? collisionRadius : -collisionRadius))) {
    car.y = nextY;
  } else {
    if (Math.abs(car.speed) > 1.0) audioEngine.playRecoilImpact();
    car.speed = -car.speed * 0.4;
    collided = true;
  }

  // Count each wall collision once per step during Daily Challenge mode
  if (collided && !car.isColliding && isDailyChallengeMatch()) {
    dailyCollisionCount += 1;
    updateHUDDailyCollisions();
  }

  car.isColliding = collided;

  if (typeof socket !== 'undefined' && socket.connected && window.currentRoomId) {
    socket.emit('player_move', { room_id: window.currentRoomId, x: car.x, y: car.y, angle: car.angle });
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

function drawNameTag(context, label, x, y, bgColor = 'rgba(15, 23, 42, 0.85)', textColor = '#f8fafc') {
  if (!label) return;
  context.save();
  context.font = 'bold 11px system-ui, -apple-system, sans-serif';
  const paddingX = 6;
  const textWidth = context.measureText(label).width;
  const boxW = textWidth + paddingX * 2;
  const boxH = 18;
  const boxX = x - boxW / 2;
  const boxY = y - boxH;

  context.fillStyle = bgColor;
  context.beginPath();
  context.roundRect(boxX, boxY, boxW, boxH, 5);
  context.fill();
  context.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = textColor;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x, boxY + boxH / 2);
  context.restore();
}

function renderWorld() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const screenCenterX = canvas.width / 2;
  const screenCenterY = canvas.height / 2;

  ctx.save();
  ctx.translate(screenCenterX, screenCenterY);
  ctx.rotate(-car.angle);
  ctx.translate(-car.x, -car.y);

  // View culling: only iterate and draw maze tiles within the rotated viewport radius
  const halfDiag = Math.hypot(screenCenterX, screenCenterY);
  const cullRadius = halfDiag + TILE_SIZE * 1.5;
  const cullRadiusSq = cullRadius * cullRadius;

  const minCol = Math.max(0, Math.floor((car.x - cullRadius) / TILE_SIZE));
  const maxCol = Math.min(currentMaze.cols - 1, Math.floor((car.x + cullRadius) / TILE_SIZE));
  const minRow = Math.max(0, Math.floor((car.y - cullRadius) / TILE_SIZE));
  const maxRow = Math.min(currentMaze.rows - 1, Math.floor((car.y + cullRadius) / TILE_SIZE));

  for (let r = minRow; r <= maxRow; r++) {
    const y = r * TILE_SIZE;
    const centerY = y + TILE_SIZE * 0.5;
    const dy = centerY - car.y;
    const dySq = dy * dy;

    for (let c = minCol; c <= maxCol; c++) {
      const x = c * TILE_SIZE;
      const centerX = x + TILE_SIZE * 0.5;
      const dx = centerX - car.x;

      if (dx * dx + dySq > cullRadiusSq) continue;

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

  ctx.fillStyle = 'rgba(16, 185, 129, 0.45)';
  ctx.fillRect(currentMaze.start.x * TILE_SIZE, currentMaze.start.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.5)';
  ctx.fillRect(currentMaze.finish.x * TILE_SIZE, currentMaze.finish.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

  // Render opponent ghosts + upright usernames in Multiplayer
  for (let sid in multiplayerGhosts) {
    let g = multiplayerGhosts[sid];
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = g.color || '#94a3b8';
    ctx.beginPath();
    ctx.roundRect(-car.width / 2, -car.height / 2, car.width, car.height, 7);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (isMultiplayerMatch() && g.username) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(car.angle); // Keep label upright relative to player's screen camera
      drawNameTag(ctx, g.username, 0, -car.height / 2 - 10, 'rgba(15, 23, 42, 0.85)', '#fde047');
      ctx.restore();
    }
  }

  ctx.restore();

  // Render Player's Car at center
  ctx.save();
  ctx.translate(screenCenterX, screenCenterY);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(-car.width / 2 + 4, -car.height / 2 + 4, car.width, car.height);

  ctx.fillStyle = car.isColliding ? '#dc2626' : car.color;
  ctx.beginPath();
  ctx.roundRect(-car.width / 2, -car.height / 2, car.width, car.height, 8);
  ctx.fill();
  ctx.strokeStyle = car.isColliding ? '#f87171' : '#38bdf8';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-car.width / 2 + 4, -car.height / 2 + 10, car.width - 8, 16);

  ctx.fillStyle = car.isColliding ? '#ef4444' : '#fef08a';
  ctx.fillRect(-car.width / 2 + 3, -car.height / 2 + 2, 6, 4);
  ctx.fillRect(car.width / 2 - 9, -car.height / 2 + 2, 6, 4);

  // Render local player's username above car in Multiplayer mode
  if (isMultiplayerMatch() && typeof currentUser === 'string' && currentUser) {
    drawNameTag(ctx, currentUser, 0, -car.height / 2 - 10, 'rgba(37, 99, 235, 0.9)', '#ffffff');
  }
  ctx.restore();

  if (currentMaze && currentMaze.isNightDrive) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const radius = 2.5 * TILE_SIZE;
    const grad = ctx.createRadialGradient(screenCenterX, screenCenterY, radius * 0.4, screenCenterX, screenCenterY, radius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  if (gameActive && (!currentMaze || !currentMaze.isNightDrive)) {
    renderMiniMap();
  }
}

function renderMiniMap() {
  const mapSize = 110;
  const hudEl = document.getElementById('game-hud');
  const hudRect = hudEl && !hudEl.classList.contains('hidden') ? hudEl.getBoundingClientRect() : null;
  const x = canvas.width - mapSize - 12;
  const y = hudRect ? Math.max(76, Math.round(hudRect.bottom + 10)) : 76;
  minimapRect = { x, y, size: mapSize };

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.fillRect(x, y, mapSize, mapSize);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, mapSize, mapSize);

  const cellW = mapSize / currentMaze.cols;
  const cellH = mapSize / currentMaze.rows;
  const scaleX = mapSize / (currentMaze.cols * TILE_SIZE);
  const scaleY = mapSize / (currentMaze.rows * TILE_SIZE);

  // Walls
  for (let r = 0; r < currentMaze.rows; r++) {
    for (let c = 0; c < currentMaze.cols; c++) {
      if (currentMaze.grid[r][c] === 1) {
        ctx.fillStyle = '#475569';
        ctx.fillRect(x + c * cellW, y + r * cellH, Math.max(1, cellW), Math.max(1, cellH));
      }
    }
  }

  // Start Marker (Bright Green)
  ctx.fillStyle = '#10b981';
  ctx.fillRect(
    x + currentMaze.start.x * cellW - 1,
    y + currentMaze.start.y * cellH - 1,
    Math.max(4, cellW + 2),
    Math.max(4, cellH + 2)
  );

  // Finish Marker (Bright Gold/Amber)
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(
    x + currentMaze.finish.x * cellW - 1,
    y + currentMaze.finish.y * cellH - 1,
    Math.max(4, cellW + 2),
    Math.max(4, cellH + 2)
  );

  // Player Trail
  if (carTrailPath.length > 1) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x + carTrailPath[0].x * scaleX, y + carTrailPath[0].y * scaleY);
    for (let i = 1; i < carTrailPath.length; i++) {
      ctx.lineTo(x + carTrailPath[i].x * scaleX, y + carTrailPath[i].y * scaleY);
    }
    ctx.stroke();
  }

  // Opponent Ghosts on Minimap
  for (let sid in multiplayerGhosts) {
    const g = multiplayerGhosts[sid];
    ctx.fillStyle = g.color || '#facc15';
    ctx.beginPath();
    ctx.arc(x + g.x * scaleX, y + g.y * scaleY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player Position Arrow
  const carMinimapX = x + car.x * scaleX;
  const carMinimapY = y + car.y * scaleY;
  ctx.save();
  ctx.translate(carMinimapX, carMinimapY);
  ctx.rotate(car.angle);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(3.5, 3.5);
  ctx.lineTo(-3.5, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function renderFullMazeMap() {
  if (!currentMaze || !fullMapCanvas) return;
  const containerW = fullMapCanvas.parentElement.clientWidth - 16;
  const containerH = fullMapCanvas.parentElement.clientHeight - 16;
  if (containerW <= 0 || containerH <= 0) return;

  fullMapCanvas.width = containerW;
  fullMapCanvas.height = containerH;
  fullMapCtx.clearRect(0, 0, containerW, containerH);

  const baseTileSize = Math.min(containerW / currentMaze.cols, containerH / currentMaze.rows);
  const tileSize = baseTileSize * fullMapState.zoom;
  const mapWidth = tileSize * currentMaze.cols;
  const mapHeight = tileSize * currentMaze.rows;

  const offsetX = (containerW - mapWidth) / 2 + fullMapState.panX;
  const offsetY = (containerH - mapHeight) / 2 + fullMapState.panY;

  fullMapCtx.save();

  // Draw Maze Grid
  for (let r = 0; r < currentMaze.rows; r++) {
    for (let c = 0; c < currentMaze.cols; c++) {
      fullMapCtx.fillStyle = currentMaze.grid[r][c] === 1 ? '#1e3a8a' : '#0f172a';
      fullMapCtx.fillRect(offsetX + c * tileSize, offsetY + r * tileSize, tileSize + 0.5, tileSize + 0.5);
    }
  }

  // Draw Start Tile (Green)
  fullMapCtx.fillStyle = '#10b981';
  fullMapCtx.fillRect(
    offsetX + currentMaze.start.x * tileSize,
    offsetY + currentMaze.start.y * tileSize,
    tileSize,
    tileSize
  );

  // Draw Finish Tile (Amber/Gold)
  fullMapCtx.fillStyle = '#f59e0b';
  fullMapCtx.fillRect(
    offsetX + currentMaze.finish.x * tileSize,
    offsetY + currentMaze.finish.y * tileSize,
    tileSize,
    tileSize
  );

  const worldToMapX = (wx) => offsetX + (wx / TILE_SIZE) * tileSize;
  const worldToMapY = (wy) => offsetY + (wy / TILE_SIZE) * tileSize;

  // Draw Car's Driven Trail
  if (carTrailPath.length > 1) {
    fullMapCtx.strokeStyle = '#38bdf8';
    fullMapCtx.lineWidth = Math.max(2, tileSize * 0.28);
    fullMapCtx.lineCap = 'round';
    fullMapCtx.lineJoin = 'round';
    fullMapCtx.beginPath();
    fullMapCtx.moveTo(worldToMapX(carTrailPath[0].x), worldToMapY(carTrailPath[0].y));
    for (let i = 1; i < carTrailPath.length; i++) {
      fullMapCtx.lineTo(worldToMapX(carTrailPath[i].x), worldToMapY(carTrailPath[i].y));
    }
    fullMapCtx.stroke();
  }

  // Draw Multiplayer Ghosts on Full Map
  for (let sid in multiplayerGhosts) {
    const g = multiplayerGhosts[sid];
    const gx = worldToMapX(g.x);
    const gy = worldToMapY(g.y);
    fullMapCtx.fillStyle = g.color || '#facc15';
    fullMapCtx.beginPath();
    fullMapCtx.arc(gx, gy, Math.max(4, tileSize * 0.35), 0, Math.PI * 2);
    fullMapCtx.fill();
  }

  // Draw Current Car Position & Heading Arrow
  const cx = worldToMapX(car.x);
  const cy = worldToMapY(car.y);
  const markerRadius = Math.max(5, tileSize * 0.45);

  fullMapCtx.save();
  fullMapCtx.translate(cx, cy);
  fullMapCtx.rotate(car.angle);
  fullMapCtx.fillStyle = '#ef4444';
  fullMapCtx.strokeStyle = '#ffffff';
  fullMapCtx.lineWidth = 1.5;
  fullMapCtx.beginPath();
  fullMapCtx.moveTo(0, -markerRadius * 1.3);
  fullMapCtx.lineTo(markerRadius, markerRadius);
  fullMapCtx.lineTo(0, markerRadius * 0.55);
  fullMapCtx.lineTo(-markerRadius, markerRadius);
  fullMapCtx.closePath();
  fullMapCtx.fill();
  fullMapCtx.stroke();
  fullMapCtx.restore();

  fullMapCtx.restore();
}

function triggerVictory() {
  gameActive = false;
  audioEngine.playVictoryFanfare();

  const penaltyBox = document.getElementById('victory-daily-penalty-box');
  let recordedTimeMs = elapsedTime;

  if (isDailyChallengeMatch()) {
    const penaltyMs = dailyCollisionCount * DAILY_COLLISION_PENALTY_MS;
    recordedTimeMs = elapsedTime + penaltyMs;
    if (penaltyBox) {
      penaltyBox.classList.remove('hidden');
      penaltyBox.innerHTML =
        `<div>Race Time: <span class="font-mono text-slate-200">${formatTime(elapsedTime)}</span></div>` +
        `<div>Collisions: <span class="font-mono text-rose-400 font-bold">${dailyCollisionCount}</span> × 2.000s = <span class="font-mono text-rose-400 font-bold">+${formatTime(penaltyMs)}</span></div>`;
    }
  } else if (penaltyBox) {
    penaltyBox.classList.add('hidden');
    penaltyBox.innerHTML = '';
  }

  document.getElementById('victory-final-time').innerText = formatTime(recordedTimeMs);
  document.getElementById('modal-victory').classList.remove('hidden');

  if (isMultiplayerMatch() && typeof socket !== 'undefined' && socket.connected) {
    document.getElementById('victory-rank-display').innerText = "Calculating Multiplayer Standings...";
    document.getElementById('victory-coin-payout').innerText = "Syncing with server...";
    socket.emit('player_finished', {
      room_id: window.currentRoomId,
      client_time_ms: recordedTimeMs
    });
  } else {
    handleCampaignVictory(
      currentMaze.id,
      recordedTimeMs,
      Boolean(currentMaze.isDaily),
      Boolean(currentMaze.isNightDrive),
      Number(currentMaze.size || 25)
    );
  }
}

function gameLoop(now = performance.now()) {
  if (!gameActive) return;

  // In Singleplayer, pause freezes physics & timer.
  // In Multiplayer, the race timer and world never stop even if the pause overlay is open!
  if (isPaused && !isMultiplayerMatch()) {
    lastFrameTime = now;
    return;
  }

  const rawDt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const clampedDt = Math.max(0, Math.min(rawDt, MAX_FRAME_DT));
  physicsAccumulator += clampedDt;

  while (physicsAccumulator >= FIXED_PHYSICS_DT && gameActive) {
    updatePhysics();
    physicsAccumulator -= FIXED_PHYSICS_DT;
  }

  renderWorld();

  // Keep full map live-updated if it is currently open while racing
  const fullMapModal = document.getElementById('modal-full-map');
  if (fullMapModal && !fullMapModal.classList.contains('hidden')) {
    renderFullMazeMap();
  }

  if (isMultiplayerMatch() && window.mpRaceStartTs) {
    elapsedTime = Math.max(0, Date.now() - window.mpRaceStartTs);
  } else {
    elapsedTime = now - startTime - pausedTimeTotal;
  }

  document.getElementById('hud-timer').innerText = formatTime(elapsedTime);
  animFrameId = requestAnimationFrame(gameLoop);
}

function formatTime(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '00:00.000';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}
