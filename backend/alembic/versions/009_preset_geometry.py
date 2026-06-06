"""presets.geometry-Spalte (Crop/Straighten/Lens fuer Bearbeitungs-Profile)

Additiv, nullable -> keine Daten-Migration noetig. Bestehende Presets
haben geometry=NULL (= keine Geometrie).

Revision ID: 009_preset_geometry
Revises: 008_image_edits
Create Date: 2026-06-05 12:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "009_preset_geometry"
down_revision = "008_image_edits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "presets",
        sa.Column("geometry", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("presets", "geometry")
