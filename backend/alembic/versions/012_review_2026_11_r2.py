"""Review 2026-11 r2: KC-Loesch-Retry, Publish-Sperre, Apply-Index

- keycloak_deletions: ausstehende Keycloak-Account-Loeschungen aus
  DELETE /me. Wird in derselben Transaktion wie der Grabstein geschrieben;
  der Janitor wiederholt fehlgeschlagene Admin-API-Calls mit Backoff und
  loescht die Row bei 204/404. Speichert die Keycloak-User-ID (sub) im
  Klartext — noetig, um den Account loeschen zu koennen; die Row
  verschwindet mit der erfolgreichen Loeschung.
- users.publish_blocked_until: Veroeffentlichungs-Sperre nach Auto-Hide
  eines eigenen Presets (ersetzt die abgeleitete Pruefung, die sich per
  Loeschen/Umbenennen des versteckten Presets umgehen liess).
- ix_preset_applies_preset_id: FK-Index (Cascade-Delete von Presets,
  Retention-Prune).

Additiv. Einzige Daten-Migration: User mit bereits auto-versteckten
Presets (private + report_count >= 3) bekommen die Sperre ab jetzt fuer
30 Tage, damit das bisherige Verhalten (abgeleitete Sperre) nicht mit dem
Upgrade wegfaellt. Downgrade verwirft die Spalte samt Werten.

Revision ID: 012_review_2026_11_r2
Revises: 011_review_2026_11
Create Date: 2026-11-10 12:00:00

"""
from alembic import op
import sqlalchemy as sa


revision = "012_review_2026_11_r2"
down_revision = "011_review_2026_11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "keycloak_deletions",
        sa.Column("keycloak_sub", sa.String(255), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column(
        "users",
        sa.Column("publish_blocked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_preset_applies_preset_id", "preset_applies", ["preset_id"])
    op.execute(
        """
        UPDATE users SET publish_blocked_until = now() + interval '30 days'
        WHERE id IN (
            SELECT user_id FROM presets
            WHERE visibility = 'private' AND report_count >= 3
        )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_preset_applies_preset_id", table_name="preset_applies")
    op.drop_column("users", "publish_blocked_until")
    op.drop_table("keycloak_deletions")
