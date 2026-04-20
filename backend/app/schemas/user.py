from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import datetime
import re

class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 12:
            raise ValueError("Password must be at least 12 characters long")
        if not re.search(r"[A-Z]", value):
            raise ValueError("Password must include at least one uppercase letter")
        if not re.search(r"[a-z]", value):
            raise ValueError("Password must include at least one lowercase letter")
        if not re.search(r"\d", value):
            raise ValueError("Password must include at least one number")
        if not re.search(r"[^A-Za-z0-9]", value):
            raise ValueError("Password must include at least one special character")
        return value

class UserResponse(UserBase):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
