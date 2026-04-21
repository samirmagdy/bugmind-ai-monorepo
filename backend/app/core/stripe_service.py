import stripe
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.subscription import Subscription, PlanType

stripe.api_key = settings.STRIPE_SECRET_KEY


def _set_subscription_state(sub: Subscription, *, customer_id: str | None = None, subscription_id: str | None = None, active: bool, plan: PlanType):
    if customer_id:
        sub.stripe_customer_id = customer_id
    if subscription_id:
        sub.stripe_subscription_id = subscription_id
    sub.plan = plan
    sub.is_active = active


def _find_subscription(db: Session, *, subscription_id: str | None = None, customer_id: str | None = None) -> Subscription | None:
    if subscription_id:
        match = db.query(Subscription).filter(Subscription.stripe_subscription_id == subscription_id).first()
        if match:
            return match
    if customer_id:
        return db.query(Subscription).filter(Subscription.stripe_customer_id == customer_id).first()
    return None


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
