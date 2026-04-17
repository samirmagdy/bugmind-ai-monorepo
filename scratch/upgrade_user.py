import sys
import os

# Add the parent directory and backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.getcwd(), 'backend')))

from app.db.session import SessionLocal
from app.models.database import User, Subscription, SubscriptionStatus

def upgrade_user(email: str):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"User {email} not found")
            return
        
        sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
        if not sub:
            print(f"Creating new subscription for {email}")
            sub = Subscription(
                user_id=user.id,
                stripe_customer_id=f"manual_{user.id}",
                plan="pro",
                status=SubscriptionStatus.ACTIVE
            )
            db.add(sub)
        else:
            print(f"Updating existing subscription for {email}")
            sub.plan = "pro"
            sub.status = SubscriptionStatus.ACTIVE
        
        db.commit()
        print(f"User {email} successfully upgraded to PRO (Premium)")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    upgrade_user("s@s.com")
