from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from ..db.session import get_db
from ..models import database as models
from ..schemas import schemas
from ..services.stripe_billing import StripeService
from .bugs import get_current_user
import os

router = APIRouter(prefix="/api/billing", tags=["billing"])

@router.post("/checkout")
async def create_checkout(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Get or create Stripe customer
    sub = db.query(models.Subscription).filter(models.Subscription.user_id == current_user.id).first()
    if not sub or not sub.stripe_customer_id:
        customer_id = await StripeService.create_customer(current_user.email)
        if not sub:
            sub = models.Subscription(user_id=current_user.id, stripe_customer_id=customer_id)
            db.add(sub)
        else:
            sub.stripe_customer_id = customer_id
        db.commit()
    
    # Create checkout session
    price_id = os.getenv("STRIPE_PRO_PRICE_ID", "price_...")
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    
    url = await StripeService.create_checkout_session(
        customer_id=sub.stripe_customer_id,
        email=current_user.email,
        price_id=price_id,
        success_url=f"{frontend_url}/success",
        cancel_url=f"{frontend_url}/cancel"
    )
    return {"url": url}

@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    event = StripeService.handle_webhook(payload, sig_header)
    if not event:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    
    # Handle subscription events
    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        customer_id = session.get('customer')
        sub = db.query(models.Subscription).filter(models.Subscription.stripe_customer_id == customer_id).first()
        if sub:
            sub.status = models.SubscriptionStatus.ACTIVE
            sub.plan = "pro"
            db.commit()
            
    return {"status": "success"}
