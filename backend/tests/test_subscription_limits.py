import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DB_FILE = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
DB_FILE.close()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_FILE.name}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-subscriptions")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-for-subscriptions")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.models  # noqa: E402,F401
from app.core.database import Base  # noqa: E402
from app.models.subscription import PlanType, Subscription  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.subscription.limit_checker import LimitChecker  # noqa: E402

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def db():
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_missing_subscription_defaults_to_free_plan(db):
    user = User(email="free@example.com")
    db.add(user)
    db.commit()
    db.refresh(user)

    LimitChecker.check_allowed(db, user.id)

    sub = db.query(Subscription).filter(Subscription.user_id == user.id).one()
    assert sub.plan == PlanType.FREE
    assert sub.is_active is True


def test_free_plan_limit_is_enforced(db):
    user = User(email="limited@example.com")
    db.add(user)
    db.commit()
    db.refresh(user)

    for index in range(LimitChecker.FREE_LIMIT):
        LimitChecker.record_usage(db, user.id, f"/ai/{index}")

    with pytest.raises(HTTPException) as exc:
        LimitChecker.check_allowed(db, user.id)

    assert exc.value.status_code == 402
    assert exc.value.detail["code"] == "SUBSCRIPTION_LIMIT_REACHED"
