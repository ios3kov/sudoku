from fastapi import FastAPI
from .auth import router as auth_router
app=FastAPI(title="Sudoku API",docs_url=None,redoc_url=None)
app.include_router(auth_router)
@app.get("/v1/health")
async def health():return {"status":"ok"}
