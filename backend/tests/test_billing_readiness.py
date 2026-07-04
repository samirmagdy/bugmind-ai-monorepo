import os
import sys
import tempfile
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

DB_FILE = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
DB_FILE.close()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_FILE.name}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-billing-readiness")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.models  # noqa: E402,F401
from app.api import deps  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app.models.subscription import PlanType, Subscription  # noqa: E402
from app.models.usage import UsageLog  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.subscription.limit_checker import LimitChecker  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def db():
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    fastapi_app.dependency_overrides[deps.get_db] = override_get_db
    yield session
    fastapi_app.dependency_overrides.pop(deps.get_db, None)
    fastapi_app.dependency_overrides.pop(deps.get_current_user, None)
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    test_client = TestClient(fastapi_app)
    yield test_client
    test_client.close()


def _create_user(db, email="billing@example.com") -> User:
    user = User(email=email)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _configure_stripe(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_live_")
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "whsec_")
    monkeypatch.setattr(settings, "STRIPE_PRO_PRICE_ID", "price_test_pro")
    monkeypatch.setattr(settings, "STRIPE_BILLING_SUCCESS_URL", "https://app.example.com/billing/success")
    monkeypatch.setattr(settings, "STRIPE_BILLING_CANCEL_URL", "https://app.example.com/billing/cancel")
    monkeypatch.setattr(settings, "STRIPE_CUSTOMER_PORTAL_RETURN_URL", "https://app.example.com/billing")


def _stripe_event(monkeypatch, event_type: str, event_object: dict):
    def construct_event(payload, sig_header, secret):
        assert sig_header == "signed"
        assert secret == "whsec_"
        return {"id": f"evt_{event_type}", "type": event_type, "data": {"object": event_object}}

    monkeypatch.setattr("app.api.v1.stripe.stripe.Webhook.construct_event", construct_event)


def _post_webhook(client, event_type: str, event_object: dict, monkeypatch):
    _stripe_event(monkeypatch, event_type, event_object)
    response = client.post(
        "/api/v1/stripe/webhook",
        content=b"{}",
        headers={"stripe-signature": "signed"},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "success"}


def test_checkout_session_requires_live_mode_in_production(client, db, monkeypatch):
    user = _create_user(db)
    fastapi_app.dependency_overrides[deps.get_current_user] = lambda: user
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_")
    monkeypatch.setattr(settings, "STRIPE_PRO_PRICE_ID", "price_test_pro")
    monkeypatch.setattr(settings, "STRIPE_BILLING_SUCCESS_URL", "https://app.example.com/billing/success")
    monkeypatch.setattr(settings, "STRIPE_BILLING_CANCEL_URL", "https://app.example.com/billing/cancel")

    response = client.post("/api/v1/stripe/checkout-session")

    assert response.status_code == 503
    assert "BILLING_NOT_CONFIGURED" in response.text


def test_checkout_session_creates_subscription_checkout(client, db, monkeypatch):
    user = _create_user(db)
    captured_kwargs = {}
    fastapi_app.dependency_overrides[deps.get_current_user] = lambda: user
    _configure_stripe(monkeypatch)

    def create_checkout(**kwargs):
        captured_kwargs.update(kwargs)
        return {"url": "https://checkout.stripe.com/session/cs_live_123"}

    monkeypatch.setattr("app.core.stripe_service.stripe.checkout.Session.create", create_checkout)

    response = client.post("/api/v1/stripe/checkout-session")

    assert response.status_code == 200, response.text
    assert response.json() == {"url": "https://checkout.stripe.com/session/cs_live_123"}
    assert captured_kwargs["mode"] == "subscription"
    assert captured_kwargs["client_reference_id"] == str(user.id)
    assert captured_kwargs["customer_email"] == user.email
    assert captured_kwargs["line_items"] == [{"price": "price_test_pro", "quantity": 1}]


def test_customer_portal_requires_existing_stripe_customer(client, db, monkeypatch):
    user = _create_user(db)
    db.add(Subscription(user_id=user.id, plan=PlanType.FREE, is_active=True))
    db.commit()
    fastapi_app.dependency_overrides[deps.get_current_user] = lambda: user
    _configure_stripe(monkeypatch)

    response = client.post("/api/v1/stripe/customer-portal")

    assert response.status_code == 404
    assert "STRIPE_CUSTOMER_NOT_FOUND" in response.text


def test_webhooks_upgrade_downgrade_and_enforce_subscription_limits(client, db, monkeypatch):
    _configure_stripe(monkeypatch)
    user = _create_user(db)
    db.add(
        Subscription(
            user_id=user.id,
            plan=PlanType.FREE,
            is_active=False,
            stripe_customer_id="cus_123",
            stripe_subscription_id="sub_123",
        )
    )
    for index in range(LimitChecker.FREE_LIMIT):
        db.add(UsageLog(user_id=user.id, endpoint=f"/ai/{index}", tokens_used=0))
    db.commit()

    _post_webhook(
        client,
        "customer.subscription.updated",
        {"id": "sub_123", "customer": "cus_123", "status": "active"},
        monkeypatch,
    )

    db.expire_all()
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).one()
    assert sub.plan == PlanType.PRO
    assert sub.is_active is True
    LimitChecker.check_allowed(db, user.id)

    _post_webhook(
        client,
        "customer.subscription.updated",
        {"id": "sub_123", "customer": "cus_123", "status": "past_due"},
        monkeypatch,
    )

    db.expire_all()
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).one()
    assert sub.plan == PlanType.FREE
    assert sub.is_active is False
    with pytest.raises(Exception) as exc:
        LimitChecker.check_allowed(db, user.id)
    assert getattr(exc.value, "status_code", None) == 402


def test_checkout_and_cancellation_webhooks_update_subscription(client, db, monkeypatch):
    _configure_stripe(monkeypatch)
    user = _create_user(db)
    db.add(Subscription(user_id=user.id, plan=PlanType.FREE, is_active=True))
    db.commit()

    _post_webhook(
        client,
        "checkout.session.completed",
        {
            "client_reference_id": str(user.id),
            "customer": "cus_checkout",
            "subscription": "sub_checkout",
        },
        monkeypatch,
    )

    db.expire_all()
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).one()
    assert sub.plan == PlanType.PRO
    assert sub.is_active is True
    assert sub.stripe_customer_id == "cus_checkout"
    assert sub.stripe_subscription_id == "sub_checkout"

    _post_webhook(
        client,
        "customer.subscription.deleted",
        {"id": "sub_checkout", "customer": "cus_checkout"},
        monkeypatch,
    )

    db.expire_all()
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).one()
    assert sub.plan == PlanType.FREE
    assert sub.is_active is False
