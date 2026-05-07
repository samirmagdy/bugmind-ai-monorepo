"""add field defaults to jira field mappings

Revision ID: f9a1b2c3d4e5
Revises: e5f6a7b8c9d0
Create Date: 2026-04-20 18:25:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f9a1b2c3d4e5"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jira_field_mappings", sa.Column("field_defaults", sa.JSON(), nullable=True))
    op.execute("UPDATE jira_field_mappings SET field_defaults = '{}' WHERE field_defaults IS NULL")
    with op.batch_alter_table("jira_field_mappings") as batch_op:
        batch_op.alter_column("field_defaults", existing_type=sa.JSON(), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("jira_field_mappings") as batch_op:
        batch_op.drop_column("field_defaults")
