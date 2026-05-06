import os
from pathlib import Path
import sys

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
from app.models.jira import JiraAuthType, JiraConnection, JiraFieldMapping  # noqa: E402
from app.models.user import User  # noqa: E402
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
