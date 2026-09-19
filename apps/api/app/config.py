from pydantic_settings import BaseSettings, SettingsConfigDict
class Settings(BaseSettings):
    model_config=SettingsConfigDict(env_file=".env",extra="ignore")
    database_url:str="postgresql+asyncpg://sudoku:sudoku@localhost:5432/sudoku"
    redis_url:str="redis://localhost:6379/0"
    public_origin:str="http://localhost:3000"
    session_cookie:str="sudoku_session"
    session_days:int=30
    secure_cookies:bool=False
settings=Settings()
