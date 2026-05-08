from datetime import datetime, timedelta, timezone
import hashlib
from typing import Any, Dict, Optional, Union
from uuid import uuid4

from jose import JWTError, jwt
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from app.core.config import settings

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

class EncryptionError(Exception):
    """Raised when encryption/decryption fails due to missing key."""
    pass

def _get_cipher() -> Fernet:
    """Get Fernet cipher suite from settings - validates key exists at runtime."""
    encryption_key = settings.ENCRYPTION_KEY
    if not encryption_key:
        raise EncryptionError("ENCRYPTION_KEY environment variable is not set.")
    if encryption_key.startswith("CHANGE_THIS") or len(encryption_key) < 32:
        raise EncryptionError("ENCRYPTION_KEY is using placeholder or too short.")
    try:
        return Fernet(encryption_key.encode())
    except Exception as e:
        raise EncryptionError(f"Invalid ENCRYPTION_KEY format: {str(e)}")

ALGORITHM = settings.ALGORITHM

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
    return _get_cipher().encrypt(credential.encode()).decode()

def decrypt_credential(encrypted_credential: str) -> str:
    return _get_cipher().decrypt(encrypted_credential.encode()).decode()


def hash_password_reset_code(email: str, code: str) -> str:
    normalized_email = email.strip().lower()
    digest = hashlib.sha256(f"{settings.SECRET_KEY}:{normalized_email}:{code}".encode()).hexdigest()
    return digest
