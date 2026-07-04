from sqlalchemy.orm import Session
from datetime import datetime, timezone
from app.models.subscription import Subscription, PlanType
from app.models.usage import UsageLog
from fastapi import HTTPException

class LimitChecker:
    FREE_LIMIT = 5

    @staticmethod
    def get_or_create_subscription(db: Session, user_id: int) -> Subscription:
        sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
        if sub:
            return sub
        sub = Subscription(user_id=user_id, plan=PlanType.FREE, is_active=True)
        db.add(sub)
        db.commit()
        db.refresh(sub)
        return sub
    
    @staticmethod
    def check_allowed(db: Session, user_id: int):
        sub = LimitChecker.get_or_create_subscription(db, user_id)
        effective_plan = sub.plan if sub.is_active else PlanType.FREE

        if effective_plan == PlanType.FREE:
            # Check usage for current month
            now = datetime.now(timezone.utc)
            first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            usage_count = db.query(UsageLog).filter(
                UsageLog.user_id == user_id,
                UsageLog.created_at >= first_day
            ).count()
            
            if usage_count >= LimitChecker.FREE_LIMIT:
                raise HTTPException(
                    status_code=402,
                    detail={
                        "code": "SUBSCRIPTION_LIMIT_REACHED",
                        "message": "Free tier limit reached. Please upgrade to Pro.",
                        "limit": LimitChecker.FREE_LIMIT,
                    },
                )

    @staticmethod
    def record_usage(db: Session, user_id: int, endpoint: str, tokens: int = 0):
        usage = UsageLog(user_id=user_id, endpoint=endpoint, tokens_used=tokens)
        db.add(usage)
        db.commit()

    @staticmethod
    def check_and_increment(db: Session, user_id: int, endpoint: str, tokens: int = 0):
        LimitChecker.check_allowed(db, user_id)
        LimitChecker.record_usage(db, user_id, endpoint, tokens)
