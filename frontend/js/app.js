let currentUser = null;

// Dynamically connect to backend (works on localhost AND Render production)
const backendUrl = window.location.hostname === 'localhost' ? 'http://localhost:8000' : window.location.origin;
const socket = io(backendUrl);

function handleLogin() {
    const username = document.getElementById('username-input').value.trim();
    const password = document.getElementById('password-input').value;
    const color = document.getElementById('car-color-picker').value;

    if (!username || !password) {
        alert("Please enter both username and password.");
        return;
    }

    fetch(`${backendUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, color })
    })
    .then(res => res.json().then(data => ({status: res.status, body: data})))
    .then(response => {
        if (response.status === 200) {
            currentUser = response.body.username;
            car.color = response.body.user_data.color;
            document.getElementById('menu-screen').classList.add('hidden');
            document.getElementById('game-container').classList.remove('hidden');
            document.getElementById('hud-coins').innerText = response.body.user_data.coins;
            
            // Example: Join a default 25x25 multiplayer queue for testing
            socket.emit('join_multiplayer', { username: currentUser, grid_size: 25, color: car.color });
            
            gameLoop();
        } else {
            alert(response.body.detail);
        }
    })
    .catch(err => console.error("Login connection error:", err));
}

// Capture and save the room ID when room updates arrive from server
socket.on('room_update', (roomData) => {
    // Save current room reference so game.js can send player_move packets
    window.currentRoomId = roomData.room_id || Object.keys(rooms_cache || {})[0];
});

socket.on('start_countdown', (data) => {
    console.log(`Race starting in ${data.seconds} seconds!`);
});

socket.on('ghost_update', (data) => {
    for (let sid in data) {
        multiplayerGhosts[sid] = data[sid];
    }
});
