from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.models.jira import JiraAuthType, JiraConnection
from app.models.user import User
from app.schemas.bug import TestCase, XrayTestSuitePublishRequest
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.xray_publisher import XrayCloudPublisher, XrayServerPublisher, ensure_xray_cloud_folder


class FakeMetadataEngine:
    def __init__(self, adapter):
        self.adapter = adapter

    def get_project_metadata(self, project_id):
        return [{"id": "10001", "name": "Test"}]

    def get_field_schema(self, project_id, issue_type_id):
        return [
            {"key": "summary", "name": "Summary", "type": "string", "required": True},
            {"key": "description", "name": "Description", "type": "string", "required": False},
            {"key": "priority", "name": "Priority", "type": "priority", "required": False},
        ]


class FakeCloudAdapter:
    def __init__(self):
        self.created_payloads = []
        self.deleted = []
        self.links = []

    def get_issue_link_types(self):
        return ["Tests", "Relates"]

    def create_issue(self, payload):
        self.created_payloads.append(payload)
        return f"TEST-{len(self.created_payloads)}"

    def update_issue(self, issue_key, payload):
        raise AssertionError("update_issue should not be called in create-new contract")

    def get_issue(self, issue_key):
        return {"id": f"id-{issue_key}"}

    def link_issues(self, issue_key, link_type, story_issue_key):
        self.links.append((issue_key, link_type, story_issue_key))

    def fetch_issue(self, issue_key):
        return {"fields": {"issuelinks": []}}

    def transition_issue(self, issue_key, transition_name=None):
        return None

    def add_comment(self, issue_key, body):
        return None

    def delete_issue(self, issue_key):
        self.deleted.append(issue_key)


class FakeServerAdapter(JiraServerAdapter):
    def __init__(self):
        self.created_payloads = []
        self.created_folders = []
        self.added_steps = []
        self.added_to_folders = []
        self.links = []
        self.deleted = []

    def get_current_user(self):
        return {}

    def fetch_issue(self, issue_key):
        return {"fields": {"issuelinks": []}}

    def search_issues(self, jql, fields=None, max_results=100):
        return []

    def fetch_attachment(self, attachment_id):
        return b"", "text/plain", "empty.txt"

    def get_projects(self):
        return []

    def get_issue_types(self, project_id):
        return []

    def get_fields(self, project_id, issue_type_id):
        return []

    def get_issue_context(self, issue_key):
        return {}

    def create_issue(self, payload):
        self.created_payloads.append(payload)
        return f"TEST-{len(self.created_payloads)}"

    def update_issue(self, issue_key, payload):
        raise AssertionError("update_issue should not be called in create-new contract")

    def delete_issue(self, issue_key):
        self.deleted.append(issue_key)

    def link_issues(self, issue_key, link_type, story_issue_key):
        self.links.append((issue_key, link_type, story_issue_key))

    def add_comment(self, issue_key, body):
        return None

    def transition_issue(self, issue_key, transition_name=None):
        return None

    def search_users(self, query, project_id=None, project_key=None, issue_type_id=None, field_id=None):
        return []

    def get_issue_link_types(self):
        return ["Tests", "Relates"]

    def get_sprint_options(self, project_id):
        return []

    def add_xray_step(self, issue_key, step, data=None, result=None):
        self.added_steps.append((issue_key, step, data, result))
        return {}

    def get_xray_folders(self, project_key):
        return []

    def create_xray_folder(self, project_key, parent_id, name):
        folder = {"id": f"folder-{len(self.created_folders) + 1}", "name": name, "parentId": parent_id}
        self.created_folders.append((project_key, parent_id, name, folder["id"]))
        return folder

    def add_test_to_folder(self, project_key, folder_id, issue_key):
        self.added_to_folders.append((project_key, folder_id, issue_key))


class FakeXrayCloudClient:
    def __init__(self, connection, *, folder_error=None, add_to_folder_error=None):
        self.connection = connection
        self.folder_error = folder_error
        self.add_to_folder_error = add_to_folder_error
        self.created_folders = []
        self.added_steps = []
        self.added_to_folders = []

    def get_folders(self, project_id):
        if self.folder_error == "lookup":
            raise HTTPException(status_code=403, detail="Folder lookup denied")
        return []

    def create_folder(self, project_id, name, parent_id=None):
        if self.folder_error == "create":
            raise HTTPException(status_code=403, detail="Folder creation denied")
        folder_id = f"folder-{len(self.created_folders) + 1}"
        self.created_folders.append((project_id, name, parent_id, folder_id))
        return folder_id

    def add_test_steps(self, issue_id, steps):
        self.added_steps.append((issue_id, steps))

    def add_test_to_folder(self, project_id, folder_id, issue_id):
        if self.add_to_folder_error:
            raise HTTPException(status_code=403, detail="Add to folder denied")
        self.added_to_folders.append((project_id, folder_id, issue_id))


def _publish_request() -> XrayTestSuitePublishRequest:
    return XrayTestSuitePublishRequest(
        jira_connection_id=1,
        story_issue_key="STORY-1",
        xray_project_id="10000",
        xray_project_key="QA",
        folder_path="Regression/API",
        test_cases=[
            TestCase(
                title="Validate API happy path",
                objective="Confirm success response",
                steps=["Call the endpoint", "Inspect the response"],
                expected_result="The response is 200 with valid payload",
                priority="High",
                test_type="API",
            )
        ],
    )


def _publisher_context(fake_client):
    adapter = FakeCloudAdapter()
    conn = JiraConnection(
        id=1,
        user_id=1,
        auth_type=JiraAuthType.CLOUD,
        host_url="https://example.atlassian.net",
        username="qa@example.com",
        encrypted_token="token",
    )
    user = User(email="publisher@example.com")
    user.id = 1
    request = SimpleNamespace(headers={}, url=SimpleNamespace(path="/api/v1/jira/connections/1/xray/test-suite"))
    db = MagicMock()
    patches = [
        patch("app.services.jira.xray_publisher.get_owned_connection", return_value=conn),
        patch("app.services.jira.xray_publisher.get_adapter", return_value=adapter),
        patch("app.services.jira.xray_publisher.JiraMetadataEngine", FakeMetadataEngine),
        patch("app.services.jira.xray_cloud.XrayCloudClient", return_value=fake_client),
    ]
    return adapter, user, request, db, patches


def _server_publisher_context():
    adapter = FakeServerAdapter()
    conn = JiraConnection(
        id=1,
        user_id=1,
        auth_type=JiraAuthType.SERVER,
        host_url="https://jira.example.com",
        username="qa@example.com",
        encrypted_token="token",
    )
    user = User(email="publisher@example.com")
    user.id = 1
    request = SimpleNamespace(headers={}, url=SimpleNamespace(path="/api/v1/jira/connections/1/xray/test-suite"))
    db = MagicMock()
    patches = [
        patch("app.services.jira.xray_publisher.get_owned_connection", return_value=conn),
        patch("app.services.jira.xray_publisher.get_adapter", return_value=adapter),
        patch("app.services.jira.xray_publisher.JiraMetadataEngine", FakeMetadataEngine),
    ]
    return adapter, user, request, db, patches


def test_ensure_xray_cloud_folder_returns_none_and_warning_when_lookup_denied():
    warnings = []
    client = FakeXrayCloudClient(None, folder_error="lookup")

    folder_id = ensure_xray_cloud_folder(client, "10000", "Regression/API", warnings)

    assert folder_id is None
    assert warnings
    assert "folder lookup failed" in warnings[0].lower()


def test_xray_cloud_publish_creates_test_when_folder_creation_denied():
    fake_client = FakeXrayCloudClient(None, folder_error="create")
    adapter, user, request, db, patches = _publisher_context(fake_client)
    with patches[0], patches[1], patches[2], patches[3]:
        response = XrayCloudPublisher(db, user, request).publish(1, _publish_request())

    assert [test.key for test in response.created_tests] == ["TEST-1"]
    assert response.folder_path == "Regression/API"
    assert response.warnings
    assert "could not be created" in " ".join(response.warnings)
    assert adapter.created_payloads[0]["fields"]["issuetype"] == {"id": "10001"}
    assert fake_client.added_steps[0][0] == "id-TEST-1"
    assert fake_client.added_to_folders == []
    assert adapter.deleted == []


def test_xray_cloud_publish_warns_when_add_to_folder_fails_after_create():
    fake_client = FakeXrayCloudClient(None, add_to_folder_error=True)
    adapter, user, request, db, patches = _publisher_context(fake_client)
    with patches[0], patches[1], patches[2], patches[3]:
        response = XrayCloudPublisher(db, user, request).publish(1, _publish_request())

    assert [test.key for test in response.created_tests] == ["TEST-1"]
    assert fake_client.created_folders
    assert fake_client.added_steps
    assert adapter.deleted == []
    assert any("could not add it to Xray Cloud folder" in warning for warning in response.warnings)


def test_xray_server_publish_adds_manual_steps_and_repository_folder():
    adapter, user, request, db, patches = _server_publisher_context()
    with patches[0], patches[1], patches[2]:
        response = XrayServerPublisher(db, user, request).publish(1, _publish_request())

    assert [test.key for test in response.created_tests] == ["TEST-1"]
    assert response.folder_path == "Regression/API"
    assert response.link_type_used == "Tests"
    assert adapter.created_folders == [
        ("QA", "0", "Regression", "folder-1"),
        ("QA", "folder-1", "API", "folder-2"),
    ]
    assert adapter.added_steps == [
        ("TEST-1", "Call the endpoint", None, None),
        ("TEST-1", "Inspect the response", None, "The response is 200 with valid payload"),
    ]
    assert adapter.added_to_folders == [("QA", "folder-2", "TEST-1")]
    assert adapter.created_payloads[0]["fields"]["issuetype"] == {"id": "10001"}
