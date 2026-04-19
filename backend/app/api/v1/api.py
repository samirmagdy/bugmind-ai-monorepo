from fastapi import APIRouter
from app.api.v1 import auth, stripe, jira, ai, settings

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(stripe.router, prefix="/stripe", tags=["stripe"])
api_router.include_router(jira.router, prefix="/jira", tags=["jira"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
