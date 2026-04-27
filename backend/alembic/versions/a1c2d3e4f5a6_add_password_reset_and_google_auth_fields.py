"""add password reset and google auth fields

Revision ID: a1c2d3e4f5a6
Revises: f9a1b2c3d4e5
Create Date: 2026-04-27 18:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "a1c2d3e4f5a6"
down_revision: Union[str, None] = "f9a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ROLES = ("anon", "authenticated")


def _policy_name(table_name: str, role_name: str) -> str:
    return f"{table_name}_{role_name}_deny_all"


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("hashed_password", existing_type=sa.String(), nullable=True)
        batch_op.add_column(sa.Column("google_subject", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index("ix_users_google_subject", ["google_subject"], unique=True)

    op.create_table(
        "password_reset_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_password_reset_codes_id"), "password_reset_codes", ["id"], unique=False)
    op.create_index(op.f("ix_password_reset_codes_user_id"), "password_reset_codes", ["user_id"], unique=False)
    op.create_index(op.f("ix_password_reset_codes_email"), "password_reset_codes", ["email"], unique=False)
    op.create_index(op.f("ix_password_reset_codes_code_hash"), "password_reset_codes", ["code_hash"], unique=False)

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    roles_check = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")).fetchall()
    if not roles_check:
        return
    op.execute('ALTER TABLE "password_reset_codes" ENABLE ROW LEVEL SECURITY')
    for role_name in ROLES:
        op.execute(
            f'''
            CREATE POLICY "{_policy_name("password_reset_codes", role_name)}"
            ON "password_reset_codes"
            AS RESTRICTIVE
            FOR ALL
            TO {role_name}
            USING (false)
            WITH CHECK (false)
            '''
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        roles_check = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")).fetchall()
        if roles_check:
            for role_name in ROLES:
                op.execute(f'DROP POLICY IF EXISTS "{_policy_name("password_reset_codes", role_name)}" ON "password_reset_codes"')
            op.execute('ALTER TABLE "password_reset_codes" DISABLE ROW LEVEL SECURITY')

    op.drop_index(op.f("ix_password_reset_codes_code_hash"), table_name="password_reset_codes")
    op.drop_index(op.f("ix_password_reset_codes_email"), table_name="password_reset_codes")
    op.drop_index(op.f("ix_password_reset_codes_user_id"), table_name="password_reset_codes")
    op.drop_index(op.f("ix_password_reset_codes_id"), table_name="password_reset_codes")
    op.drop_table("password_reset_codes")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_index("ix_users_google_subject")
        batch_op.drop_column("email_verified_at")
        batch_op.drop_column("google_subject")
        batch_op.alter_column("hashed_password", existing_type=sa.String(), nullable=False)
