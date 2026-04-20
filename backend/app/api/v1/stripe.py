import stripe
from fastapi import APIRouter, Request, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api import deps
from app.core.config import settings
from app.core import stripe_service
from app.core.audit import log_audit

router = APIRouter()

@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(deps.get_db)):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=400, detail="Webhook secret not set")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError as e:
        raise HTTPException(status_code=400, detail="Invalid signature")

    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        stripe_service.handle_checkout_session(session, db)
    elif event['type'] == 'customer.subscription.deleted':
        subscription = event['data']['object']
        stripe_service.handle_subscription_deleted(subscription['id'], db)

    log_audit(
        "stripe.webhook_event",
        user_id=None,
        db=db,
        event_type=event['type'],
        event_id=event.get('id'),
    )
    return {"status": "success"}
