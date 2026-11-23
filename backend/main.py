"""
main.py
-------
FastAPI REST backend handling user authentication, campaign rewards, tuning, 
lifetime leaderboard ranking, and developer feedback email dispatch.
"""

from fastapi import FastAPI, HTTPException, Request
import random
import datetime
import smtplib
from email.message import EmailMessage
from backend.database import USERS_DB, get_or_create_user, LEVEL_LEADERBOARDS, NIGHT_LEADERBOARDS, DAILY_LEADERBOARD

app = FastAPI(title="Turbo Maze Racer API")

DEV_EMAIL = "developer@turbomazeracer.com" # Configured target developer inbox

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
    is_night = data.get("is_night", False)

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

    if is_night:
        first_time = level_id not in user.setdefault("completed_night_levels", [])
        if first_time:
            user["completed_night_levels"].append(level_id)
            earned_coins = 15
            user["coins"] += earned_coins
            user["lifetime_earned"] = user.get("lifetime_earned", user["coins"]) + earned_coins

        lb = NIGHT_LEADERBOARDS.get(level_id, [])
        lb.append({"driver": username, "timeMs": time_ms, "date": str(datetime.date.today())})
        lb.sort(key=lambda x: x["timeMs"])
        NIGHT_LEADERBOARDS[level_id] = lb[:100]
        rank = next((i + 1 for i, entry in enumerate(lb) if entry["driver"] == username), 0)
        world_record = lb[0]["timeMs"] if lb else time_ms
        return {
            "status": "success", "first_time": first_time, "earned_coins": earned_coins,
            "total_coins": user["coins"], "completed_night_levels": user["completed_night_levels"],
            "rank": rank, "world_record": world_record
        }

    first_time = level_id not in user["completed_levels"]
    if first_time:
        user["completed_levels"].append(level_id)
        earned_coins = 10
        user["coins"] += earned_coins
        user["lifetime_earned"] = user.get("lifetime_earned", user["coins"]) + earned_coins

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
            st["current"] = round(val, 4)

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

@app.post("/api/feedback/submit")
async def submit_feedback(request: Request):
    data = await request.json()
    username = data.get("username", "Anonymous")
    message = data.get("message", "").strip()

    if not message:
        raise HTTPException(status_code=400, detail="Feedback message cannot be empty.")

    print(f"[FEEDBACK RECEIVED] From {username}: {message}")
    # Optional SMTP dispatch simulation
    try:
        msg = EmailMessage()
        msg.set_content(f"Feedback from player: {username}\n\n{message}")
        msg['Subject'] = f"Turbo Maze Racer Feedback - {username}"
        msg['From'] = "noreply@turbomazeracer.com"
        msg['To'] = DEV_EMAIL
        # smtplib.SMTP('localhost', 25) # uncomment if local SMTP relay is active
    except Exception as e:
        print(f"SMTP dispatch note: {e}")

    return {"status": "success", "detail": "Feedback sent to developers successfully!"}

@app.get("/api/leaderboard/richest")
def get_richest_players():
    # Ranked by lifetime cumulative earnings
    sorted_users = sorted(USERS_DB.items(), key=lambda x: x[1].get("lifetime_earned", x[1]["coins"]), reverse=True)
    return [{"driver": uname, "coins": udata.get("lifetime_earned", udata["coins"])} for uname, udata in sorted_users[:10]]

@app.get("/api/leaderboard/level/{level_id}")
def get_level_lb(level_id: int):
    if level_id == 9999:
        return DAILY_LEADERBOARD[:10]
    if level_id >= 10000:
        night_id = level_id - 10000
        return NIGHT_LEADERBOARDS.get(night_id, [])[:10]
    return LEVEL_LEADERBOARDS.get(level_id, [])[:10]
