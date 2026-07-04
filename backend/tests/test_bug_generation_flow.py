import os
from pathlib import Path
import sys
from types import SimpleNamespace

from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bug_generation_flow.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-bug-generation-flow")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")

import app.models  # noqa: E402,F401
from app.core.database import Base  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.jira import JiraAuthType, JiraConnection, JiraFieldMapping  # noqa: E402
from app.models.user import User  # noqa: E402
from app.api.v1.ai import _audit_ai_generation  # noqa: E402
from app.schemas.bug import FindingGenerationRequest, GeneratedFindingResponse, IssueContext, ManualBugGenerationResponse  # noqa: E402
from app.services.ai.audit_metadata import build_ai_generation_audit_metadata  # noqa: E402
from app.services.ai.workflows import _build_issue_fields, _get_field_mapping_record  # noqa: E402
from app.services.jira.field_resolver import BugJiraPayloadResolver  # noqa: E402


engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def setup_function():
    Base.metadata.create_all(bind=engine)


def teardown_function():
    Base.metadata.drop_all(bind=engine)


def test_option_string_matches_allowed_value_id():
    resolver = BugJiraPayloadResolver(
        {},
        [{
            "key": "customfield_10010",
            "name": "Severity",
            "type": "option",
            "allowed_values": [{"id": "10001", "value": "High"}],
        }],
    )

    assert resolver.resolve_explicit_fields({"customfield_10010": "high"}) == {
        "customfield_10010": {"id": "10001"}
    }


def test_priority_string_without_allowed_values_uses_name():
    resolver = BugJiraPayloadResolver(
        {},
        [{"key": "priority", "name": "Priority", "type": "priority"}],
    )

    assert resolver.resolve_explicit_fields({"priority": "High"}) == {
        "priority": {"name": "High"}
    }


def test_build_issue_fields_carries_generated_priority_severity_and_labels():
    fields = _build_issue_fields(
        {
            "summary": "Generated issue",
            "description": "Description",
            "steps_to_reproduce": "Step",
            "expected_result": "Expected",
            "actual_result": "Actual",
            "priority": "High",
            "severity": "Critical",
            "labels": ["regression", "checkout"],
            "extra_fields": {},
        },
        issue_type_id="10001",
        project_key="PROJ",
        project_id="123",
    )

    assert fields["priority"] == "High"
    assert fields["severity"] == "Critical"
    assert fields["labels"] == ["regression", "checkout"]


def test_field_mapping_prefers_matching_connection_and_blocks_legacy_for_multi_connection_user():
    db = SessionLocal()
    try:
        user = User(email="mapper@example.com")
        db.add(user)
        db.flush()

        conn_one = JiraConnection(
            user_id=user.id,
            auth_type=JiraAuthType.CLOUD,
            host_url="https://one.atlassian.net",
            username="user@example.com",
            encrypted_token="token",
        )
        conn_two = JiraConnection(
            user_id=user.id,
            auth_type=JiraAuthType.CLOUD,
            host_url="https://two.atlassian.net",
            username="user@example.com",
            encrypted_token="token",
        )
        db.add_all([conn_one, conn_two])
        db.flush()

        db.add_all([
            JiraFieldMapping(
                user_id=user.id,
                jira_connection_id=conn_one.id,
                project_key="PROJ",
                project_id="123",
                issue_type_id="10001",
                visible_fields=["customfield_one"],
                field_mappings={},
                field_defaults={},
            ),
            JiraFieldMapping(
                user_id=user.id,
                jira_connection_id=conn_two.id,
                project_key="PROJ",
                project_id="123",
                issue_type_id="10001",
                visible_fields=["customfield_two"],
                field_mappings={},
                field_defaults={},
            ),
        ])
        db.commit()

        mapping = _get_field_mapping_record(db, user.id, conn_two.id, "PROJ", "123", "10001")
        assert mapping.visible_fields == ["customfield_two"]

        db.add(JiraFieldMapping(
            user_id=user.id,
            jira_connection_id=None,
            project_key="LEGACY",
            project_id=None,
            issue_type_id="10001",
            visible_fields=["legacy_field"],
            field_mappings={},
            field_defaults={},
        ))
        db.commit()

        mapping = _get_field_mapping_record(db, user.id, conn_two.id, "LEGACY", None, "10001")
        assert mapping is None
    finally:
        db.close()


def test_field_mapping_uses_legacy_fallback_for_single_connection_user():
    db = SessionLocal()
    try:
        user = User(email="single-mapper@example.com")
        db.add(user)
        db.flush()

        conn = JiraConnection(
            user_id=user.id,
            auth_type=JiraAuthType.CLOUD,
            host_url="https://single.atlassian.net",
            username="user@example.com",
            encrypted_token="token",
        )
        db.add(conn)
        db.flush()

        db.add(JiraFieldMapping(
            user_id=user.id,
            jira_connection_id=None,
            project_key="LEGACY",
            project_id=None,
            issue_type_id="10001",
            visible_fields=["legacy_field"],
            field_mappings={},
            field_defaults={},
        ))
        db.commit()

        mapping = _get_field_mapping_record(db, user.id, conn.id, "LEGACY", None, "10001")
        assert mapping.visible_fields == ["legacy_field"]
    finally:
        db.close()


def test_ai_generation_audit_metadata_hashes_redacted_input_and_output():
    user = User(email="audit@example.com", custom_ai_model="openrouter/custom-model")
    user.id = 42
    user.default_workspace_id = 7
    request = FindingGenerationRequest(
        selected_text="Customer audit@example.com saw token abcdefghijklmnopqrstuvwxyz123456 fail.",
        issue_context=IssueContext(
            issue_key="QA-123",
            summary="Checkout failure",
            description="Authorization: Bearer secret-token-value-abcdefghijklmnopqrstuvwxyz",
            acceptance_criteria="AC1: checkout succeeds",
        ),
        jira_connection_id=10,
        project_key="QA",
        issue_type_id="10001",
    )
    response = ManualBugGenerationResponse(
        bugs=[
            GeneratedFindingResponse(
                summary="Checkout fails after token refresh",
                description="Users cannot complete checkout.",
                steps_to_reproduce="Open checkout\nSubmit order",
                expected_result="Order is submitted.",
                actual_result="Order fails.",
                severity="High",
                priority="High",
                fields={"summary": "Checkout fails after token refresh"},
            )
        ],
        warnings=[],
    )

    metadata = build_ai_generation_audit_metadata(
        request_payload=request,
        response_payload=response,
        current_user=user,
        generation_source="manual_bug",
        request_path="/api/v1/ai/generate/manual",
        duration_ms=123,
        success=True,
        output_count=1,
        extra={"project_key": "QA"},
    )
    repeated = build_ai_generation_audit_metadata(
        request_payload=request,
        response_payload=response,
        current_user=user,
        generation_source="manual_bug",
        request_path="/api/v1/ai/generate/manual",
        duration_ms=456,
        success=True,
        output_count=1,
    )

    assert metadata["prompt_template_id"] == "bugmind.findings.v1"
    assert metadata["prompt_template_version"] == "1.0.0"
    assert metadata["provider_name"] == "openrouter"
    assert metadata["ai_model_name"] == "openrouter/custom-model"
    assert metadata["jira_issue_key"] == "QA-123"
    assert metadata["generation_user_id"] == 42
    assert metadata["generation_workspace_id"] == 7
    assert metadata["generation_source"] == "manual_bug"
    assert metadata["redaction_applied"] is True
    assert metadata["success"] is True
    assert metadata["output_count"] == 1
    assert metadata["input_hash"] == repeated["input_hash"]
    assert metadata["output_hash"] == repeated["output_hash"]
    assert "audit@example.com" not in metadata["input_hash"]
    assert "secret-token" not in metadata["input_hash"]


def test_ai_generation_audit_metadata_records_failed_attempt_without_output_hash():
    user = User(email="audit-failure@example.com", custom_ai_model=None)
    user.id = 44
    request = FindingGenerationRequest(
        selected_text="Story text",
        issue_context=IssueContext(issue_key="QA-404", summary="Missing config"),
        jira_connection_id=10,
        project_key="QA",
        issue_type_id="10001",
    )

    metadata = build_ai_generation_audit_metadata(
        request_payload=request,
        current_user=user,
        generation_source="jira_story",
        request_path="/api/v1/ai/generate",
        success=False,
        failure_reason="AI Service is not configured",
    )

    assert metadata["success"] is False
    assert metadata["failure_reason"] == "AI Service is not configured"
    assert metadata["output_hash"] is None
    assert metadata["jira_issue_key"] == "QA-404"


def test_ai_generation_route_audit_helper_persists_metadata():
    db = SessionLocal()
    try:
        user = User(email="audit-route@example.com", custom_ai_model="openrouter/route-model")
        db.add(user)
        db.commit()
        db.refresh(user)
        request_payload = FindingGenerationRequest(
            selected_text="Story with email qa@example.com",
            issue_context=IssueContext(issue_key="QA-777", summary="Audit route"),
            jira_connection_id=10,
            project_key="QA",
            issue_type_id="10001",
        )

        _audit_ai_generation(
            action="ai.generate.manual",
            request=SimpleNamespace(url=SimpleNamespace(path="/api/v1/ai/generate/manual")),
            req=request_payload,
            db=db,
            current_user=user,
            generation_source="manual_bug",
            start_time=0.0,
            success=False,
            failure_reason="AI returned no usable findings",
            extra={"project_key": "QA"},
        )

        row = db.query(AuditLog).filter(AuditLog.action == "ai.generate.manual").one()
        assert row.user_id == user.id
        assert row.event_metadata["audit_schema_version"] == "ai_generation.v1"
        assert row.event_metadata["prompt_template_id"] == "bugmind.findings.v1"
        assert row.event_metadata["ai_model_name"] == "openrouter/route-model"
        assert row.event_metadata["jira_issue_key"] == "QA-777"
        assert row.event_metadata["success"] is False
        assert row.event_metadata["failure_reason"] == "AI returned no usable findings"
        assert row.event_metadata["output_hash"] is None
    finally:
        db.close()
