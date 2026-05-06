"""Scope Jira field mappings by connection

Revision ID: 2f4a6b8c9d10
Revises: 136faf609b35
Create Date: 2026-05-06 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2f4a6b8c9d10"
down_revision: Union[str, None] = "136faf609b35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("jira_field_mappings") as batch_op:
        batch_op.add_column(sa.Column("jira_connection_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            "ix_jira_field_mappings_jira_connection_id",
            ["jira_connection_id"],
        )
        batch_op.create_foreign_key(
            "fk_jira_field_mappings_jira_connection_id",
            "jira_connections",
            ["jira_connection_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("jira_field_mappings") as batch_op:
        batch_op.drop_constraint(
            "fk_jira_field_mappings_jira_connection_id",
            type_="foreignkey",
        )
        batch_op.drop_index("ix_jira_field_mappings_jira_connection_id")
        batch_op.drop_column("jira_connection_id")
