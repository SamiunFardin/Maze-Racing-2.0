"""
socket_server.py
----------------
ASGI WebSocket server configuration using python-socketio to manage 
real-time multiplayer lobby matchmaking, countdowns, race synchronization, forfeits, and payouts.
"""

import socketio
import random
import asyncio
import time
from fastapi.staticfiles import StaticFiles
from backend.main import app as fastapi_app
from backend.database import USERS_DB

# Initialize Socket.io Async Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*', ping_timeout=60, ping_interval=25)
socket_app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# Mount static frontend directory on fastapi_app
fastapi_app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

rooms = {}
GRID_MULTIPLIERS = {25: 1, 50: 4, 75: 9, 100: 16, 150: 36, 200: 64}

async def start_race_for_room(room_id: str):
    """Transitions room to racing state, deducts entry fee, sets backend start timestamp, and launches all clients."""
    if room_id not in rooms:
        return
    room = rooms[room_id]
    if room["status"] != "waiting":
        return

    room["status"] = "racing"
    room["countdown_active"] = False
    room_seed = int(room["seed"])
    room_grid_size = int(room["grid_size"])
    # Account for the 3-second pre-race "3-2-1-GO" overlay on clients
    room["race_start_ts"] = time.time() + 3.0
    print(f"[SERVER] Launching race for room {room_id} with {len(room['players'])} players (Seed: {room_seed}, Grid: {room_grid_size}).")

    for sid, pdata in list(room["players"].items()):
        username = pdata["username"]
        if username in USERS_DB and USERS_DB[username]["coins"] >= 1:
            USERS_DB[username]["coins"] -= 1

    await sio.emit(
        "start_multiplayer_race",
        {
            "room_id": room_id,
            "grid_size": room_grid_size,
            "seed": room_seed,
            "race_start_ts": room["race_start_ts"]
        },
        room=room_id
    )

async def room_countdown_and_start(room_id: str):
    """10-second lobby countdown timer that broadcasts ticks and starts the race at 0."""
    if room_id not in rooms:
        return
    rooms[room_id]["countdown_active"] = True
    print(f"[SERVER] Starting 10s countdown for room: {room_id}")

    try:
        for remaining in range(10, 0, -1):
            if room_id not in rooms:
                return
            room = rooms[room_id]
            if room["status"] != "waiting" or not room["players"]:
                return
            room["remaining"] = remaining
            await sio.emit("waiting_countdown_tick", {"remaining": remaining}, room=room_id)
            await asyncio.sleep(1.0)

        await start_race_for_room(room_id)
    except Exception as e:
        print(f"[SERVER] Error in countdown for {room_id}: {e}")
        await start_race_for_room(room_id)

def get_standings_payload(room: dict) -> list:
    """Computes final standings placing active finishers first and forfeited/disconnected players last."""
    standings = []
    # 1. Legitimate finishers in order
    for idx, entry in enumerate(room["finishing_order"], start=1):
        standings.append({
            "rank": idx,
            "username": entry["username"],
            "time_ms": entry["time_ms"],
            "status": "Finished",
            "payout": entry["payout"]
        })

    # 2. Active players still racing (not yet finished and not forfeited)
    finished_sids = {e["sid"] for e in room["finishing_order"]}
    for sid, pdata in room["players"].items():
        if sid not in finished_sids and sid not in room["forfeited_sids"]:
            standings.append({
                "rank": "-",
                "username": pdata["username"],
                "time_ms": None,
                "status": "Racing...",
                "payout": 0
            })

    # 3. Forfeited players always placed at the very bottom (last places)
    total_entrants = max(1, room["initial_player_count"])
    for idx, f_entry in enumerate(room["forfeited_players"]):
        last_rank = total_entrants - len(room["forfeited_players"]) + idx + 1
        standings.append({
            "rank": last_rank,
            "username": f_entry["username"],
            "time_ms": None,
            "status": "DNF (Forfeit)",
            "payout": 0
        })

    return standings

async def handle_forfeit_or_disconnect(sid: str):
    """Handles a player leaving during lobby wait OR forfeiting mid-race."""
    for r_id, room in list(rooms.items()):
        if sid in room["players"]:
            pdata = room["players"][sid]
            username = pdata["username"]
            await sio.leave_room(sid, r_id)

            if room["status"] == "waiting":
                # Lobby exit before race starts
                del room["players"][sid]
                if not room["players"]:
                    del rooms[r_id]
                else:
                    player_list = [p["username"] for p in room["players"].values()]
                    await sio.emit(
                        "waiting_room_update",
                        {"room_id": r_id, "players": player_list, "count": len(player_list)},
                        room=r_id
                    )
            else:
                # Active race forfeit: count as last place, 0 reward, notify remaining racers
                if sid not in room["forfeited_sids"] and not any(f["sid"] == sid for f in room["finishing_order"]):
                    room["forfeited_sids"].add(sid)
                    room["forfeited_players"].append({"sid": sid, "username": username})
                    print(f"[SERVER] Player {username} forfeited room {r_id}. Placed at bottom of standings.")

                # Remove ghost from active track
                await sio.emit("ghost_removed", {"sid": sid}, room=r_id)
                await sio.emit("race_standings_update", {"standings": get_standings_payload(room)}, room=r_id)

                # Clean up room if everyone has finished or forfeited
                active_remaining = [
                    s for s in room["players"]
                    if s not in room["forfeited_sids"] and not any(f["sid"] == s for f in room["finishing_order"])
                ]
                if not active_remaining:
                    del rooms[r_id]
            break

@sio.event
async def connect(sid, environ):
    print(f"[SERVER] Client connected: {sid}")

@sio.on('join_multiplayer')
async def join_multiplayer(sid, data):
    """Assigns player to a waiting room matching grid_size and awaits socket room entry."""
    username = data.get("username") or f"Guest_{sid[:4]}"
    grid_size = int(data.get("grid_size", 25))
    print(f"[SERVER] join_multiplayer from {username} | grid={grid_size} | sid={sid}")

    if username in USERS_DB and USERS_DB[username]["coins"] < 1:
        await sio.emit("error_message", {"detail": "Multiplayer entry requires 1 coin!"}, room=sid)
        return

    await handle_forfeit_or_disconnect(sid)

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
            "seed": random.randint(100000, 999999),
            "players": {},
            "initial_player_count": 0,
            "finishing_order": [],
            "forfeited_sids": set(),
            "forfeited_players": [],
            "status": "waiting",
            "countdown_active": False,
            "remaining": 10,
            "race_start_ts": None
        }
        print(f"[SERVER] Created new room: {target_room} with shared seed: {rooms[target_room]['seed']}")

    rooms[target_room]["players"][sid] = {
        "username": username,
        "color": data.get("color", "#3b82f6"),
        "x": 0, "y": 0, "angle": 0
    }
    rooms[target_room]["initial_player_count"] = len(rooms[target_room]["players"])

    await sio.enter_room(sid, target_room)
    print(f"[SERVER] SID {sid} joined room {target_room}. Players: {len(rooms[target_room]['players'])}")

    player_list = [p["username"] for p in rooms[target_room]["players"].values()]
    await sio.emit(
        "waiting_room_update",
        {
            "room_id": target_room,
            "players": player_list,
            "count": len(player_list)
        },
        room=target_room
    )

    await sio.emit("waiting_countdown_tick", {"remaining": rooms[target_room]["remaining"]}, room=sid)

    if is_new_room and not rooms[target_room]["countdown_active"]:
        asyncio.create_task(room_countdown_and_start(target_room))

    if len(rooms[target_room]["players"]) >= 20 and rooms[target_room]["status"] == "waiting":
        await start_race_for_room(target_room)

@sio.on('leave_multiplayer')
async def leave_multiplayer(sid, data=None):
    print(f"[SERVER] leave_multiplayer / forfeit from {sid}")
    await handle_forfeit_or_disconnect(sid)

@sio.on('player_finished')
async def player_finished(sid, data):
    room_id = data.get("room_id")
    if room_id in rooms and sid in rooms[room_id]["players"]:
        room = rooms[room_id]
        if sid in room["forfeited_sids"]:
            return
        if not any(f["sid"] == sid for f in room["finishing_order"]):
            # Use authoritative backend elapsed time
            elapsed_ms = max(0.0, (time.time() - room["race_start_ts"]) * 1000.0) if room["race_start_ts"] else float(data.get("client_time_ms", 0))
            rank = len(room["finishing_order"]) + 1
            total = max(1, room["initial_player_count"])
            multiplier = GRID_MULTIPLIERS.get(room["grid_size"], 1)
            payout = max(1, (total - rank + 1)) * multiplier

            username = room["players"][sid]["username"]
            if username in USERS_DB:
                USERS_DB[username]["coins"] += payout
                if "total_earned_coins" not in USERS_DB[username]:
                    USERS_DB[username]["total_earned_coins"] = USERS_DB[username].get("coins", 100)
                USERS_DB[username]["total_earned_coins"] += payout

            room["finishing_order"].append({
                "sid": sid,
                "username": username,
                "time_ms": elapsed_ms,
                "payout": payout
            })

            standings = get_standings_payload(room)

            await sio.emit("player_payout", {
                "rank": rank,
                "total_players": total,
                "payout": payout,
                "time_ms": elapsed_ms,
                "total_coins": USERS_DB[username]["coins"] if username in USERS_DB else 0,
                "standings": standings
            }, room=sid)

            await sio.emit("race_standings_update", {"standings": standings}, room=room_id)

            active_remaining = [
                s for s in room["players"]
                if s not in room["forfeited_sids"] and not any(f["sid"] == s for f in room["finishing_order"])
            ]
            if not active_remaining:
                del rooms[room_id]

@sio.on('player_move')
async def player_move(sid, data):
    room_id = data.get("room_id")
    if room_id in rooms and sid in rooms[room_id]["players"]:
        room = rooms[room_id]
        if sid in room["forfeited_sids"]:
            return
        p = room["players"][sid]
        p["x"] = data["x"]
        p["y"] = data["y"]
        p["angle"] = data["angle"]
        await sio.emit(
            "ghost_update",
            {
                sid: {
                    "x": p["x"],
                    "y": p["y"],
                    "angle": p["angle"],
                    "color": p["color"],
                    "username": p["username"]
                }
            },
            room=room_id,
            skip_sid=sid
        )

@sio.event
async def disconnect(sid):
    print(f"[SERVER] Client disconnected: {sid}")
    await handle_forfeit_or_disconnect(sid)
