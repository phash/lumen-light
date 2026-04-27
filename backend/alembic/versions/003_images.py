"""images table

Revision ID: 003_images
Revises: 002_keycloak
Create Date: 2026-04-27 13:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "003_images"
down_revision = "002_keycloak"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "images",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("bucket_key", sa.Text(), nullable=False, unique=True),
        sa.Column("original_filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("upload_state", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "upload_state IN ('pending','ready','failed')",
            name="ck_images_upload_state",
        ),
    )
    op.create_index("idx_images_user_id", "images", ["user_id"])
    op.create_index("idx_images_state", "images", ["upload_state"])


def downgrade() -> None:
    op.drop_index("idx_images_state", table_name="images")
    op.drop_index("idx_images_user_id", table_name="images")
    op.drop_table("images")
