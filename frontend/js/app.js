let currentUser = null;
const socket = io('http://localhost:8000');

function handleLogin() {
    const username = document.getElementById('username-input').value.trim();
    const password = document.getElementById('password-input').value;
    const color = document.getElementById('car-color-picker').value;

    if (!username || !password) {
        alert("Please enter both username and password.");
        return;
    }

    fetch('http://localhost:8000/api/login', {
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
            gameLoop();
        } else {
            alert(response.body.detail);
        }
    })
    .catch(err => console.error("Login connection error:", err));
}

socket.on('ghost_update', (data) => {
    for (let sid in data) {
        multiplayerGhosts[sid] = data[sid];
    }
});
