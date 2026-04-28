FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# build-essential nur fuer Wheels-ohne-Wheels noetig — sollte mit den
# aktuell gepinnten Versionen nicht mehr gebraucht werden, aber sicherheits-
# halber drin lassen. curl fuer den Healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root-User fuer Defense-in-Depth — bei einer RCE im Worker hat der
# Angreifer kein root im Container.
RUN groupadd --system app && useradd --system --gid app --no-create-home app \
    && chown -R app:app /app
USER app

EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:4100/api/v1/health || exit 1

# Migrations beim Start, dann uvicorn auf Port 4100 (passt zum Cluster-Plan).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 4100 --workers 4"]
