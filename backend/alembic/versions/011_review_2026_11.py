"""Review 2026-11: Marketplace-Vorschau, Apply-Dedupe, Purge-Verzoegerung

- presets.preview_key: serverseitig erzeugtes, metadatenfreies Vorschau-JPEG
  (<uid>/previews/<preset_id>.jpg). Der Marketplace liefert nur noch diesen
  Key aus, nie das Original. Bestehende oeffentliche Presets haben NULL ->
  previewUrl null, bis `python -m scripts.backfill_previews` gelaufen ist.
- preset_applies: ein Apply-Zaehler-Eintrag pro (user, preset, Tag) —
  apply_count zaehlt nur noch den ersten Apply pro Tag und User.
- storage_purges.not_before: DELETE /me merkt den User-Prefix IMMER vor,
  frueheste Ausfuehrung erst nach Ablauf der Pre-Signed-POST-Gueltigkeit
  (spaete Staging-Uploads werden so mit erfasst).

Alles additiv, keine Daten-Migration.

Revision ID: 011_review_2026_11
Revises: 010_purges_tombstones
Create Date: 2026-11-09 12:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "011_review_2026_11"
down_revision = "010_purges_tombstones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("presets", sa.Column("preview_key", sa.Text(), nullable=True))
    op.create_table(
        "preset_applies",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "preset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("presets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "preset_id", "day", name="pk_preset_applies"),
    )
    op.add_column(
        "storage_purges",
        sa.Column(
            "not_before",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_column("storage_purges", "not_before")
    op.drop_table("preset_applies")
    op.drop_column("presets", "preview_key")
