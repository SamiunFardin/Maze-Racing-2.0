from fastapi import FastAPI, HTTPException, Request
import random
import datetime
from backend.database import USERS_DB, get_or_create_user, LEVEL_LEADERBOARDS, DAILY_LEADERBOARD

app = FastAPI(title="Turbo Maze Racer API")

@app.post("/api/auth")
async def authenticate_user(request: Request):
    data = await request.json()
    is_signup = data.get("is_signup", False)
    username = data.get("username", "").strip()
    password = data.get("password", "")
    color = data.get("color", "#3b82f6")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required.")

    if is_signup:
        if username in USERS_DB:
            suggested = f"{username}_{random.randint(100, 999)}"
            raise HTTPException(status_code=400, detail=f"Username already taken. Try: {suggested}")
        user = get_or_create_user(username, password, color)
    else:
        if username not in USERS_DB:
            raise HTTPException(status_code=400, detail="Account not found. Please Sign Up first.")
        user = USERS_DB[username]
        if user["password"] != password:
            raise HTTPException(status_code=400, detail="Incorrect password.")
        user["color"] = color

    return {"status": "success", "username": username, "user_data": user}

@app.post("/api/campaign/complete")
async def complete_campaign(request: Request):
    data = await request.json()
    username = data.get("username")
    level_id = int(data.get("level_id"))
    time_ms = float(data.get("time_ms"))
    is_daily = data.get("is_daily", False)

    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")

    user = USERS_DB[username]
    earned_coins = 0

    if is_daily:
        DAILY_LEADERBOARD.append({"driver": username, "timeMs": time_ms, "date": str(datetime.date.today())})
        DAILY_LEADERBOARD.sort(key=lambda x: x["timeMs"])
        rank = next((i + 1 for i, entry in enumerate(DAILY_LEADERBOARD) if entry["driver"] == username), 0)
        world_record = DAILY_LEADERBOARD[0]["timeMs"] if DAILY_LEADERBOARD else time_ms
        return {"status": "success", "earned_coins": 0, "total_coins": user["coins"], "rank": rank, "world_record": world_record}

    first_time = level_id not in user["completed_levels"]
    if first_time:
        user["completed_levels"].append(level_id)
        earned_coins = 10
        user["coins"] += earned_coins

    lb = LEVEL_LEADERBOARDS.get(level_id, [])
    lb.append({"driver": username, "timeMs": time_ms, "date": str(datetime.date.today())})
    lb.sort(key=lambda x: x["timeMs"])
    LEVEL_LEADERBOARDS[level_id] = lb[:100]

    rank = next((i + 1 for i, entry in enumerate(lb) if entry["driver"] == username), 0)
    world_record = lb[0]["timeMs"] if lb else time_ms

    return {
        "status": "success",
        "first_time": first_time,
        "earned_coins": earned_coins,
        "total_coins": user["coins"],
        "completed_levels": user["completed_levels"],
        "rank": rank,
        "world_record": world_record
    }

@app.post("/api/garage/upgrade")
async def upgrade_stat(request: Request):
    data = await request.json()
    username = data.get("username")
    stat_name = data.get("stat_name")

    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")

    user = USERS_DB[username]
    if user["coins"] < 10:
        raise HTTPException(status_code=400, detail="Not enough coins! Upgrades cost 10 coins.")

    if stat_name in user["stats"]:
        st = user["stats"][stat_name]
        if st["unlocked"] < st["max"]:
            user["coins"] -= 10
            st["unlocked"] = round(min(st["max"], st["unlocked"] + st["step"]), 4)
            st["current"] = st["unlocked"]

    return {"status": "success", "coins": user["coins"], "stats": user["stats"]}

@app.post("/api/garage/tune")
async def tune_stat(request: Request):
    data = await request.json()
    username = data.get("username")
    stat_name = data.get("stat_name")
    val = float(data.get("value"))

    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")

    user = USERS_DB[username]
    if stat_name in user["stats"]:
        st = user["stats"][stat_name]
        if val <= st["unlocked"]:
            st["current"] = val

    return {"status": "success", "stats": user["stats"]}

@app.post("/api/settings/color")
async def update_color(request: Request):
    data = await request.json()
    username = data.get("username")
    color = data.get("color")
    if username in USERS_DB:
        USERS_DB[username]["color"] = color
    return {"status": "success"}

@app.post("/api/settings/controls")
async def update_controls(request: Request):
    data = await request.json()
    username = data.get("username")
    pos = data.get("pos")
    if username in USERS_DB:
        USERS_DB[username]["control_pos"] = pos
    return {"status": "success"}

@app.get("/api/leaderboard/level/{level_id}")
def get_level_lb(level_id: int):
    if level_id == 9999:
        return DAILY_LEADERBOARD[:10]
    return LEVEL_LEADERBOARDS.get(level_id, [])[:10]
