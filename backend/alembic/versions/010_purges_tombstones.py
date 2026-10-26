"""storage_purges + account_tombstones (Security-Review 2026-10)

- storage_purges: S3-Prefixe, deren Purge bei DELETE /me fehlschlug; der
  Janitor wiederholt sie.
- account_tombstones: SHA-256(sub) + deleted_at geloeschter Accounts; blockt
  die JIT-Wiederbelebung durch noch gueltige Tokens.

Beide additiv, keine Daten-Migration.

Revision ID: 010_purges_tombstones
Revises: 009_preset_geometry
Create Date: 2026-10-26 12:00:00

"""
from alembic import op
import sqlalchemy as sa


revision = "010_purges_tombstones"
down_revision = "009_preset_geometry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "storage_purges",
        sa.Column("prefix", sa.Text(), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "account_tombstones",
        sa.Column("sub_hash", sa.String(64), primary_key=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("account_tombstones")
    op.drop_table("storage_purges")
