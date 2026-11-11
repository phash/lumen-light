"""H2a: Vorschaubilder pro Bild (Lighttable)

- images.thumb_key: <uid>/thumbs/<image_id>-<hex>-400.jpg (Liste/Kachel)
- images.preview_key: <uid>/thumbs/<image_id>-<hex>-1600.jpg (Lupe, H2c)

Beide nullable: Bestandsbilder haben noch keine Vorschau (thumbUrl/previewUrl
null), bis der Browser eine hochlaedt oder scripts.backfill_thumbnails sie
fuer JPEG/PNG/TIFF erzeugt. Rein additiv; Downgrade verwirft die Spalten
(die S3-Objekte bleiben liegen und verschwinden spaetestens mit dem
Prefix-Purge aus DELETE /me).

Revision ID: 013_h2a_thumbnails
Revises: 012_review_2026_11_r2
Create Date: 2026-11-11 12:00:00

"""
from alembic import op
import sqlalchemy as sa


revision = "013_h2a_thumbnails"
down_revision = "012_review_2026_11_r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("images", sa.Column("thumb_key", sa.Text(), nullable=True))
    op.add_column("images", sa.Column("preview_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("images", "preview_key")
    op.drop_column("images", "thumb_key")
