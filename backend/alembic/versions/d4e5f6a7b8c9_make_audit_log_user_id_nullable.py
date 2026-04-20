"""make audit log user_id nullable

Revision ID: d4e5f6a7b8c9
Revises: a7b8c9d0e1f2
Create Date: 2026-04-20 20:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.alter_column("user_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.alter_column("user_id", existing_type=sa.Integer(), nullable=False)
