from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import random
from database import USERS_DB, get_or_create_user, LEVEL_LEADERBOARDS

app = FastAPI(title="Turbo Maze Racer API")

class AuthRequest(BaseModel):
    username: str
    password: str
    color: str = "#3b82f6"

@app.post("/api/login")
def login(data: AuthRequest):
    base_name = data.username.strip()
    if base_name in USERS_DB:
        if USERS_DB[base_name]["password"] != data.password:
            suggested = f"{base_name}_{random.randint(100, 999)}"
            raise HTTPException(status_code=400, detail=f"Username taken with different password. Try: {suggested}")
        user = USERS_DB[base_name]
    else:
        user = get_or_create_user(base_name, data.password, data.color)
    return {"status": "success", "username": base_name, "user_data": user}

@app.get("/api/leaderboard/level/{level_id}")
def get_level_leaderboard(level_id: int):
    lb = LEVEL_LEADERBOARDS.get(level_id, {})
    sorted_lb = sorted(lb.items(), key=lambda x: x[1])[:100]
    return [{"rank": i+1, "username": item[0], "time": item[1]} for i, item in enumerate(sorted_lb)]
