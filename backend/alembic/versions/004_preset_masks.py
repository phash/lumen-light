"""preset masks column

Erweitert presets um eine masks-JSONB-Spalte fuer lokale Anpassungen
(linear + radial). Default ist `[]` — bestehende Presets sind damit
vorwaertskompatibel ohne Inhalt.

Revision ID: 004_preset_masks
Revises: 003_images
Create Date: 2026-04-27 22:30:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "004_preset_masks"
down_revision = "003_images"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "presets",
        sa.Column(
            "masks",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("presets", "masks")
