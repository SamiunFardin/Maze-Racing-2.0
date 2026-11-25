"""
main.py
-------
FastAPI REST backend handling user authentication, campaign/night-drive progress rewards,
garage stat upgrades/tuning, settings updates, timely daily/weekly leaderboard payouts,
and top-100 leaderboard data retrieval.
"""

from fastapi import FastAPI, HTTPException, Request
import random
import datetime
from backend.database import (
    USERS_DB,
    get_or_create_user,
    credit_user_coins,
    get_campaign_coin_reward,
    get_leaderboard_reward_for_rank,
    LEVEL_LEADERBOARDS,
    DAILY_LEADERBOARD,
    REWARD_STATE,
)

app = FastAPI(title="Turbo Maze Racer API")


def _record_user_payout_notification(username: str, source_label: str, rank: int, coins: int):
    if username not in USERS_DB or coins <= 0:
        return
    credit_user_coins(username, coins, count_as_earning=True)
    REWARD_STATE["recent_payouts"].setdefault(username, []).append({
        "source": source_label,
        "rank": rank,
        "coins": coins,
        "timestamp": datetime.datetime.utcnow().isoformat()
    })


def _distribute_board_rewards(entries: list, source_label: str) -> int:
    """Awards top-100 tier coins for a leaderboard snapshot and returns total coins distributed."""
    total_awarded = 0
    for idx, entry in enumerate(entries[:100], start=1):
        driver = entry.get("driver")
        reward = get_leaderboard_reward_for_rank(idx)
        if driver and driver in USERS_DB and reward > 0:
            _record_user_payout_notification(driver, source_label, idx, reward)
            total_awarded += reward
    return total_awarded


def process_scheduled_leaderboard_rewards(now: datetime.datetime | None = None):
    """
    Ensures daily challenge rewards are paid out every day and level leaderboard
    rewards are paid out every week (7-day / ISO-week cycle), resetting boards cleanly
    after distribution so each new cycle is fresh.
    """
    if now is None:
        now = datetime.datetime.now()

    today_str = str(now.date())
    current_week = now.isocalendar()[:2]

    # 1. Daily Challenge Leaderboard (every day)
    if REWARD_STATE["last_daily_date"] != today_str:
        if DAILY_LEADERBOARD:
            DAILY_LEADERBOARD.sort(key=lambda x: x["timeMs"])
            _distribute_board_rewards(DAILY_LEADERBOARD[:100], f"Daily Challenge ({REWARD_STATE['last_daily_date']})")
            DAILY_LEADERBOARD.clear()
        REWARD_STATE["last_daily_date"] = today_str

    # 2. Level Leaderboards (every week)
    if REWARD_STATE["last_weekly_period"] != current_week:
        prev_year, prev_wk = REWARD_STATE["last_weekly_period"]
        for lb_id, lb in LEVEL_LEADERBOARDS.items():
            if lb:
                lb.sort(key=lambda x: x["timeMs"])
                _distribute_board_rewards(lb[:100], f"Level {lb_id} Weekly (W{prev_wk}/{prev_year})")
                lb.clear()
        REWARD_STATE["last_weekly_period"] = current_week


@app.post("/api/auth")
async def authenticate_user(request: Request):
    """Handles user login or new account registration and delivers any pending reward payouts."""
    process_scheduled_leaderboard_rewards()
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

    pending_rewards = REWARD_STATE["recent_payouts"].pop(username, [])
    return {
        "status": "success",
        "username": username,
        "user_data": user,
        "pending_rewards": pending_rewards
    }


@app.get("/api/rewards/pending/{username}")
async def get_pending_rewards(username: str):
    """Allows an active client to poll and claim any newly distributed daily/weekly rewards."""
    process_scheduled_leaderboard_rewards()
    if username not in USERS_DB:
        return {"pending_rewards": [], "coins": 0, "lifetime_earnings": 0}
    rewards = REWARD_STATE["recent_payouts"].pop(username, [])
    user = USERS_DB[username]
    return {
        "pending_rewards": rewards,
        "coins": user["coins"],
        "lifetime_earnings": user.get("lifetime_earnings", 0)
    }


@app.post("/api/campaign/complete")
async def complete_campaign(request: Request):
    """Records level completion times, awards grid/mode-scaled first-clear coins, and updates top-100 leaderboards."""
    process_scheduled_leaderboard_rewards()
    data = await request.json()
    username = data.get("username")
    level_id = int(data.get("level_id"))
    time_ms = float(data.get("time_ms"))
    is_daily = bool(data.get("is_daily", False))
    is_night_drive = bool(data.get("is_night_drive", False))
    grid_size = int(data.get("grid_size", 25))

    if username not in USERS_DB:
        raise HTTPException(status_code=404, detail="User not found")

    user = USERS_DB[username]
    earned_coins = 0

    if is_daily:
        DAILY_LEADERBOARD.append({"driver": username, "timeMs": time_ms, "date": str(datetime.date.today())})
        DAILY_LEADERBOARD.sort(key=lambda x: x["timeMs"])
        del DAILY_LEADERBOARD[100:]
        rank = next((i + 1 for i, entry in enumerate(DAILY_LEADERBOARD) if entry["driver"] == username), 0)
        world_record = DAILY_LEADERBOARD[0]["timeMs"] if DAILY_LEADERBOARD else time_ms
        return {
            "status": "success",
            "earned_coins": 0,
            "total_coins": user["coins"],
            "lifetime_earnings": user.get("lifetime_earnings", 0),
            "rank": rank,
            "world_record": world_record
        }

    cleared_list = user["completed_night_levels"] if is_night_drive else user["completed_levels"]
    first_time = level_id not in cleared_list
    if first_time:
        cleared_list.append(level_id)
        earned_coins = get_campaign_coin_reward(grid_size, is_night_drive=is_night_drive)
        credit_user_coins(username, earned_coins, count_as_earning=True)

    lb_key = (10000 + level_id) if is_night_drive else level_id
    lb = LEVEL_LEADERBOARDS.setdefault(lb_key, [])
    lb.append({"driver": username, "timeMs": time_ms, "date": str(datetime.date.today())})
    lb.sort(key=lambda x: x["timeMs"])
    LEVEL_LEADERBOARDS[lb_key] = lb[:100]

    rank = next((i + 1 for i, entry in enumerate(LEVEL_LEADERBOARDS[lb_key]) if entry["driver"] == username), 0)
    world_record = LEVEL_LEADERBOARDS[lb_key][0]["timeMs"] if LEVEL_LEADERBOARDS[lb_key] else time_ms

    return {
        "status": "success",
        "first_time": first_time,
        "earned_coins": earned_coins,
        "total_coins": user["coins"],
        "lifetime_earnings": user.get("lifetime_earnings", 0),
        "completed_levels": user["completed_levels"],
        "completed_night_levels": user["completed_night_levels"],
        "rank": rank,
        "world_record": world_record
    }


@app.post("/api/garage/upgrade")
async def upgrade_stat(request: Request):
    """Purchases a tier upgrade for a specific vehicle stat using coins (does not reduce lifetime_earnings)."""
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
            credit_user_coins(username, -10, count_as_earning=False)
            st["unlocked"] = round(min(st["max"], st["unlocked"] + st["step"]), 4)
            st["current"] = st["unlocked"]

    return {
        "status": "success",
        "coins": user["coins"],
        "lifetime_earnings": user.get("lifetime_earnings", 0),
        "stats": user["stats"]
    }


@app.post("/api/garage/tune")
async def tune_stat(request: Request):
    """Adjusts the active operating value of an unlocked vehicle stat."""
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
    """Updates the custom car paint color preference."""
    data = await request.json()
    username = data.get("username")
    color = data.get("color")
    if username in USERS_DB:
        USERS_DB[username]["color"] = color
    return {"status": "success"}


@app.post("/api/settings/controls")
async def update_controls(request: Request):
    """Persists touch control layout coordinates."""
    data = await request.json()
    username = data.get("username")
    pos = data.get("pos")
    if username in USERS_DB:
        USERS_DB[username]["control_pos"] = pos
    return {"status": "success"}


@app.get("/api/leaderboard/richest")
def get_richest_players():
    """Returns top 100 players sorted by lifetime earnings (income), not current coin balance."""
    process_scheduled_leaderboard_rewards()
    sorted_users = sorted(
        USERS_DB.items(),
        key=lambda x: (x[1].get("lifetime_earnings", 0), x[1].get("coins", 0)),
        reverse=True
    )
    return [
        {
            "driver": uname,
            "lifetime_earnings": udata.get("lifetime_earnings", 0),
            "coins": udata.get("coins", 0)
        }
        for uname, udata in sorted_users[:100]
    ]


@app.get("/api/leaderboard/level/{level_id}")
def get_level_lb(level_id: int):
    """Returns top 100 fastest times for a specific campaign, night-drive, or daily challenge level."""
    process_scheduled_leaderboard_rewards()
    if level_id == 9999:
        return DAILY_LEADERBOARD[:100]
    return LEVEL_LEADERBOARDS.get(level_id, [])[:100]
