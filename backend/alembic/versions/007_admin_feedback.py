"""users.is_disabled + feedbacks-Tabelle

Admin-MVP: User-Disable-Toggle (App-seitig, blockiert /auth/me) und
Feedback-Mailbox fuer User-Bug-/Idea-/Other-Reports. Keine
Daten-Migration noetig — beide Aenderungen sind additive.

Revision ID: 007_admin_feedback
Revises: 006_preset_reports_set_null
Create Date: 2026-04-29 12:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "007_admin_feedback"
down_revision = "006_preset_reports_set_null"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) users.is_disabled — App-Side-Lock, falls Admin missbrauchsverdaechtige
    #    Konten ohne Keycloak-Eingriff stoppen will. Default false, server_default
    #    fuer bestehende Rows.
    op.add_column(
        "users",
        sa.Column(
            "is_disabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # 2) feedbacks: id, user_id (nullable, SET NULL bei User-Delete),
    #    kind enum, message text, page text nullable, status enum,
    #    admin_notes text nullable, created_at, updated_at.
    op.create_table(
        "feedbacks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("page", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'new'"),
        ),
        sa.Column("admin_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('bug','idea','other')",
            name="ck_feedbacks_kind",
        ),
        sa.CheckConstraint(
            "status IN ('new','triaged','closed')",
            name="ck_feedbacks_status",
        ),
        sa.CheckConstraint(
            "char_length(message) BETWEEN 10 AND 2000",
            name="ck_feedbacks_message_length",
        ),
    )
    op.create_index(
        "ix_feedbacks_status_created",
        "feedbacks",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_feedbacks_status_created", table_name="feedbacks")
    op.drop_table("feedbacks")
    op.drop_column("users", "is_disabled")
