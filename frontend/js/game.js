// Turbo Maze Racer - Full Game Engine with DFS Maze Generation & Wall Recoil
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let car = {
    x: 60,
    y: 60,
    angle: 0,
    speed: 0,
    maxSpeed: 4.5,
    acceleration: 0.2,
    brake: 0.3,
    turning: 0.05,
    friction: 0.98,
    color: '#3b82f6'
};

let multiplayerGhosts = {};
let input = { up: false, down: false, left: false, right: false };

// Keyboard controls
window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.up = true;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') input.down = true;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.up = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') input.down = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
});

// Touch Controls for Mobile UI
function setupTouchControls() {
    const bindTouch = (id, prop) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', (e) => { e.preventDefault(); input[prop] = true; });
        el.addEventListener('touchend', (e) => { e.preventDefault(); input[prop] = false; });
        el.addEventListener('mousedown', () => { input[prop] = true; });
        el.addEventListener('mouseup', () => { input[prop] = false; });
    };
    bindTouch('btn-gas', 'up');
    bindTouch('btn-brake', 'down');
    bindTouch('btn-left', 'left');
    bindTouch('btn-right', 'right');
}

// Procedural DFS Maze Generation Setup
const cols = 15;
const rows = 15;
const tileSize = 50;
let mazeGrid = [];

class Cell {
    constructor(r, c) {
        this.r = r;
        this.c = c;
        this.walls = { top: true, right: true, bottom: true, left: true };
        this.visited = false;
    }
}

function generateMaze() {
    mazeGrid = [];
    for (let r = 0; r < rows; r++) {
        let row = [];
        for (let c = 0; c < cols; c++) {
            row.push(new Cell(r, c));
        }
        mazeGrid.push(row);
    }

    let stack = [];
    let current = mazeGrid[0][0];
    current.visited = true;

    function checkNeighbors(cell) {
        let neighbors = [];
        let r = cell.r, c = cell.c;
        if (r > 0 && !mazeGrid[r - 1][c].visited) neighbors.push(mazeGrid[r - 1][c]);
        if (c < cols - 1 && !mazeGrid[r][c + 1].visited) neighbors.push(mazeGrid[r][c + 1]);
        if (r < rows - 1 && !mazeGrid[r + 1][c].visited) neighbors.push(mazeGrid[r + 1][c]);
        if (c > 0 && !mazeGrid[r][c - 1].visited) neighbors.push(mazeGrid[r][c - 1]);
        return neighbors.length > 0 ? neighbors[Math.floor(Math.random() * neighbors.length)] : undefined;
    }

    while (true) {
        let next = checkNeighbors(current);
        if (next) {
            next.visited = true;
            stack.push(current);
            // Remove walls between current and next
            let x = current.c - next.c;
            if (x === 1) { current.walls.left = false; next.walls.right = false; }
            else if (x === -1) { current.walls.right = false; next.walls.left = false; }
            let y = current.r - next.r;
            if (y === 1) { current.walls.top = false; next.walls.bottom = false; }
            else if (y === -1) { current.walls.bottom = false; next.walls.top = false; }
            current = next;
        } else if (stack.length > 0) {
            current = stack.pop();
        } else {
            break;
        }
    }
}

generateMaze();

function updatePhysics() {
    if (input.up) car.speed += car.acceleration;
    else if (input.down) car.speed -= car.brake;
    else car.speed *= car.friction;

    if (input.left) car.angle -= car.turning * (car.speed / car.maxSpeed);
    if (input.right) car.angle += car.turning * (car.speed / car.maxSpeed);

    car.speed = Math.max(-2, Math.min(car.speed, car.maxSpeed));

    car.x += Math.cos(car.angle) * car.speed;
    car.y += Math.sin(car.angle) * car.speed;

    // Maze boundaries & Wall Recoil Bounce
    const mapWidth = cols * tileSize;
    const mapHeight = rows * tileSize;
    
    if (car.x < 15 || car.x > mapWidth - 15 || car.y < 15 || car.y > mapHeight - 15) {
        car.speed = -car.speed * 0.4; // Speed-based recoil bounce off walls
        car.x = Math.max(15, Math.min(car.x, mapWidth - 15));
        car.y = Math.max(15, Math.min(car.y, mapHeight - 15));
    }

    // Sync position with multiplayer backend
    if (typeof socket !== 'undefined' && socket.connected && window.currentRoomId) {
        socket.emit('player_move', {
            room_id: window.currentRoomId,
            x: car.x,
            y: car.y,
            angle: car.angle
        });
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    
    // Centered rotating viewport camera following the player car
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-car.angle);
    ctx.translate(-car.x, -car.y);

    // Draw Procedural DFS Maze Walls
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let cell = mazeGrid[r][c];
            let x = c * tileSize;
            let y = r * tileSize;

            if (cell.walls.top) {
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + tileSize, y); ctx.stroke();
            }
            if (cell.walls.right) {
                ctx.beginPath(); ctx.moveTo(x + tileSize, y); ctx.lineTo(x + tileSize, y + tileSize); ctx.stroke();
            }
            if (cell.walls.bottom) {
                ctx.beginPath(); ctx.moveTo(x + tileSize, y + tileSize); ctx.lineTo(x, y + tileSize); ctx.stroke();
            }
            if (cell.walls.left) {
                ctx.beginPath(); ctx.moveTo(x, y + tileSize); ctx.lineTo(x, y); ctx.stroke();
            }
        }
    }

    // Render Multiplayer Ghost Cars
    for (let sid in multiplayerGhosts) {
        let ghost = multiplayerGhosts[sid];
        ctx.save();
        ctx.translate(ghost.x, ghost.y);
        ctx.rotate(ghost.angle);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = ghost.color || '#94a3b8';
        ctx.fillRect(-15, -10, 30, 20);
        ctx.restore();
    }

    // Render Main Player Car
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = car.color;
    ctx.fillRect(-15, -10, 30, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, -3, 6, 6); // Car windshield indicator
    ctx.restore();

    ctx.restore();

    // HUD Updates
    const speedEl = document.getElementById('hud-speed');
    if (speedEl) speedEl.innerText = Math.abs(car.speed).toFixed(1);
}

function gameLoop() {
    updatePhysics();
    render();
    requestAnimationFrame(gameLoop);
}

window.addEventListener('DOMContentLoaded', setupTouchControls);
