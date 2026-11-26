"""
database.py
-----------
Database layer storing user profiles, vehicle stats, level progression,
lifetime earnings, and global/level/daily leaderboards with JSON persistence
so data survives server restarts while remaining fast in memory.
"""

import datetime
import json
import os
import tempfile
import threading

_STORE_LOCK = threading.Lock()
_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
_PERSISTENCE_FILE = os.path.join(_DATA_DIR, "data_store.json")

# Central in-memory storage dictionaries and lists
USERS_DB = {}
# Standard campaign levels: 1..1300; Night drive levels: 10001..11300
LEVEL_LEADERBOARDS = {i: [] for i in range(1, 1301)}
for _lvl in range(1, 1301):
    LEVEL_LEADERBOARDS[10000 + _lvl] = []

DAILY_LEADERBOARD = []

# Tracks last distributed reward periods to guarantee timely payouts
REWARD_STATE = {
    "last_daily_date": str(datetime.date.today()),
    "last_weekly_period": datetime.date.today().isocalendar()[:2],  # (year, week)
    "recent_payouts": {}  # username -> list of payout summary dicts
}

CAMPAIGN_BASE_COINS = {
    25: 10,
    50: 20,
    75: 30,
    100: 40,
    150: 60,
    200: 80,
}

LEADERBOARD_REWARD_TIERS = [
    (1, 1, 100),
    (2, 10, 50),
    (11, 20, 45),
    (21, 30, 30),
    (31, 40, 25),
    (41, 50, 20),
    (51, 60, 15),
    (61, 70, 12),
    (71, 80, 10),
    (81, 90, 8),
    (91, 100, 5),
]


def _normalize_user_record(user: dict) -> dict:
    """Ensures all expected keys and turning stat bounds exist on a user record."""
    user.setdefault("lifetime_earnings", 0)
    user.setdefault("completed_levels", [])
    user.setdefault("completed_night_levels", [])
    user.setdefault("control_pos", {"bottom": 24, "left": 24})
    user.setdefault("bgm_volume", 0.8)
    user.setdefault("sfx_volume", 1.0)
    user.setdefault("bgm_enabled", True)
    user.setdefault("sfx_enabled", True)
    stats = user.setdefault("stats", {})
    turning_stat = stats.get("turning")
    if isinstance(turning_stat, dict):
        turning_stat["max"] = 0.5
        turning_stat["step"] = 0.001
        turning_stat["min"] = 0.001
        turning_stat["unlocked"] = min(0.5, float(turning_stat.get("unlocked", 0.025)))
        turning_stat["current"] = min(turning_stat["unlocked"], float(turning_stat.get("current", 0.025)))
    return user


def save_database_state():
    """Persists current USERS_DB, leaderboards, and REWARD_STATE safely to disk."""
    with _STORE_LOCK:
        try:
            serialized_level_lbs = {
                str(k): v for k, v in LEVEL_LEADERBOARDS.items() if v
            }
            weekly_period = REWARD_STATE.get("last_weekly_period", datetime.date.today().isocalendar()[:2])
            payload = {
                "users": USERS_DB,
                "level_leaderboards": serialized_level_lbs,
                "daily_leaderboard": DAILY_LEADERBOARD,
                "reward_state": {
                    "last_daily_date": REWARD_STATE.get("last_daily_date", str(datetime.date.today())),
                    "last_weekly_period": list(weekly_period),
                    "recent_payouts": REWARD_STATE.get("recent_payouts", {}),
                },
            }
            os.makedirs(_DATA_DIR, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(dir=_DATA_DIR, prefix=".db_tmp_", suffix=".json")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(payload, f, indent=2)
                os.replace(tmp_path, _PERSISTENCE_FILE)
            except Exception:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
                raise
        except Exception as exc:
            print(f"[DB PERSISTENCE] Warning: could not save state: {exc}")


def load_database_state():
    """Loads persisted state from disk into in-memory structures if available."""
    with _STORE_LOCK:
        if not os.path.exists(_PERSISTENCE_FILE):
            return
        try:
            with open(_PERSISTENCE_FILE, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                return

            loaded_users = payload.get("users")
            if isinstance(loaded_users, dict):
                USERS_DB.clear()
                for uname, udata in loaded_users.items():
                    if isinstance(udata, dict):
                        USERS_DB[uname] = _normalize_user_record(udata)

            loaded_level_lbs = payload.get("level_leaderboards")
            if isinstance(loaded_level_lbs, dict):
                for k_str, entries in loaded_level_lbs.items():
                    try:
                        k_int = int(k_str)
                    except (ValueError, TypeError):
                        continue
                    if k_int in LEVEL_LEADERBOARDS and isinstance(entries, list):
                        LEVEL_LEADERBOARDS[k_int] = entries[:100]

            loaded_daily = payload.get("daily_leaderboard")
            if isinstance(loaded_daily, list):
                DAILY_LEADERBOARD.clear()
                DAILY_LEADERBOARD.extend(loaded_daily[:100])

            loaded_reward = payload.get("reward_state")
            if isinstance(loaded_reward, dict):
                if loaded_reward.get("last_daily_date"):
                    REWARD_STATE["last_daily_date"] = str(loaded_reward["last_daily_date"])
                wk = loaded_reward.get("last_weekly_period")
                if isinstance(wk, (list, tuple)) and len(wk) == 2:
                    REWARD_STATE["last_weekly_period"] = (int(wk[0]), int(wk[1]))
                payouts = loaded_reward.get("recent_payouts")
                if isinstance(payouts, dict):
                    REWARD_STATE["recent_payouts"] = payouts
        except Exception as exc:
            print(f"[DB PERSISTENCE] Warning: could not load state: {exc}")


def get_leaderboard_reward_for_rank(rank: int) -> int:
    """Returns coin reward for ranks 1..100, or 0 outside top 100."""
    for start_r, end_r, reward in LEADERBOARD_REWARD_TIERS:
        if start_r <= rank <= end_r:
            return reward
    return 0


def get_campaign_coin_reward(grid_size: int, is_night_drive: bool = False) -> int:
    """Returns first-clear coin reward for standard campaign or night drive (2x)."""
    base = CAMPAIGN_BASE_COINS.get(int(grid_size), 10)
    return base * 2 if is_night_drive else base


def credit_user_coins(username: str, amount: int, count_as_earning: bool = True):
    """
    Credits or deducts coins for a user.
    - When earning (amount > 0 and count_as_earning=True), increments both
      `coins` and `lifetime_earnings`.
    - When spending (amount < 0), reduces only `coins`; `lifetime_earnings` never drops.
    """
    if username not in USERS_DB:
        return
    user = _normalize_user_record(USERS_DB[username])
    if amount >= 0:
        user["coins"] += amount
        if count_as_earning and amount > 0:
            user["lifetime_earnings"] = user.get("lifetime_earnings", 0) + amount
    else:
        user["coins"] = max(0, user["coins"] + amount)
    save_database_state()


def get_or_create_user(username: str, password: str, color: str = "#3b82f6") -> dict:
    """
    Retrieves an existing user profile or initializes a new one with
    default starting coins (excluded from lifetime_earnings), stats, and preferences.
    """
    if username not in USERS_DB:
        USERS_DB[username] = _normalize_user_record({
            "password": password,
            "color": color,
            "coins": 100,  # Starting currency balance (not counted in lifetime_earnings)
            "lifetime_earnings": 0,  # Starts at 0; only increases on earned rewards
            "completed_levels": [],
            "completed_night_levels": [],
            # Vehicle tuning parameters with unlocked limits and current configured values
            "stats": {
                "topSpeed": {"unlocked": 5.0, "current": 5.0, "min": 2.0, "max": 50.0, "step": 0.1},
                "acceleration": {"unlocked": 0.03, "current": 0.03, "min": 0.01, "max": 0.30, "step": 0.01},
                "brake": {"unlocked": 0.04, "current": 0.04, "min": 0.01, "max": 0.50, "step": 0.01},
                "turning": {"unlocked": 0.025, "current": 0.025, "min": 0.001, "max": 0.5, "step": 0.001},
                "drift": {"unlocked": 0.50, "current": 0.50, "min": 0.10, "max": 1.00, "step": 0.01},
                "reverse": {"unlocked": 1.0, "current": 1.0, "min": 0.5, "max": 20.0, "step": 0.01},
                "friction": {"unlocked": 0.975, "current": 0.975, "min": 0.850, "max": 0.999, "step": 0.01}
            },
            "control_pos": {"bottom": 24, "left": 24},
            "bgm_volume": 0.8,
            "sfx_volume": 1.0,
            "bgm_enabled": True,
            "sfx_enabled": True
        })
        save_database_state()
    else:
        _normalize_user_record(USERS_DB[username])
    return USERS_DB[username]


# Hydrate persisted state on module import
load_database_state()
