import socketio
import random
import asyncio
from fastapi.staticfiles import StaticFiles
from backend.main import app as fastapi_app
from backend.database import USERS_DB

fastapi_app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

rooms = {}
GRID_MULTIPLIERS = {25: 1, 50: 4, 75: 9, 100: 16, 150: 36, 200: 64}

async def room_timeout_task(room_id):
    await asyncio.sleep(20)
    if room_id in rooms and rooms[room_id]["status"] == "waiting":
        rooms[room_id]["status"] = "countdown"
        await sio.emit("start_countdown", {"seconds": 5}, room=room_id)

@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
async def join_multiplayer(sid, data):
    username = data.get("username")
    grid_size = data.get("grid_size", 25)

    if username in USERS_DB:
        if USERS_DB[username]["coins"] < 1:
            await sio.emit("error_message", {"detail": "Entry fee requires 1 coin!"}, room=sid)
            return
        USERS_DB[username]["coins"] -= 1

    target_room = None
    for r_id, room in rooms.items():
        if room["grid_size"] == grid_size and room["status"] == "waiting" and len(room["players"]) < 20:
            target_room = r_id
            break

    if not target_room:
        target_room = f"room_{grid_size}_{random.randint(1000, 9999)}"
        rooms[target_room] = {
            "room_id": target_room,
            "grid_size": grid_size,
            "players": {},
            "finishing_order": [],
            "status": "waiting"
        }
        asyncio.create_task(room_timeout_task(target_room))

    rooms[target_room]["players"][sid] = {
        "username": username,
        "color": data.get("color", "#3b82f6"),
        "x": 0, "y": 0, "angle": 0
    }

    sio.enter_room(sid, target_room)
    await sio.emit("room_update", rooms[target_room], room=target_room)

    if len(rooms[target_room]["players"]) == 20 and rooms[target_room]["status"] == "waiting":
        rooms[target_room]["status"] = "countdown"
        await sio.emit("start_countdown", {"seconds": 5}, room=target_room)

@sio.event
async def player_finished(sid, data):
    room_id = data.get("room_id")
    if room_id in rooms and sid in rooms[room_id]["players"]:
        room = rooms[room_id]
        if sid not in room["finishing_order"]:
            room["finishing_order"].append(sid)
            rank = len(room["finishing_order"])
            total_players = len(room["players"])
            multiplier = GRID_MULTIPLIERS.get(room["grid_size"], 1)

            # Payout = (Total Players - Rank + 1) * Multiplier
            payout = (total_players - rank + 1) * multiplier

            username = room["players"][sid]["username"]
            if username in USERS_DB:
                USERS_DB[username]["coins"] += payout

            await sio.emit("player_payout", {
                "rank": rank,
                "payout": payout,
                "total_coins": USERS_DB[username]["coins"] if username in USERS_DB else 0
            }, room=sid)

@sio.event
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
    for r_id, room in list(rooms.items()):
        if sid in room["players"]:
            del room["players"][sid]
            await sio.emit("room_update", room, room=r_id)
            if not room["players"]:
                del rooms[r_id]
            break
