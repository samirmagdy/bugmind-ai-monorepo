"""Add AI settings columns to users

Revision ID: 0e8f9c3c6b2a
Revises: 9c6eb3842284
Create Date: 2026-04-19 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0e8f9c3c6b2a'
down_revision: Union[str, None] = '9c6eb3842284'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('custom_ai_model', sa.String(), nullable=True))
    op.add_column('users', sa.Column('encrypted_ai_api_key', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'encrypted_ai_api_key')
    op.drop_column('users', 'custom_ai_model')
