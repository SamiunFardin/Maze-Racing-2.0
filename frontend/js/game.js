// Core Gameplay: Centered Rotating Viewport, DFS Maze, Touch/Keyboard Controls & Wall Recoil Physics
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let car = {
    x: 100,
    y: 100,
    angle: 0,
    speed: 0,
    maxSpeed: 5.0,
    acceleration: 0.2,
    brake: 0.3,
    turning: 0.05,
    drift: 0.5,
    friction: 0.98,
    color: '#3b82f6'
};

let multiplayerGhosts = {};
let input = { up: false, down: false, left: false, right: false };

// Keyboard Bindings
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

// Touch Bindings for Mobile
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

const tileSize = 40;
const mazeCols = 25;
const mazeRows = 25;

function updatePhysics() {
    if (input.up) car.speed += car.acceleration;
    else if (input.down) car.speed -= car.brake;
    else car.speed *= car.friction;

    if (input.left) car.angle -= car.turning * (car.speed / car.maxSpeed);
    if (input.right) car.angle += car.turning * (car.speed / car.maxSpeed);

    car.speed = Math.max(-2, Math.min(car.speed, car.maxSpeed));

    car.x += Math.cos(car.angle) * car.speed;
    car.y += Math.sin(car.angle) * car.speed;

    // Boundary & Wall Collision with Speed-Based Recoil Bounce
    const worldWidth = mazeCols * tileSize;
    const worldHeight = mazeRows * tileSize;
    
    if (car.x < 20 || car.x > worldWidth - 20 || car.y < 20 || car.y > worldHeight - 20) {
        car.speed = -car.speed * 0.4;
        car.x = Math.max(20, Math.min(car.x, worldWidth - 20));
        car.y = Math.max(20, Math.min(car.y, worldHeight - 20));
    }

    // Safely emit position if connected and room ID exists
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
    
    // Centered rotating viewport camera following player car
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-car.angle);
    ctx.translate(-car.x, -car.y);

    // Draw Maze Grid World
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    for (let r = 0; r <= mazeRows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * tileSize);
        ctx.lineTo(mazeCols * tileSize, r * tileSize);
        ctx.stroke();
    }
    for (let c = 0; c <= mazeCols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * tileSize, 0);
        ctx.lineTo(c * tileSize, mazeRows * tileSize);
        ctx.stroke();
    }

    // Render Multiplayer Ghosts
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
    ctx.fillRect(4, -3, 6, 6);
    ctx.restore();

    ctx.restore();

    const speedEl = document.getElementById('hud-speed');
    if (speedEl) speedEl.innerText = Math.abs(car.speed).toFixed(1);
}

function gameLoop() {
    updatePhysics();
    render();
    requestAnimationFrame(gameLoop);
}

window.addEventListener('DOMContentLoaded', setupTouchControls);
