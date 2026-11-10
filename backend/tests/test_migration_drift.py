"""Alembic-Head == ORM-Modelle: keine Schema-Drift zwischen Migrationen und
app/models.py (sonst schlaegt z.B. ein ON CONFLICT auf eine fehlende
Constraint erst in Production fehl)."""
from __future__ import annotations

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from app.database import Base
import app.models  # noqa: F401 — registriert alle Tabellen an Base.metadata


# Bekannte, vor Review 2026-11 entstandene Abweichungen (nur Index-/
# Constraint-Spiegelung im Modell, Schema selbst ist per Migration korrekt).
# Neue Drift faellt weiterhin auf.
_KNOWN_LEGACY = {
    "idx_presets_adjustments",
    "ix_presets_marketplace",
    "uq_users_keycloak_sub",
    "ix_users_keycloak_sub",
}


def _is_known(entry: tuple) -> bool:
    kind, obj = entry[0], entry[1]
    name = getattr(obj, "name", None)
    if name in _KNOWN_LEGACY:
        return True
    # users.email-Unique (Migration 001) ist im Modell nicht gespiegelt.
    if kind == "remove_constraint" and getattr(obj, "table", None) is not None:
        cols = [c.name for c in getattr(obj, "columns", [])]
        return obj.table.name == "users" and cols == ["email"]
    return False


async def test_migrationen_entsprechen_den_modellen(engine):
    def _diff(sync_conn):
        ctx = MigrationContext.configure(
            sync_conn, opts={"compare_type": True, "compare_server_default": False}
        )
        return compare_metadata(ctx, Base.metadata)

    async with engine.connect() as conn:
        diff = await conn.run_sync(_diff)
    diff = [d for d in diff if not (isinstance(d, tuple) and _is_known(d))]
    assert diff == [], f"Schema-Drift zwischen Alembic und Modellen: {diff}"
