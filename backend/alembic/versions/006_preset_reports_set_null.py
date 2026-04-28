"""preset_reports.reporter_user_id ON DELETE SET NULL

DSGVO-Review-Finding: Bei `ON DELETE CASCADE` verschwinden Meldungen
mit dem Reporter, wenn dieser sein Account loescht — das laesst den
`report_count` schrumpfen und ein Auto-hidden Preset koennte unter
den Schwellenwert fallen, Moderationskontext geht verloren. Mit
`SET NULL` bleibt die Meldung bestehen, aber der Reporter wird
anonymisiert (Art. 17 erfuellt: keine Personenbezugsdaten mehr,
nur die Aussage ueber den gemeldeten Creator).

Revision ID: 006_preset_reports_set_null
Revises: 005_marketplace
Create Date: 2026-04-28 15:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "006_preset_reports_set_null"
down_revision = "005_marketplace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Spalte nullable machen, damit SET NULL ueberhaupt moeglich ist.
    op.alter_column(
        "preset_reports",
        "reporter_user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    # Constraint-Name folgt Default `preset_reports_reporter_user_id_fkey`.
    op.drop_constraint(
        "preset_reports_reporter_user_id_fkey",
        "preset_reports",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "preset_reports_reporter_user_id_fkey",
        "preset_reports",
        "users",
        ["reporter_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Achtung: bei downgrade muss es Werte geben, die NULL sind — die
    # waeren mit CASCADE zwangsweise zu loeschen. Wir streichen sie
    # einfach (akzeptables Datenverlust-Risiko fuer einen reverse).
    op.execute(
        "DELETE FROM preset_reports WHERE reporter_user_id IS NULL"
    )
    op.drop_constraint(
        "preset_reports_reporter_user_id_fkey",
        "preset_reports",
        type_="foreignkey",
    )
    op.alter_column(
        "preset_reports",
        "reporter_user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_foreign_key(
        "preset_reports_reporter_user_id_fkey",
        "preset_reports",
        "users",
        ["reporter_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
