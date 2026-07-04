from typing import Optional

import stripe
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.subscription import Subscription, PlanType
from app.models.user import User

stripe.api_key = settings.STRIPE_SECRET_KEY


def _set_subscription_state(sub: Subscription, *, customer_id: Optional[str] = None, subscription_id: Optional[str] = None, active: bool, plan: PlanType):
    if customer_id:
        sub.stripe_customer_id = customer_id
    if subscription_id:
        sub.stripe_subscription_id = subscription_id
    sub.plan = plan
    sub.is_active = active


def _find_subscription(db: Session, *, subscription_id: Optional[str] = None, customer_id: Optional[str] = None) -> Optional[Subscription]:
    if subscription_id:
        match = db.query(Subscription).filter(Subscription.stripe_subscription_id == subscription_id).first()
        if match:
            return match
    if customer_id:
        return db.query(Subscription).filter(Subscription.stripe_customer_id == customer_id).first()
    return None


def _billing_config_error(message: str) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "BILLING_NOT_CONFIGURED",
            "message": message,
        },
    )


def _require_live_billing_config() -> None:
    if not settings.STRIPE_SECRET_KEY:
        raise _billing_config_error("STRIPE_SECRET_KEY is required for billing.")
    if settings.is_production and not settings.STRIPE_SECRET_KEY.startswith("sk_live_"):
        raise _billing_config_error("Stripe live mode requires an sk_live_ secret key in production.")
    if not settings.STRIPE_PRO_PRICE_ID:
        raise _billing_config_error("STRIPE_PRO_PRICE_ID is required for checkout.")
    if not settings.STRIPE_PRO_PRICE_ID.startswith("price_"):
        raise _billing_config_error("STRIPE_PRO_PRICE_ID must be a Stripe Price ID.")
    if not settings.STRIPE_BILLING_SUCCESS_URL or not settings.STRIPE_BILLING_CANCEL_URL:
        raise _billing_config_error("Stripe checkout success and cancel URLs are required.")

    stripe.api_key = settings.STRIPE_SECRET_KEY


def create_checkout_session(user: User, db: Session) -> dict:
    _require_live_billing_config()
    sub = db.query(Subscription).filter(Subscription.user_id == int(user.id)).first()
    if not sub:
        sub = Subscription(user_id=int(user.id), plan=PlanType.FREE, is_active=True)
        db.add(sub)
        db.commit()
        db.refresh(sub)

    checkout_kwargs = {
        "mode": "subscription",
        "client_reference_id": str(user.id),
        "line_items": [{"price": settings.STRIPE_PRO_PRICE_ID, "quantity": 1}],
        "success_url": settings.STRIPE_BILLING_SUCCESS_URL,
        "cancel_url": settings.STRIPE_BILLING_CANCEL_URL,
        "metadata": {"user_id": str(user.id)},
        "subscription_data": {"metadata": {"user_id": str(user.id)}},
    }
    if sub.stripe_customer_id:
        checkout_kwargs["customer"] = sub.stripe_customer_id
    else:
        checkout_kwargs["customer_email"] = user.email

    session = stripe.checkout.Session.create(**checkout_kwargs)
    return {"url": session["url"] if isinstance(session, dict) else session.url}


def create_customer_portal_session(user: User, db: Session) -> dict:
    _require_live_billing_config()
    return_url = settings.STRIPE_CUSTOMER_PORTAL_RETURN_URL or settings.STRIPE_BILLING_SUCCESS_URL
    sub = db.query(Subscription).filter(Subscription.user_id == int(user.id)).first()
    if not sub or not sub.stripe_customer_id:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "STRIPE_CUSTOMER_NOT_FOUND",
                "message": "No Stripe customer exists for this user yet.",
            },
        )

    session = stripe.billing_portal.Session.create(
        customer=sub.stripe_customer_id,
        return_url=return_url,
    )
    return {"url": session["url"] if isinstance(session, dict) else session.url}


def _apply_subscription_payload(sub: Subscription, subscription_data: dict):
    status = str(subscription_data.get("status") or "").strip().lower()
    active_statuses = {"active", "trialing"}
    is_active = status in active_statuses
    _set_subscription_state(
        sub,
        customer_id=subscription_data.get("customer"),
        subscription_id=subscription_data.get("id"),
        active=is_active,
        plan=PlanType.PRO if is_active else PlanType.FREE,
    )

def handle_checkout_session(session_data: dict, db: Session):
    # Expecting client_reference_id to be user_id
    user_id = session_data.get('client_reference_id')
    customer_id = session_data.get('customer')
    subscription_id = session_data.get('subscription')
    
    if not user_id:
        return
        
    sub = db.query(Subscription).filter(Subscription.user_id == int(user_id)).first()
    if sub:
        _set_subscription_state(
            sub,
            customer_id=customer_id,
            subscription_id=subscription_id,
            active=True,
            plan=PlanType.PRO,
        )
        db.commit()

def handle_subscription_deleted(subscription_id: str, db: Session):
    sub = db.query(Subscription).filter(Subscription.stripe_subscription_id == subscription_id).first()
    if sub:
        _set_subscription_state(sub, active=False, plan=PlanType.FREE)
        db.commit()


def handle_subscription_updated(subscription_data: dict, db: Session):
    sub = _find_subscription(
        db,
        subscription_id=subscription_data.get("id"),
        customer_id=subscription_data.get("customer"),
    )
    if sub:
        _apply_subscription_payload(sub, subscription_data)
        db.commit()


def handle_invoice_paid(invoice_data: dict, db: Session):
    sub = _find_subscription(
        db,
        subscription_id=invoice_data.get("subscription"),
        customer_id=invoice_data.get("customer"),
    )
    if sub:
        _set_subscription_state(
            sub,
            customer_id=invoice_data.get("customer"),
            subscription_id=invoice_data.get("subscription"),
            active=True,
            plan=PlanType.PRO,
        )
        db.commit()


def handle_invoice_payment_failed(invoice_data: dict, db: Session):
    sub = _find_subscription(
        db,
        subscription_id=invoice_data.get("subscription"),
        customer_id=invoice_data.get("customer"),
    )
    if sub:
        _set_subscription_state(
            sub,
            customer_id=invoice_data.get("customer"),
            subscription_id=invoice_data.get("subscription"),
            active=False,
            plan=PlanType.FREE,
        )
        db.commit()
