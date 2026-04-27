# Lumen · light — Konzept-Paket

Browser-basierter, self-hosted RAW-Entwickler als Lightroom-Alternative.

## Inhalt dieses Pakets

```
lumen-light/
├── README.md                     ← diese Datei
├── docs/
│   ├── 01-konzept.md             ← Vision, Scope, Zielgruppe, MVP
│   ├── 02-architektur.md         ← Systemarchitektur, Datenflüsse
│   ├── 03-datenmodell.md         ← DB-Schema, Pydantic, Adjustment-Schema
│   ├── 04-api-spezifikation.md   ← REST-Endpoints, Auth-Flow
│   ├── 05-frontend-konzept.md    ← Component-Tree, State, WebGL-Pipeline
│   ├── 06-roadmap.md             ← 16-Wochen-Plan in Phasen
│   ├── 07-tech-entscheidungen.md ← ADRs (Architecture Decision Records)
│   └── 08-risiken-offene-fragen.md
├── diagramme/
│   └── architektur.mmd           ← Mermaid-Diagramm der Systemarchitektur
├── frontend/
│   └── lightroom-light.jsx       ← lauffähiger React-Prototyp (WebGL2)
├── backend/
│   ├── app/
│   │   ├── main.py               ← FastAPI-App
│   │   ├── config.py             ← Settings (Pydantic)
│   │   ├── database.py           ← SQLAlchemy-Setup
│   │   ├── models.py             ← ORM-Modelle
│   │   ├── schemas.py            ← Pydantic-Schemas
│   │   ├── auth.py               ← JWT-Logik
│   │   └── routers/
│   │       ├── auth.py           ← /auth/register, /auth/login
│   │       └── presets.py        ← /presets CRUD
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/001_initial.py
│   ├── alembic.ini
│   ├── requirements.txt
│   └── Dockerfile
└── deployment/
    ├── docker-compose.yml        ← Postgres + Backend + Nginx
    ├── nginx.conf
    └── .env.example
```

## Schnellstart (lokale Entwicklung)

```bash
# Backend hochfahren
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://lumen:lumen@localhost:5432/lumen
export JWT_SECRET=dev-secret-bitte-ersetzen
alembic upgrade head
uvicorn app.main:app --reload

# Frontend (im neuen Vite-Projekt)
npm create vite@latest lumen-frontend -- --template react
cd lumen-frontend
npm install
# lightroom-light.jsx als App.jsx einsetzen, dann:
npm run dev
```

## Schnellstart (Docker)

```bash
cd deployment
cp .env.example .env
docker compose up -d
# Backend auf http://localhost:8000
# OpenAPI-Docs auf http://localhost:8000/docs
```

## Reihenfolge zum Lesen

1. `docs/01-konzept.md` — was bauen wir und warum
2. `docs/02-architektur.md` — wie ist es zusammengesetzt
3. `docs/06-roadmap.md` — in welcher Reihenfolge
4. Rest nach Bedarf

## Lizenz / Nutzung

Persönliches Konzept-Paket. Frei verwendbar und anpassbar.
