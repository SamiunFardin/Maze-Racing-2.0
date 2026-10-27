# User storage, inventory, stats, and leaderboard tracking
USERS_DB = {}  # username -> {password, color, coins, stats, campaign_progress}
LEVEL_LEADERBOARDS = {i: {} for i in range(1, 101)}  # level_num -> {username: time}
DAILY_LEADERBOARD = {}  # username -> best_time
COIN_LEADERBOARD = {}  # username -> total_coins

def get_or_create_user(username, password, color="#3b82f6"):
    if username not in USERS_DB:
        USERS_DB[username] = {
            "password": password,
            "color": color,
            "coins": 50,  # Starting tuning seed coins
            "stats": {
                "top_speed": {"unlocked_range": 5.0, "current": 5.0},
                "acceleration": {"unlocked_range": 0.2, "current": 0.2},
                "brake": {"unlocked_range": 0.3, "current": 0.3},
                "turning": {"unlocked_range": 0.05, "current": 0.05},
                "drift": {"unlocked_range": 0.5, "current": 0.5},
                "reverse": {"unlocked_range": 2.0, "current": 2.0},
                "friction": {"unlocked_range": 0.98, "current": 0.98}
            },
            "campaign_progress": 1
        }
    return USERS_DB[username]
  
