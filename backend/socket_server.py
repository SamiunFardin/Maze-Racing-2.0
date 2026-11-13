"""
socket_server.py
----------------
ASGI WebSocket server configuration using python-socketio to manage 
real-time multiplayer lobby matchmaking, countdowns, race synchronization, and payouts.
"""

import socketio
import random
import asyncio
from fastapi.staticfiles import StaticFiles
from backend.main import app as fastapi_app
from backend.database import USERS_DB

# Mount static frontend directory
fastapi_app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

# Initialize Socket.io Async Server with robust ping intervals
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*', ping_timeout=60, ping_interval=25)
socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

rooms = {}
GRID_MULTIPLIERS = {25: 1, 50: 4, 75: 9, 100: 16, 150: 36, 200: 64}

async def room_countdown_and_start(room_id: str):
    """Manages the lobby countdown and guarantees race start even for single players."""
    print(f"[SERVER] Starting 10s countdown coroutine for room: {room_id}")
    for remaining in range(10, 0, -1):
        if room_id not in rooms:
            print(f"[SERVER] Room {room_id} deleted during countdown.")
            return
        if rooms[room_id]["status"] != "waiting":
            print(f"[SERVER] Room {room_id} status changed from waiting.")
            return
        
        print(f"[SERVER] Broadcasting tick {remaining} for room {room_id}")
        await sio.emit("waiting_countdown_tick", {"remaining": remaining}, room=room_id)
        await asyncio.sleep(1.0)

    # Force race start when countdown hits 0
    if room_id in rooms and rooms[room_id]["status"] == "waiting":
        room = rooms[room_id]
        room["status"] = "racing"
        print(f"[SERVER] Countdown completed! Launching race for room: {room_id} with {len(room['players'])} players.")
        
        for sid in room["players"]:
            username = room["players"][sid]["username"]
            if username in USERS_DB:
                if USERS_DB[username]["coins"] >= 1:
                    USERS_DB[username]["coins"] -= 1
                    room["players"][sid]["deducted"] = True
                else:
                    room["players"][sid]["deducted"] = False
                    
        await sio.emit("start_multiplayer_race", {"room_id": room_id, "grid_size": room["grid_size"]}, room=room_id)

@sio.event
async def connect(sid, environ):
    print(f"[SERVER] Client connected successfully with SID: {sid}")

@sio.on('join_multiplayer')
async def join_multiplayer(sid, data):
    """Handles player matchmaking into grid-specific multiplayer rooms."""
    username = data.get("username")
    grid_size = int(data.get("grid_size", 25))
    print(f"[SERVER] Received join_multiplayer from {username} for grid {grid_size} (SID: {sid})")

    if username in USERS_DB:
        if USERS_DB[username]["coins"] < 1:
            await sio.emit("error_message", {"detail": "Multiplayer entry requires 1 coin!"}, room=sid)
            return

    target_room = None
    for r_id, room in rooms.items():
        if int(room["grid_size"]) == grid_size and room["status"] == "waiting" and len(room["players"]) < 20:
            target_room = r_id
            break

    is_new_room = False
    if not target_room:
        is_new_room = True
        target_room = f"room_{grid_size}_{random.randint(1000, 9999)}"
        rooms[target_room] = {
            "room_id": target_room,
            "grid_size": grid_size,
            "players": {},
            "finishing_order": [],
            "status": "waiting"
        }
        print(f"[SERVER] Created brand new room: {target_room}")

    rooms[target_room]["players"][sid] = {
        "username": username,
        "color": data.get("color", "#3b82f6"),
        "x": 0, "y": 0, "angle": 0,
        "deducted": False
    }

    sio.enter_room(sid, target_room)
    print(f"[SERVER] SID {sid} entered socket room {target_room}. Total players in room: {len(rooms[target_room]['players'])}")

    # Send immediate update to client so UI populates player list
    player_list = [p["username"] for p in rooms[target_room]["players"].values()]
    await sio.emit("waiting_room_update", {
        "room_id": target_room,
        "players": player_list,
        "count": len(player_list)
    }, room=target_room)

    # Spawn countdown task if new room
    if is_new_room:
        asyncio.create_task(room_countdown_and_start(target_room))

    # Start immediately if room reaches max capacity (20 players)
    if len(rooms[target_room]["players"]) >= 20 and rooms[target_room]["status"] == "waiting":
        rooms[target_room]["status"] = "racing"
        for s in rooms[target_room]["players"]:
            uname = rooms[target_room]["players"][s]["username"]
            if uname in USERS_DB and USERS_DB[uname]["coins"] >= 1:
                USERS_DB[uname]["coins"] -= 1
        await sio.emit("start_multiplayer_race", {"room_id": target_room, "grid_size": rooms[target_room]["grid_size"]}, room=target_room)

@sio.on('player_finished')
async def player_finished(sid, data):
    room_id = data.get("room_id")
    if room_id in rooms and sid in rooms[room_id]["players"]:
        room = rooms[room_id]
        if sid not in room["finishing_order"]:
            room["finishing_order"].append(sid)
            rank = len(room["finishing_order"])
            total = max(1, len(room["players"]))
            multiplier = GRID_MULTIPLIERS.get(room["grid_size"], 1)
            payout = (total - rank + 1) * multiplier

            username = room["players"][sid]["username"]
            if username in USERS_DB:
                USERS_DB[username]["coins"] += payout

            await sio.emit("player_payout", {
                "rank": rank,
                "payout": payout,
                "total_coins": USERS_DB[username]["coins"] if username in USERS_DB else 0
            }, room=sid)

@sio.on('player_move')
async def player_move(sid, data):
    room_id = data.get("room_id")
    if room_id in rooms and sid in rooms[room_id]["players"]:
        p = rooms[room_id]["players"][sid]
        p["x"] = data["x"]
        p["y"] = data["y"]
        p["angle"] = data["angle"]
        await sio.emit("ghost_update", {sid: {"x": p["x"], "y": p["y"], "angle": p["angle"], "color": p["color"]}}, room=room_id, skip_sid=sid)

@sio.event
async def disconnect(sid):
    print(f"[SERVER] Client disconnected: {sid}")
    for r_id, room in list(rooms.items()):
        if sid in room["players"]:
            del room["players"][sid]
            player_list = [p["username"] for p in room["players"].values()]
            await sio.emit("waiting_room_update", {"room_id": r_id, "players": player_list, "count": len(player_list)}, room=r_id)
            if not room["players"]:
                del rooms[r_id]
            break
