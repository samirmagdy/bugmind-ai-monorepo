import stripe
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.subscription import Subscription, PlanType

stripe.api_key = settings.STRIPE_SECRET_KEY

def handle_checkout_session(session_data: dict, db: Session):
    # Expecting client_reference_id to be user_id
    user_id = session_data.get('client_reference_id')
    customer_id = session_data.get('customer')
    subscription_id = session_data.get('subscription')
    
    if not user_id:
        return
        
    sub = db.query(Subscription).filter(Subscription.user_id == int(user_id)).first()
    if sub:
        sub.stripe_customer_id = customer_id
        sub.stripe_subscription_id = subscription_id
        sub.plan = PlanType.PRO
        sub.is_active = True
        db.commit()

def handle_subscription_deleted(subscription_id: str, db: Session):
    sub = db.query(Subscription).filter(Subscription.stripe_subscription_id == subscription_id).first()
    if sub:
        sub.plan = PlanType.FREE
        db.commit()
