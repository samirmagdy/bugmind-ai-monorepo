"""Add is_shared to jira_field_mappings

Revision ID: 136faf609b35
Revises: 6ec5c316e8e2
Create Date: 2026-05-05 22:10:07.990518

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '136faf609b35'
down_revision: Union[str, None] = '6ec5c316e8e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('jira_field_mappings', sa.Column('is_shared', sa.Boolean(), nullable=True))
    # Initialize existing rows with False
    op.execute("UPDATE jira_field_mappings SET is_shared = FALSE")
    # Make it non-nullable if desired, but for now nullable=True is safer for existing data
    # op.alter_column('jira_field_mappings', 'is_shared', nullable=False)


def downgrade() -> None:
    op.drop_column('jira_field_mappings', 'is_shared')
