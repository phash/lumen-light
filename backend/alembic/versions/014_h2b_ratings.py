"""H2b: Bewertung, Farblabel und Markierung pro Bild (Lighttable)

- images.rating: 0..5 Sterne, Default 0 (= unbewertet)
- images.color_label: red/yellow/green/blue/purple oder NULL (kein Label)
- images.flag: none/pick/reject, Default 'none'
- Index (user_id, rating) fuer den minRating-Filter / rating_desc-Sortierung

Rein additiv mit Server-Defaults: Bestandszeilen bekommen 0/NULL/'none'.
Downgrade verwirft Spalten, Constraints und Index.

Revision ID: 014_h2b_ratings
Revises: 013_h2a_thumbnails
Create Date: 2026-11-11 18:00:00

"""
from alembic import op
import sqlalchemy as sa


revision = "014_h2b_ratings"
down_revision = "013_h2a_thumbnails"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "images",
        sa.Column("rating", sa.SmallInteger(), nullable=False, server_default="0"),
    )
    op.add_column("images", sa.Column("color_label", sa.Text(), nullable=True))
    op.add_column(
        "images",
        sa.Column("flag", sa.Text(), nullable=False, server_default="none"),
    )
    op.create_check_constraint(
        "ck_images_rating", "images", "rating BETWEEN 0 AND 5"
    )
    op.create_check_constraint(
        "ck_images_color_label",
        "images",
        "color_label IN ('red','yellow','green','blue','purple')",
    )
    op.create_check_constraint(
        "ck_images_flag", "images", "flag IN ('none','pick','reject')"
    )
    op.create_index("ix_images_user_rating", "images", ["user_id", "rating"])


def downgrade() -> None:
    op.drop_index("ix_images_user_rating", table_name="images")
    op.drop_constraint("ck_images_flag", "images", type_="check")
    op.drop_constraint("ck_images_color_label", "images", type_="check")
    op.drop_constraint("ck_images_rating", "images", type_="check")
    op.drop_column("images", "flag")
    op.drop_column("images", "color_label")
    op.drop_column("images", "rating")
