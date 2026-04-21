"""Add deny-all RLS policies for Supabase-exposed tables

Revision ID: c2d4e8f1a9bb
Revises: b6f9b7d2c1aa
Create Date: 2026-04-20 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c2d4e8f1a9bb"
down_revision: Union[str, None] = "b6f9b7d2c1aa"
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

ROLES = ("anon", "authenticated")


def _policy_name(table_name: str, role_name: str) -> str:
    return f"{table_name}_{role_name}_deny_all"


from sqlalchemy import text

def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    
    # Only run on Supabase instances (checked by presence of specific roles)
    roles_check = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")).fetchall()
    if not roles_check:
        return

    for table_name in TABLES:
        for role_name in ROLES:
            policy_name = _policy_name(table_name, role_name)
            op.execute(
                f'''
                CREATE POLICY "{policy_name}"
                ON "{table_name}"
                AS RESTRICTIVE
                FOR ALL
                TO {role_name}
                USING (false)
                WITH CHECK (false)
                '''
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    
    # Only run on Supabase instances (checked by presence of specific roles)
    roles_check = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")).fetchall()
    if not roles_check:
        return

    for table_name in TABLES:
        for role_name in ROLES:
            policy_name = _policy_name(table_name, role_name)
            op.execute(f'DROP POLICY IF EXISTS "{policy_name}" ON "{table_name}"')
