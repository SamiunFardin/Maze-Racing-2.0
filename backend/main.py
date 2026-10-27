from fastapi import FastAPI, HTTPException, Request
import random
import datetime
from backend.database import USERS_DB, get_or_create_user, LEVEL_LEADERBOARDS, DAILY_LEADERBOARDS, get_payout_for_rank

app = FastAPI(title="Turbo Maze Racer API")

@app.post("/api/login")
async def login(request: Request):
    data = await request.json()
    username = data.get("username", "").strip()
    password = data.get("password", "")
    color = data.get("color", "#3b82f6")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required.")

    if username in USERS_DB:
        if USERS_DB[username]["password"] != password:
            suggested = f"{username}_{random.randint(100, 999)}"
            raise HTTPException(status_code=400, detail=f"Username taken with different password. Try: {suggested}")
        user = USERS_DB[username]
    else:
        user = get_or_create_user(username, password, color)

    return {"status": "success", "username": username, "user_data": user}

@app.post("/api/campaign/complete")
async def complete_campaign_level(request: Request):
    data = await request.json()
    username = data.get("username")
    level_id = int(data.get("level_id"))
    time_ms = float(data.get("time_ms"))

    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")

    user = USERS_DB[username]
    first_time = level_id not in user["completed_levels"]
    earned_coins = 0

    if first_time:
        user["completed_levels"].append(level_id)
        earned_coins = 10
        user["coins"] += earned_coins

    lb = LEVEL_LEADERBOARDS.get(level_id, [])
    lb.append({"driver": username, "timeMs": time_ms, "date": str(datetime.date.today())})
    lb.sort(key=lambda x: x["timeMs"])
    LEVEL_LEADERBOARDS[level_id] = lb[:100]

    return {
        "status": "success",
        "first_time": first_time,
        "earned_coins": earned_coins,
        "total_coins": user["coins"],
        "completed_levels": user["completed_levels"]
    }

@app.post("/api/daily/submit")
async def submit_daily_challenge(request: Request):
    data = await request.json()
    username = data.get("username")
    time_ms = float(data.get("time_ms"))
    today_str = str(datetime.date.today())

    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")

    user = USERS_DB[username]
    prev_record = user["daily_records"].get(today_str)
    is_new_record = prev_record is None or time_ms < prev_record

    if is_new_record:
        user["daily_records"][today_str] = time_ms

    if today_str not in DAILY_LEADERBOARDS:
        DAILY_LEADERBOARDS[today_str] = []

    d_lb = DAILY_LEADERBOARDS[today_str]
    d_lb = [entry for entry in d_lb if entry["driver"] != username]
    d_lb.append({"driver": username, "timeMs": min(time_ms, prev_record if prev_record else time_ms)})
    d_lb.sort(key=lambda x: x["timeMs"])
    DAILY_LEADERBOARDS[today_str] = d_lb[:100]

    user_rank = next((i + 1 for i, e in enumerate(DAILY_LEADERBOARDS[today_str]) if e["driver"] == username), None)

    return {
        "status": "success",
        "is_new_record": is_new_record,
        "best_time": user["daily_records"][today_str],
        "rank": user_rank,
        "leaderboard": DAILY_LEADERBOARDS[today_str][:10]
    }

@app.post("/api/garage/upgrade")
async def upgrade_stat_range(request: Request):
    data = await request.json()
    username = data.get("username")
    stat_name = data.get("stat_name")

    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")

    user = USERS_DB[username]
    if user["coins"] < 10:
        raise HTTPException(status_code=400, detail="Insufficient coins. Upgrades cost 10 coins.")

    if stat_name in user["stats"]:
        st = user["stats"][stat_name]
        user["coins"] -= 10
        st["unlocked"] = round(st["unlocked"] + st["step"], 4)
        st["current"] = st["unlocked"]

    return {"status": "success", "coins": user["coins"], "stats": user["stats"]}

@app.post("/api/garage/tune")
async def tune_current_stat(request: Request):
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

@app.post("/api/settings/audio")
async def update_audio_settings(request: Request):
    data = await request.json()
    username = data.get("username")
    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")
    
    user = USERS_DB[username]
    user["bgm_enabled"] = data.get("bgm_enabled", True)
    user["sfx_enabled"] = data.get("sfx_enabled", True)
    user["bgm_volume"] = data.get("bgm_volume", 0.8)
    user["sfx_volume"] = data.get("sfx_volume", 1.0)
    return {"status": "success"}

@app.get("/api/leaderboards/wealth")
def get_wealth_leaderboard():
    sorted_users = sorted(USERS_DB.items(), key=lambda x: x[1]["coins"], reverse=True)[:100]
    return [{"rank": i + 1, "username": u[0], "coins": u[1]["coins"]} for i, u in enumerate(sorted_users)]
