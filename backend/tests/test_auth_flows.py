import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DB_FILE = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
DB_FILE.close()

os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_FILE.name}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-auth-flows")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "google-client-id.apps.googleusercontent.com")
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")

import app.models  # noqa: E402,F401
from typing import cast
from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.api import deps
from app.main import app as fastapi_app  # noqa: E402
from app.models.auth import PasswordResetCode, RefreshSession  # noqa: E402
from app.models.subscription import Subscription  # noqa: E402
from app.models.user import User  # noqa: E402
 
 
def override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class AuthFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        fastapi_app.dependency_overrides[deps.get_db] = override_get_db
        cls.client = TestClient(fastapi_app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        fastapi_app.dependency_overrides.pop(deps.get_db, None)
        Base.metadata.drop_all(bind=engine)
        try:
            os.unlink(DB_FILE.name)
        except OSError:
            pass

    def setUp(self):
        with SessionLocal() as db:
            for table in reversed(Base.metadata.sorted_tables):
                db.execute(table.delete())
            db.commit()

    def register_user(self, email="user@example.com", password="Password123!"):
        return self.client.post("/api/v1/auth/register", json={"email": email, "password": password})

    def login_user(self, email="user@example.com", password="Password123!"):
        return self.client.post(
            "/api/v1/auth/login",
            data={"username": email, "password": password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def test_register_creates_subscription(self):
        response = self.register_user()
        self.assertEqual(response.status_code, 200, response.text)

        with SessionLocal() as db:
            db.expire_all()
            user = db.query(User).filter(User.email == "user@example.com").first()
            self.assertIsNotNone(user, "User should have been created during registration")
            
            subscription = db.query(Subscription).filter(Subscription.user_id == cast(int, user.id)).first()
            self.assertIsNotNone(subscription, "Subscription should have been created for new user")

    def test_password_reset_revokes_existing_refresh_sessions(self):
        self.assertEqual(self.register_user().status_code, 200)
        login = self.login_user()
        self.assertEqual(login.status_code, 200, login.text)
        refresh_token = login.json()["refresh_token"]

        with patch("app.api.v1.auth._build_reset_code", return_value="123456"), patch("app.api.v1.auth.send_password_reset_code"):
            forgot = self.client.post("/api/v1/auth/password/forgot", json={"email": "user@example.com"})
        self.assertEqual(forgot.status_code, 200, forgot.text)

        with SessionLocal() as db:
            code_record = db.query(PasswordResetCode).filter(PasswordResetCode.email == "user@example.com").first()
            self.assertIsNotNone(code_record)

        reset = self.client.post(
            "/api/v1/auth/password/reset",
            json={
                "email": "user@example.com",
                "code": "123456",
                "new_password": "NewPassword123!",
            },
        )
        self.assertEqual(reset.status_code, 200, reset.text)

        refresh = self.client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(refresh.status_code, 400, refresh.text)
        self.assertIn("Invalid token", refresh.text)

        old_login = self.login_user(password="Password123!")
        self.assertEqual(old_login.status_code, 400, old_login.text)

        new_login = self.login_user(password="NewPassword123!")
        self.assertEqual(new_login.status_code, 200, new_login.text)

    def test_inactive_user_cannot_use_existing_session_or_refresh(self):
        self.assertEqual(self.register_user().status_code, 200)
        login = self.login_user()
        self.assertEqual(login.status_code, 200, login.text)
        access_token = login.json()["access_token"]
        refresh_token = login.json()["refresh_token"]

        with SessionLocal() as db:
            db.expire_all()
            user = db.query(User).filter(User.email == "user@example.com").first()
            self.assertIsNotNone(user, "User should have been created during registration")
            user.is_active = False
            db.add(user)
            db.commit()

        me = self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
        self.assertEqual(me.status_code, 401, me.text)
        self.assertIn("Inactive user", me.text)

        refresh = self.client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(refresh.status_code, 400, refresh.text)
        self.assertIn("Inactive user", refresh.text)

    def test_google_login_creates_user_and_subscription(self):
        with patch(
            "app.api.v1.auth.verify_google_id_token",
            return_value={
                "email": "google-user@example.com",
                "google_subject": "google-sub-123",
                "name": "Google User",
                "email_verified": True,
            },
        ):
            response = self.client.post("/api/v1/auth/google", json={"id_token": "google-token"})

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn("access_token", body)
        self.assertIn("refresh_token", body)

        with SessionLocal() as db:
            db.expire_all()
            user = db.query(User).filter(User.email == "google-user@example.com").first()
            self.assertIsNotNone(user, "User should have been created during Google login")
            
            subscription = db.query(Subscription).filter(Subscription.user_id == cast(int, user.id)).first()
            self.assertEqual(user.google_subject, "google-sub-123")
            self.assertIsNone(user.hashed_password)
            self.assertIsNotNone(subscription)

    def test_logout_revokes_refresh_session(self):
        self.assertEqual(self.register_user().status_code, 200)
        login = self.login_user()
        refresh_token = login.json()["refresh_token"]

        logout = self.client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
        self.assertEqual(logout.status_code, 200, logout.text)

        refresh = self.client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(refresh.status_code, 400, refresh.text)

        with SessionLocal() as db:
            self.assertEqual(db.query(RefreshSession).filter(RefreshSession.revoked_at.is_(None)).count(), 0)


if __name__ == "__main__":
    unittest.main()
