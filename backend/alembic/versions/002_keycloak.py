"""keycloak schema

Setzt das Schema von eigenem JWT-Auth (ADR-004 obsolet) auf Keycloak-basierte
Verifikation um (ADR-010): users.password_hash -> users.keycloak_sub,
refresh_tokens-Tabelle entfaellt.

Revision ID: 002_keycloak
Revises: 001_initial
Create Date: 2026-04-27 12:30:00

"""
from alembic import op
import sqlalchemy as sa


revision = "002_keycloak"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # users: password_hash entfernen, keycloak_sub aufnehmen
    op.add_column(
        "users",
        sa.Column("keycloak_sub", sa.String(length=255), nullable=True),
    )
    # Hypothetische bestehende Daten: id als sub-Platzhalter — fuer leere
    # DB ein No-op, fuer reale Daten ist das ein klarer Marker.
    op.execute("UPDATE users SET keycloak_sub = id::text WHERE keycloak_sub IS NULL")
    op.alter_column("users", "keycloak_sub", nullable=False)
    op.create_index("uq_users_keycloak_sub", "users", ["keycloak_sub"], unique=True)
    op.drop_column("users", "password_hash")

    # refresh_tokens komplett entfernen
    op.drop_index("idx_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_index("idx_refresh_tokens_token_hash", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")


def downgrade() -> None:
    # refresh_tokens wiederherstellen
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("idx_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"])

    # users: password_hash wieder rein, keycloak_sub raus
    op.add_column(
        "users",
        sa.Column("password_hash", sa.String(length=255), nullable=False, server_default=""),
    )
    op.alter_column("users", "password_hash", server_default=None)
    op.drop_index("uq_users_keycloak_sub", table_name="users")
    op.drop_column("users", "keycloak_sub")
