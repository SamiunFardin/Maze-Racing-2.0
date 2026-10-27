import socketio
import random
import asyncio
from backend.main import app as fastapi_app

# Initialize AsyncServer with CORS allowed
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# room_id -> { grid_size, players: {sid: {username, color, x, y, angle}}, status: 'waiting' }
rooms = {}

async def room_timeout_task(room_id):
    """Auto-starts the race after 20 seconds even if the room is not full (under 20 players)"""
    await asyncio.sleep(20)
    if room_id in rooms and rooms[room_id]["status"] == "waiting":
        rooms[room_id]["status"] = "countdown"
        await sio.emit("start_countdown", {"seconds": 5}, room=room_id)
        print(f"Room {room_id} timed out after 20s. Starting countdown with {len(rooms[room_id]['players'])} players.")

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
        # Start the 20-second room wait timer when a new room is created
        asyncio.create_task(room_timeout_task(target_room))
        
    rooms[target_room]["players"][sid] = {
        "username": username,
        "color": data.get("color", "#3b82f6"),
        "x": 40, "y": 40, "angle": 0
    }
    
    sio.enter_room(sid, target_room)
    await sio.emit("room_update", rooms[target_room], room=target_room)
    
    # If room hits 20 players instantly, trigger 5s countdown
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
