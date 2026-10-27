import datetime

USERS_DB = {}  # username -> profile dictionary
LEVEL_LEADERBOARDS = {i: [] for i in range(1, 101)}  # 1 to 100 level leaderboards
DAILY_LEADERBOARDS = {}  # date_str -> []
COIN_LEADERBOARD = {}  # username -> net_coins

# Top 100 Standardized Tiered Payout Map
PAYOUT_TIERS = {
    1: 20,
    **{rank: 10 for rank in range(2, 11)},
    **{rank: 9 for rank in range(11, 21)},
    **{rank: 8 for rank in range(21, 31)},
    **{rank: 7 for rank in range(31, 41)},
    **{rank: 6 for rank in range(41, 51)},
    **{rank: 5 for rank in range(51, 61)},
    **{rank: 4 for rank in range(61, 71)},
    **{rank: 3 for rank in range(71, 81)},
    **{rank: 2 for rank in range(81, 91)},
    **{rank: 1 for rank in range(91, 101)},
}

def get_payout_for_rank(rank: int) -> int:
    return PAYOUT_TIERS.get(rank, 0)

def get_or_create_user(username, password, color="#3b82f6"):
    if username not in USERS_DB:
        USERS_DB[username] = {
            "password": password,
            "color": color,
            "coins": 100,
            "completed_levels": [],
            "daily_records": {},  # date_str -> time_ms
            "stats": {
                "topSpeed": {"unlocked": 6.5, "current": 6.5, "min": 3.0, "max": 12.0, "step": 0.3},
                "acceleration": {"unlocked": 0.050, "current": 0.050, "min": 0.020, "max": 0.150, "step": 0.005},
                "brake": {"unlocked": 0.065, "current": 0.065, "min": 0.020, "max": 0.180, "step": 0.005},
                "turning": {"unlocked": 0.040, "current": 0.040, "min": 0.020, "max": 0.100, "step": 0.003},
                "drift": {"unlocked": 0.5, "current": 0.5, "min": 0.1, "max": 1.0, "step": 0.05},
                "reverse": {"unlocked": 2.0, "current": 2.0, "min": 1.0, "max": 5.0, "step": 0.2},
                "friction": {"unlocked": 0.990, "current": 0.990, "min": 0.950, "max": 0.998, "step": 0.002}
            },
            "bgm_volume": 0.8,
            "sfx_volume": 1.0,
            "bgm_enabled": True,
            "sfx_enabled": True
        }
    return USERS_DB[username]
