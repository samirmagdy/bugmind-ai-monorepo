from cryptography.fernet import Fernet
import os
from dotenv import load_dotenv

load_dotenv()

# Master encryption key (must be 32 url-safe base64-encoded bytes)
ENCRYPTION_KEY = os.getenv("JIRA_ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    if os.getenv("ENV") == "production":
        raise RuntimeError("FATAL: JIRA_ENCRYPTION_KEY not provided in production environment. Jira tokens would be stored in plaintext.")
    import logging
    logging.getLogger("bugmind").warning("JIRA_ENCRYPTION_KEY not set — tokens will be stored unencrypted (dev mode only).")
# Current encryption version
CURRENT_VERSION = "v1"

def encrypt_token(token: str) -> str:
    """Encrypts a plain text token and prepends version."""
    if not ENCRYPTION_KEY or not token:
        return token
    
    f = Fernet(ENCRYPTION_KEY.encode())
    encrypted = f.encrypt(token.encode()).decode()
    return f"{CURRENT_VERSION}:{encrypted}"

def decrypt_token(encrypted_token: str) -> str:
    """Decrypts a token, supporting both versioned and legacy unversioned formats."""
    if not ENCRYPTION_KEY or not encrypted_token:
        return encrypted_token
        
    # Handle versioned tokens (e.g., "v1:...")
    if ":" in encrypted_token:
        version, data = encrypted_token.split(":", 1)
        if version == "v1":
            f = Fernet(ENCRYPTION_KEY.encode())
            return f.decrypt(data.encode()).decode()
        # Add future versions here
        return encrypted_token # Unknown version, return as is
        
    # Fallback: Handle legacy unversioned tokens (Fernet tokens start with gAAAA)
    if encrypted_token.startswith("gAAAA"):
        f = Fernet(ENCRYPTION_KEY.encode())
        return f.decrypt(encrypted_token.encode()).decode()
        
    return encrypted_token
