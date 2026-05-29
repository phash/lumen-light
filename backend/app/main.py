"""FastAPI-Anwendung — Einstiegspunkt."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.database import engine
from app.rate_limit import limiter
from app.routers import admin, auth, feedback, images, marketplace, presets


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


_is_production = settings.env.lower() == "production"

app = FastAPI(
    title="Lumen · light API",
    version="0.1.0",
    description="Backend für den browser-basierten RAW-Entwickler.",
    lifespan=lifespan,
    # Production: keine Schema-Disclosure via /docs, /redoc, /openapi.json.
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# SlowAPIMiddleware aktiviert die `default_limits` aus rate_limit.py auf
# ALLEN Routen (auch GET) — ohne sie greifen nur die @limiter.limit-
# Dekoratoren. Bei LUMEN_RATELIMIT_DISABLED=1 ist der Limiter aus -> No-Op.
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    # Eingeschraenkt statt "*" — vermeidet, dass kuenftige Methoden
    # (z.B. CONNECT) ungewollt erlaubt sind.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(presets.router, prefix="/api/v1/presets", tags=["presets"])
app.include_router(images.router, prefix="/api/v1/images", tags=["images"])
app.include_router(
    marketplace.router, prefix="/api/v1/marketplace", tags=["marketplace"]
)
app.include_router(feedback.router, prefix="/api/v1/feedback", tags=["feedback"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])


@app.get("/api/v1/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
