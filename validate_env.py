#!/usr/bin/env python3
"""
Script to validate environment configuration for deployment.
Run this script locally to check if all required environment variables are set.
"""
import os
import sys
import re
from pathlib import Path

# Add parent directory to path to import config
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from app.core.config import settings

def check_env(var_name, required=False, pattern=None):
    value = os.environ.get(var_name, "")
    status = "✓" if value else "✗" if required else "○"
    
    if required and not value:
        print(f"{status} REQUIRED: {var_name} is not set")
        return False
    
    if pattern and value:
        if re.match(pattern, value):
            print(f"{status} {var_name}: {value[:20]}..." if len(value) > 20 else f"{status} {var_name}: {value}")
            return True
        else:
            print(f"{status} {var_name}: {value[:20]}..." if len(value) > 20 else f"{status} {var_name}: {value}")
            print(f"    WARNING: Value doesn't match expected pattern")
            return False
    
    if value:
        print(f"{status} {var_name}: {value[:20]}..." if len(value) > 20 else f"{status} {var_name}: {value}")
    else:
        print(f"{status} {var_name}: (not set)")
    
    return True if not required else False

def main():
    print("=" * 60)
    print("Environment Configuration Validation")
    print("=" * 60)
    print(f"Current Environment: {settings.ENVIRONMENT}")
    print(f"Current DATABASE_URL: {settings.DATABASE_URL[:30]}..." if len(settings.DATABASE_URL) > 30 else f"Current DATABASE_URL: {settings.DATABASE_URL}")
    print()
    
    all_good = True
    
    # Check for .env files
    root_env = Path(__file__).parent / ".env"
    backend_env = Path(__file__).parent / "backend" / ".env"
    
    print("--- .env Files ---")
    if root_env.exists():
        print(f"✓ Root .env exists: {root_env}")
    else:
        print(f"✗ Root .env missing: {root_env}")
        all_good = False
    
    if backend_env.exists():
        print(f"✓ Backend .env exists: {backend_env}")
    else:
        print(f"○ Backend .env missing: {backend_env}")
    print()
    
    # Check environment variables
    print("--- Environment Variables ---")
    
    checks = [
        ("ENVIRONMENT", True, None),
        ("DATABASE_URL", True, r"^(sqlite|postgresql|postgres|supabase)"),
        ("SECRET_KEY", True, r"^.{20,}$"),
        ("ENCRYPTION_KEY", True, r"^.{20,}$"),
        ("OPENROUTER_API_KEY", False, r"^sk-or-v1-"),
        ("STRIPE_SECRET_KEY", False, r"^sk_(test|live)-"),
        ("ALLOWED_HOSTS", False, r"^https?://"),
        ("CORS_ORIGINS", False, r"^https?://"),
    ]
    
    for var_name, required, pattern in checks:
        if not check_env(var_name, required=required, pattern=pattern):
            all_good = False
    print()
    
    # Check database connection if not SQLite
    print("--- Database Check ---")
    if not settings.DATABASE_URL.startswith("sqlite"):
        db_url_lower = settings.DATABASE_URL.lower()
        print("Note: Using PostgreSQL database")
        if "supabase" in db_url_lower:
            print("✓ Using Supabase database")
        elif "render.com" in db_url_lower:
            print("✓ Using Render managed database")
        elif "localhost" in db_url_lower or "127.0.0.1" in db_url_lower:
            print("⚠ Using local database - ensure PostgreSQL is running")
        else:
            print("✓ Using remote database")
    else:
        print("✓ Using SQLite database (development mode)")
    print()
    
    # Summary
    print("=" * 60)
    if all_good:
        print("✓ All checks passed! Ready for deployment.")
    else:
        print("✗ Some checks failed. Please fix above issues.")
    print("=" * 60)
    
    return 0 if all_good else 1

if __name__ == "__main__":
    sys.exit(main())
