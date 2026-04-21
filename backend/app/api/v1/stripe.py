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

    event_type = event['type']
    event_object = event['data']['object']

    if event_type == 'checkout.session.completed':
        stripe_service.handle_checkout_session(event_object, db)
    elif event_type == 'customer.subscription.updated':
        stripe_service.handle_subscription_updated(event_object, db)
    elif event_type == 'customer.subscription.deleted':
        stripe_service.handle_subscription_deleted(event_object['id'], db)
    elif event_type == 'invoice.paid':
        stripe_service.handle_invoice_paid(event_object, db)
    elif event_type == 'invoice.payment_failed':
        stripe_service.handle_invoice_payment_failed(event_object, db)

    log_audit(
        "stripe.webhook_event",
        user_id=None,
        db=db,
        event_type=event_type,
        event_id=event.get('id'),
    )
    return {"status": "success"}
