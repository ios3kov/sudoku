from pydantic import BaseModel,EmailStr,Field
class LoginIn(BaseModel):
    email:EmailStr
    password:str=Field(min_length=10,max_length=200)
    device_name:str=Field(default="Web PWA",max_length=160)
class InviteAcceptIn(BaseModel):
    token:str=Field(min_length=20,max_length=200)
    email:EmailStr
    display_name:str=Field(min_length=1,max_length=120)
    password:str=Field(min_length=10,max_length=200)
    device_name:str=Field(default="Web PWA",max_length=160)
class InviteCreateIn(BaseModel):
    email:EmailStr|None=None
    expires_hours:int=Field(default=168,ge=1,le=720)
class UserOut(BaseModel):
    id:str
    email:EmailStr
    display_name:str
    is_admin:bool
