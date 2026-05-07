"""add jira sync history

Revision ID: 7a8b9c0d1e2f
Revises: 2f4a6b8c9d10
Create Date: 2026-05-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7a8b9c0d1e2f"
down_revision: Union[str, None] = "2f4a6b8c9d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "jira_sync_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("jira_connection_id", sa.Integer(), nullable=False),
        sa.Column("story_issue_key", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=True),
        sa.Column("project_key", sa.String(), nullable=True),
        sa.Column("operation", sa.String(), nullable=False, server_default="xray_publish"),
        sa.Column("status", sa.String(), nullable=False, server_default="success"),
        sa.Column("created_test_keys", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("updated_test_keys", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("warnings", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("request_payload", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("response_payload", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("error_detail", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.ForeignKeyConstraint(["jira_connection_id"], ["jira_connections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_jira_sync_history_id"), "jira_sync_history", ["id"], unique=False)
    op.create_index(op.f("ix_jira_sync_history_user_id"), "jira_sync_history", ["user_id"], unique=False)
    op.create_index(op.f("ix_jira_sync_history_jira_connection_id"), "jira_sync_history", ["jira_connection_id"], unique=False)
    op.create_index(op.f("ix_jira_sync_history_story_issue_key"), "jira_sync_history", ["story_issue_key"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_jira_sync_history_story_issue_key"), table_name="jira_sync_history")
    op.drop_index(op.f("ix_jira_sync_history_jira_connection_id"), table_name="jira_sync_history")
    op.drop_index(op.f("ix_jira_sync_history_user_id"), table_name="jira_sync_history")
    op.drop_index(op.f("ix_jira_sync_history_id"), table_name="jira_sync_history")
    op.drop_table("jira_sync_history")
