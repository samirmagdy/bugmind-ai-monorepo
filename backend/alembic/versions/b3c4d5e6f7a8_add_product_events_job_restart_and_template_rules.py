"""Add product events, job restart metadata, and template rules

Revision ID: b3c4d5e6f7a8
Revises: 7a8b9c0d1e2f
Create Date: 2026-05-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, None] = "7a8b9c0d1e2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(sa.Column("request_payload", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("retry_of_job_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("resume_of_job_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("retry_count", sa.Integer(), nullable=True, server_default="0"))
        batch_op.create_index(batch_op.f("ix_jobs_retry_of_job_id"), ["retry_of_job_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_jobs_resume_of_job_id"), ["resume_of_job_id"], unique=False)
        batch_op.create_foreign_key("fk_jobs_retry_of_job_id", "jobs", ["retry_of_job_id"], ["id"], ondelete="SET NULL")
        batch_op.create_foreign_key("fk_jobs_resume_of_job_id", "jobs", ["resume_of_job_id"], ["id"], ondelete="SET NULL")

    op.create_table(
        "workspace_template_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("template_id", sa.Integer(), nullable=False),
        sa.Column("project_key", sa.String(), nullable=True),
        sa.Column("issue_type_id", sa.String(), nullable=True),
        sa.Column("workflow", sa.String(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["template_id"], ["workspace_templates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workspace_template_assignments_id"), "workspace_template_assignments", ["id"], unique=False)
    op.create_index(op.f("ix_workspace_template_assignments_workspace_id"), "workspace_template_assignments", ["workspace_id"], unique=False)
    op.create_index(op.f("ix_workspace_template_assignments_template_id"), "workspace_template_assignments", ["template_id"], unique=False)
    op.create_index(op.f("ix_workspace_template_assignments_project_key"), "workspace_template_assignments", ["project_key"], unique=False)
    op.create_index(op.f("ix_workspace_template_assignments_issue_type_id"), "workspace_template_assignments", ["issue_type_id"], unique=False)
    op.create_index(op.f("ix_workspace_template_assignments_workflow"), "workspace_template_assignments", ["workflow"], unique=False)

    op.create_table(
        "product_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False, server_default="sidepanel"),
        sa.Column("issue_key", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("detail", sa.String(), nullable=True),
        sa.Column("event_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_product_events_id"), "product_events", ["id"], unique=False)
    op.create_index(op.f("ix_product_events_user_id"), "product_events", ["user_id"], unique=False)
    op.create_index(op.f("ix_product_events_workspace_id"), "product_events", ["workspace_id"], unique=False)
    op.create_index(op.f("ix_product_events_event_type"), "product_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_product_events_source"), "product_events", ["source"], unique=False)
    op.create_index(op.f("ix_product_events_issue_key"), "product_events", ["issue_key"], unique=False)
    op.create_index(op.f("ix_product_events_created_at"), "product_events", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_product_events_created_at"), table_name="product_events")
    op.drop_index(op.f("ix_product_events_issue_key"), table_name="product_events")
    op.drop_index(op.f("ix_product_events_source"), table_name="product_events")
    op.drop_index(op.f("ix_product_events_event_type"), table_name="product_events")
    op.drop_index(op.f("ix_product_events_workspace_id"), table_name="product_events")
    op.drop_index(op.f("ix_product_events_user_id"), table_name="product_events")
    op.drop_index(op.f("ix_product_events_id"), table_name="product_events")
    op.drop_table("product_events")

    op.drop_index(op.f("ix_workspace_template_assignments_workflow"), table_name="workspace_template_assignments")
    op.drop_index(op.f("ix_workspace_template_assignments_issue_type_id"), table_name="workspace_template_assignments")
    op.drop_index(op.f("ix_workspace_template_assignments_project_key"), table_name="workspace_template_assignments")
    op.drop_index(op.f("ix_workspace_template_assignments_template_id"), table_name="workspace_template_assignments")
    op.drop_index(op.f("ix_workspace_template_assignments_workspace_id"), table_name="workspace_template_assignments")
    op.drop_index(op.f("ix_workspace_template_assignments_id"), table_name="workspace_template_assignments")
    op.drop_table("workspace_template_assignments")

    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_constraint("fk_jobs_resume_of_job_id", type_="foreignkey")
        batch_op.drop_constraint("fk_jobs_retry_of_job_id", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_jobs_resume_of_job_id"))
        batch_op.drop_index(batch_op.f("ix_jobs_retry_of_job_id"))
        batch_op.drop_column("retry_count")
        batch_op.drop_column("resume_of_job_id")
        batch_op.drop_column("retry_of_job_id")
        batch_op.drop_column("request_payload")
