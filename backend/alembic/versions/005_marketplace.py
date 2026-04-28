"""marketplace columns

Erweitert presets um die Marketplace-Felder (visibility/genre/
description/preview_image_id/published_at/apply_count/report_count),
ergaenzt users um handle/bio fuer Profil-Anzeige und legt die neue
preset_reports-Tabelle an.

Revision ID: 005_marketplace
Revises: 004_preset_masks
Create Date: 2026-04-28 13:35:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "005_marketplace"
down_revision = "004_preset_masks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Presets: Marketplace-Felder
    op.add_column(
        "presets",
        sa.Column(
            "visibility",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'private'"),
        ),
    )
    op.create_check_constraint(
        "ck_presets_visibility",
        "presets",
        "visibility IN ('private','public')",
    )
    op.add_column("presets", sa.Column("genre", sa.String(40), nullable=True))
    op.add_column("presets", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "presets",
        sa.Column(
            "preview_image_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("images.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "presets",
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "presets",
        sa.Column(
            "apply_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "presets",
        sa.Column(
            "report_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    # Marketplace-Listen filtern fast immer auf visibility='public' und
    # sortieren nach genre + published_at — partial Index spart Speicher.
    op.create_index(
        "ix_presets_marketplace",
        "presets",
        ["visibility", "genre", "published_at"],
        postgresql_where=sa.text("visibility = 'public'"),
    )

    # Users: optionales Handle (sichtbar im Marketplace) + Bio
    op.add_column("users", sa.Column("handle", sa.String(40), nullable=True))
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_users_handle", "users", ["handle"])

    # Reports: ein Eintrag pro reporter+preset, Auto-Hide bei >= 3.
    op.create_table(
        "preset_reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "preset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("presets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "preset_id",
            "reporter_user_id",
            name="uq_preset_reports_user_preset",
        ),
    )


def downgrade() -> None:
    op.drop_table("preset_reports")
    op.drop_constraint("uq_users_handle", "users", type_="unique")
    op.drop_column("users", "bio")
    op.drop_column("users", "handle")
    op.drop_index("ix_presets_marketplace", table_name="presets")
    op.drop_column("presets", "report_count")
    op.drop_column("presets", "apply_count")
    op.drop_column("presets", "published_at")
    op.drop_column("presets", "preview_image_id")
    op.drop_column("presets", "description")
    op.drop_column("presets", "genre")
    op.drop_constraint("ck_presets_visibility", "presets", type_="check")
    op.drop_column("presets", "visibility")
