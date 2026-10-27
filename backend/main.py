from fastapi import FastAPI, HTTPException, Request
import random
from backend.database import USERS_DB, get_or_create_user, LEVEL_LEADERBOARDS

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

@app.get("/api/leaderboard/level/{level_id}")
def get_level_leaderboard(level_id: int):
    lb = LEVEL_LEADERBOARDS.get(level_id, {})
    sorted_lb = sorted(lb.items(), key=lambda x: x[1])[:100]
    return [{"rank": i+1, "username": item[0], "time": item[1]} for i, item in enumerate(sorted_lb)]
