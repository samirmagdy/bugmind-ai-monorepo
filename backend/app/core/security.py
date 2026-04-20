from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Union
from uuid import uuid4

from jose import JWTError, jwt
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

def _build_token_payload(
    subject: Union[str, Any],
    token_type: str,
    expires_delta: Optional[timedelta] = None,
    jti: Optional[str] = None,
) -> Dict[str, Any]:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        if token_type == "refresh":
            expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    issued_at = datetime.now(timezone.utc)
    return {
        "exp": expire,
        "iat": issued_at,
        "sub": str(subject),
        "type": token_type,
        "iss": settings.JWT_ISSUER,
        "aud": settings.JWT_AUDIENCE,
        "jti": jti or str(uuid4()),
    }


def create_access_token(subject: Union[str, Any], expires_delta: timedelta = None) -> str:
    to_encode = _build_token_payload(subject, "access", expires_delta=expires_delta)
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(subject: Union[str, Any], expires_delta: timedelta = None, jti: Optional[str] = None) -> str:
    to_encode = _build_token_payload(subject, "refresh", expires_delta=expires_delta, jti=jti)
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str, expected_type: Optional[str] = None) -> Dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
        )
    except JWTError as exc:
        raise ValueError("Invalid token") from exc

    if expected_type and payload.get("type") != expected_type:
        raise ValueError("Invalid token type")
    if not payload.get("sub"):
        raise ValueError("Invalid token subject")
    if not payload.get("jti"):
        raise ValueError("Invalid token identifier")
    return payload

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def encrypt_credential(credential: str) -> str:
    return cipher_suite.encrypt(credential.encode()).decode()

def decrypt_credential(encrypted_credential: str) -> str:
    return cipher_suite.decrypt(encrypted_credential.encode()).decode()
