"""image_edits-Tabelle (C1: persistierter Bearbeitungsstand pro Bild)

Multi-Device-Weiterbearbeitung: ein Edit-State (adjustments + masks +
Geometrie) pro Bild als JSONB. PK = image_id (genau ein State pro Bild),
Cascade-Delete mit dem Bild. Additiv, keine Daten-Migration noetig.

Revision ID: 008_image_edits
Revises: 007_admin_feedback
Create Date: 2026-05-29 12:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "008_image_edits"
down_revision = "007_admin_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_edits",
        sa.Column(
            "image_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("images.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("state", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("image_edits")
