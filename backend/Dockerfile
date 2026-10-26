FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Nur curl (Healthcheck). Kein build-essential: alle gepinnten Pakete
# kommen als manylinux-Wheels, ein Compiler im Runtime-Image waere nur
# zusaetzliche Angriffsflaeche.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
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

# Proxy-Header: uvicorn uebernimmt X-Forwarded-For/-Proto nur von IPs aus
# FORWARDED_ALLOW_IPS. Ohne passenden Wert ist request.client.host fuer alle
# Requests die Caddy-Container-IP -> der IP-Bucket des Rate-Limits waere
# global geteilt. Default 127.0.0.1 (nichts vertrauen ausser localhost).
# Production setzt das Subnetz des caddy-proxy-Docker-Netzes (z.B.
# "172.18.0.0/16") oder "*", wenn die API ausschliesslich ueber Caddy
# erreichbar ist (kein veroeffentlichter Port) — sonst koennte jeder
# Client seine IP per X-Forwarded-For faelschen.
ENV FORWARDED_ALLOW_IPS=127.0.0.1

# Migrations beim Start, dann uvicorn auf Port 4100 (passt zum Cluster-Plan).
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 4100 --workers 4 --proxy-headers --forwarded-allow-ips \"$FORWARDED_ALLOW_IPS\""]
