import hashlib,secrets
from argon2 import PasswordHasher
ph=PasswordHasher()
def hash_password(value:str)->str:return ph.hash(value)
def verify_password(digest:str,value:str)->bool:
    try:return ph.verify(digest,value)
    except Exception:return False
def new_token()->str:return secrets.token_urlsafe(32)
def token_digest(token:str)->bytes:return hashlib.sha256(token.encode()).digest()
