# Master Database & 7-Stat Initial/Max Tuning Configuration
import datetime

USERS_DB = {}  # username -> profile data
LEVEL_LEADERBOARDS = {i: [] for i in range(1, 101)}

def get_or_create_user(username, password, color="#3b82f6"):
    if username not in USERS_DB:
        USERS_DB[username] = {
            "password": password,
            "color": color,
            "coins": 100,
            "completed_levels": [],
            "stats": {
                "topSpeed": {"unlocked": 4.0, "current": 4.0, "min": 2.0, "max": 40.0, "step": 0.5},
                "acceleration": {"unlocked": 0.03, "current": 0.03, "min": 0.01, "max": 0.30, "step": 0.01},
                "brake": {"unlocked": 0.04, "current": 0.04, "min": 0.01, "max": 0.50, "step": 0.02},
                "turning": {"unlocked": 0.025, "current": 0.025, "min": 0.010, "max": 0.250, "step": 0.010},
                "drift": {"unlocked": 0.50, "current": 0.50, "min": 0.10, "max": 1.00, "step": 0.05},
                "reverse": {"unlocked": 1.0, "current": 1.0, "min": 0.5, "max": 20.0, "step": 0.5},
                "friction": {"unlocked": 0.900, "current": 0.900, "min": 0.850, "max": 0.999, "step": 0.005}
            },
            "bgm_volume": 0.8,
            "sfx_volume": 1.0,
            "bgm_enabled": True,
            "sfx_enabled": True
        }
    return USERS_DB[username]
