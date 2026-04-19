from datetime import datetime, timedelta
from typing import Any, Union
from jose import jwt
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from app.core.config import settings

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Base64-encoded 32-byte key is needed for Fernet
_placeholders = [
    "32-byte-base64-encryption-key-for-jira-tokens",
    "CHANGE_THIS_IN_PRODUCTION_MUST_BE_32_BYTES_!"
]
if not settings.ENCRYPTION_KEY or settings.ENCRYPTION_KEY in _placeholders:
    raise ValueError("CRITICAL: ENCRYPTION_KEY is missing or using a placeholder value in .env. Please set a valid Fernet key.")

try:
    cipher_suite = Fernet(settings.ENCRYPTION_KEY.encode())
except Exception as e:
    raise ValueError(f"CRITICAL: Invalid ENCRYPTION_KEY format. Must be a valid Fernet key. Error: {str(e)}")

_secret_placeholders = [
    "CHANGE_THIS_IN_PRODUCTION_b8m9k2n3m4n5b6g7v8a9c0d1e2f3a4b"
]
if not settings.SECRET_KEY or settings.SECRET_KEY in _secret_placeholders:
    raise ValueError("CRITICAL: SECRET_KEY is missing or using a placeholder value in .env. Please set a secure application secret.")

ALGORITHM = "HS256"

def create_access_token(subject: Union[str, Any], expires_delta: timedelta = None) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(subject: Union[str, Any], expires_delta: timedelta = None) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {"exp": expire, "sub": str(subject), "type": "refresh"}
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def encrypt_credential(credential: str) -> str:
    return cipher_suite.encrypt(credential.encode()).decode()

def decrypt_credential(encrypted_credential: str) -> str:
    return cipher_suite.decrypt(encrypted_credential.encode()).decode()
