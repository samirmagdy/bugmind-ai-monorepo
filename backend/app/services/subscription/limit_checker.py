from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import calendar
from app.models.subscription import Subscription, PlanType
from app.models.usage import UsageLog
from fastapi import HTTPException

class LimitChecker:
    FREE_LIMIT = 5
    
    @staticmethod
    def check_and_increment(db: Session, user_id: int, endpoint: str, tokens: int = 0):
        sub = db.query(Subscription).filter(Subscription.user_id == user_id).first()
        
        if not sub:
            raise HTTPException(status_code=403, detail="No subscription found")
            
        if sub.plan == PlanType.FREE:
            # Check usage for current month
            now = datetime.utcnow()
            first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            usage_count = db.query(UsageLog).filter(
                UsageLog.user_id == user_id,
                UsageLog.created_at >= first_day
            ).count()
            
            if usage_count >= LimitChecker.FREE_LIMIT:
                raise HTTPException(status_code=402, detail="Free tier limit reached. Please upgrade to Pro.")
                
        # Log usage
        usage = UsageLog(user_id=user_id, endpoint=endpoint, tokens_used=tokens)
        db.add(usage)
        db.commit()
