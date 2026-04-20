"""Enable RLS on public tables for Supabase

Revision ID: b6f9b7d2c1aa
Revises: 4b7d0f6e2c11
Create Date: 2026-04-20 14:55:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b6f9b7d2c1aa"
down_revision: Union[str, None] = "4b7d0f6e2c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES = (
    "alembic_version",
    "subscriptions",
    "usage_logs",
    "bug_generations",
    "users",
    "jira_connections",
    "jira_field_mappings",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table_name in TABLES:
        op.execute(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table_name in TABLES:
        op.execute(f'ALTER TABLE "{table_name}" DISABLE ROW LEVEL SECURITY')
