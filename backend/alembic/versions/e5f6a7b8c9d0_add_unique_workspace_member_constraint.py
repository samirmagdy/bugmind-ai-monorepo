"""Add unique workspace member constraint

Revision ID: e5f6a7b8c9d0
Revises: b3c4d5e6f7a8
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("workspace_members") as batch_op:
        batch_op.create_unique_constraint("uq_workspace_member", ["workspace_id", "user_id"])


def downgrade() -> None:
    with op.batch_alter_table("workspace_members") as batch_op:
        batch_op.drop_constraint("uq_workspace_member", type_="unique")
