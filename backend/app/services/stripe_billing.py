import stripe
import os
from dotenv import load_dotenv
from typing import Optional

load_dotenv()

stripe.api_key = os.getenv("STRIPE_API_KEY")

class StripeService:
    @staticmethod
    async def create_checkout_session(customer_id: str, email: str, price_id: str, success_url: str, cancel_url: str) -> str:
        try:
            session = stripe.checkout.Session.create(
                customer=customer_id,
                payment_method_types=['card'],
                line_items=[{
                    'price': price_id,
                    'quantity': 1,
                }],
                mode='subscription',
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={'email': email}
            )
            return session.url
        except Exception as e:
            raise Exception(f"Failed to create Stripe session: {e}")

    @staticmethod
    async def create_customer(email: str) -> str:
        try:
            customer = stripe.Customer.create(email=email)
            return customer.id
        except Exception as e:
            raise Exception(f"Failed to create Stripe customer: {e}")

    @staticmethod
    def handle_webhook(payload: str, sig_header: str) -> Optional[dict]:
        endpoint_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, endpoint_secret
            )
            return event
        except ValueError as e:
            # Invalid payload
            return None
        except stripe.error.SignatureVerificationError as e:
            # Invalid signature
            return None
