"""enable rls for new supabase tables

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-20 20:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES = (
    "refresh_sessions",
    "audit_logs",
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
        op.execute(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY')

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

    for table_name in TABLES:
        op.execute(f'ALTER TABLE "{table_name}" DISABLE ROW LEVEL SECURITY')
