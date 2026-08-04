from app.api.agents import router as agents_router
from app.api.auth import router as auth_router
from app.api.claude_usage import router as claude_usage_router
from app.api.gemini_usage import router as gemini_usage_router
from app.api.quota import router as quota_router
from app.api.tasks import router as tasks_router
from app.api.users import router as users_router
from app.api.workflows import router as workflows_router
from app.api.fs import router as fs_router

ROUTERS = [
    auth_router,
    agents_router,
    tasks_router,
    quota_router,
    claude_usage_router,
    gemini_usage_router,
    workflows_router,
    users_router,
    fs_router,
]

__all__ = ["ROUTERS"]
