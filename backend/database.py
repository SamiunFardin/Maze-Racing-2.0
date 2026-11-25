"""
database.py
-----------
In-memory database simulation storing user profiles, vehicle stats,
level progression, lifetime earnings, and global/level/daily leaderboards.
"""

import datetime

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
    user = USERS_DB[username]
    if amount >= 0:
        user["coins"] += amount
        if count_as_earning and amount > 0:
            user["lifetime_earnings"] = user.get("lifetime_earnings", 0) + amount
    else:
        user["coins"] = max(0, user["coins"] + amount)


def get_or_create_user(username: str, password: str, color: str = "#3b82f6") -> dict:
    """
    Retrieves an existing user profile or initializes a new one with
    default starting coins (excluded from lifetime_earnings), stats, and preferences.
    """
    if username not in USERS_DB:
        USERS_DB[username] = {
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
                "turning": {"unlocked": 0.025, "current": 0.025, "min": 0.010, "max": 0.250, "step": 0.01},
                "drift": {"unlocked": 0.50, "current": 0.50, "min": 0.10, "max": 1.00, "step": 0.01},
                "reverse": {"unlocked": 1.0, "current": 1.0, "min": 0.5, "max": 20.0, "step": 0.01},
                "friction": {"unlocked": 0.975, "current": 0.975, "min": 0.850, "max": 0.999, "step": 0.01}
            },
            "control_pos": {"bottom": 24, "left": 24},
            "bgm_volume": 0.8,
            "sfx_volume": 1.0,
            "bgm_enabled": True,
            "sfx_enabled": True
        }
    else:
        user = USERS_DB[username]
        user.setdefault("lifetime_earnings", 0)
        user.setdefault("completed_night_levels", [])
    return USERS_DB[username]
