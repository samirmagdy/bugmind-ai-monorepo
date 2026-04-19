"""Add Jira connection and field mapping settings

Revision ID: 4b7d0f6e2c11
Revises: 0e8f9c3c6b2a
Create Date: 2026-04-19 14:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4b7d0f6e2c11'
down_revision: Union[str, None] = '0e8f9c3c6b2a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('jira_connections', sa.Column('verify_ssl', sa.Boolean(), nullable=True))
    op.execute("UPDATE jira_connections SET verify_ssl = 1 WHERE verify_ssl IS NULL")
    with op.batch_alter_table('jira_connections') as batch_op:
        batch_op.alter_column('verify_ssl', existing_type=sa.Boolean(), nullable=False)

    op.add_column('jira_field_mappings', sa.Column('project_id', sa.String(), nullable=True))
    op.add_column('jira_field_mappings', sa.Column('visible_fields', sa.JSON(), nullable=True))
    op.execute("UPDATE jira_field_mappings SET visible_fields = '[]' WHERE visible_fields IS NULL")
    with op.batch_alter_table('jira_field_mappings') as batch_op:
        batch_op.alter_column('visible_fields', existing_type=sa.JSON(), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table('jira_field_mappings') as batch_op:
        batch_op.drop_column('visible_fields')
        batch_op.drop_column('project_id')

    with op.batch_alter_table('jira_connections') as batch_op:
        batch_op.drop_column('verify_ssl')
