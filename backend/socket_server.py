import socketio
import random

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio)

# room_id -> { grid_size, players: {sid: {username, color, x, y, angle}}, status: 'waiting'/'countdown'/'racing' }
rooms = {}

GRID_MULTIPLIERS = {25: 1, 50: 4, 75: 9, 100: 16, 150: 36, 200: 64}

@sio.event
async def connect(sid, environ):
    print(f"Client connected: {sid}")

@sio.event
async def join_multiplayer(sid, data):
    username = data.get("username")
    grid_size = data.get("grid_size", 25)
    
    target_room = None
    for r_id, room in rooms.items():
        if room["grid_size"] == grid_size and room["status"] == "waiting" and len(room["players"]) < 20:
            target_room = r_id
            break
            
    if not target_room:
        target_room = f"room_{grid_size}_{random.randint(1000, 9999)}"
        rooms[target_room] = {
            "grid_size": grid_size,
            "players": {},
            "status": "waiting"
        }
        
    rooms[target_room]["players"][sid] = {
        "username": username,
        "color": data.get("color", "#3b82f6"),
        "x": 40, "y": 40, "angle": 0
    }
    
    sio.enter_room(sid, target_room)
    await sio.emit("room_update", rooms[target_room], room=target_room)
    
    if len(rooms[target_room]["players"]) == 20 and rooms[target_room]["status"] == "waiting":
        rooms[target_room]["status"] = "countdown"
        await sio.emit("start_countdown", {"seconds": 5}, room=target_room)

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
