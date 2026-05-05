import os
import sys
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DB_FILE = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
DB_FILE.close()

os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_FILE.name}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-workspaces")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("RATE_LIMITS_ENABLED", "false")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import deps
from app.core.database import Base
from app.main import app
from app.models.audit import AuditLog
from app.models.jira import JiraAuthType, JiraConnection
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole, WorkspaceTemplate
from app.core.security import create_access_token, encrypt_credential, get_password_hash

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        app.dependency_overrides[deps.get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        app.dependency_overrides.pop(deps.get_db, None)
        Base.metadata.drop_all(bind=engine)
        try:
            os.unlink(DB_FILE.name)
        except OSError:
            pass

    def setUp(self):
        with SessionLocal() as db:
            db.query(AuditLog).delete()
            db.query(JiraConnection).delete()
            db.query(WorkspaceTemplate).delete()
            db.query(WorkspaceMember).delete()
            db.query(Workspace).delete()
            db.query(User).delete()
            
            self.test_user = User(
                email="test@example.com",
                hashed_password=get_password_hash("password123"),
                is_active=True
            )
            db.add(self.test_user)
            db.commit()
            db.refresh(self.test_user)
            self.token = create_access_token(subject=self.test_user.id)
            self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_create_workspace(self):
        response = self.client.post(
            "/api/v1/workspaces/",
            headers=self.headers,
            json={"name": "Test Workspace"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "Test Workspace")
        
        with SessionLocal() as db:
            ws = db.query(Workspace).filter(Workspace.id == data["id"]).first()
            self.assertIsNotNone(ws)
            member = db.query(WorkspaceMember).filter(
                WorkspaceMember.workspace_id == ws.id,
                WorkspaceMember.user_id == self.test_user.id
            ).first()
            self.assertEqual(member.role, WorkspaceRole.OWNER)

    def test_list_workspaces(self):
        self.client.post("/api/v1/workspaces/", headers=self.headers, json={"name": "WS 1"})
        self.client.post("/api/v1/workspaces/", headers=self.headers, json={"name": "WS 2"})
        
        response = self.client.get("/api/v1/workspaces/", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreaterEqual(len(data), 2)

    def test_invite_member(self):
        ws_res = self.client.post("/api/v1/workspaces/", headers=self.headers, json={"name": "Team WS"})
        ws_id = ws_res.json()["id"]
        
        with SessionLocal() as db:
            other_user = User(email="other@example.com", hashed_password="...")
            db.add(other_user)
            db.commit()
            other_id = other_user.id
        
        response = self.client.post(
            f"/api/v1/workspaces/{ws_id}/members?email=other@example.com&role=qa_engineer",
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        
        with SessionLocal() as db:
            member = db.query(WorkspaceMember).filter(
                WorkspaceMember.workspace_id == ws_id,
                WorkspaceMember.user_id == other_id
            ).first()
            self.assertEqual(member.role, WorkspaceRole.QA_ENGINEER)

    def test_workspace_details_templates_connections_usage_and_audit(self):
        ws_res = self.client.post("/api/v1/workspaces/", headers=self.headers, json={"name": "Ops WS"})
        self.assertEqual(ws_res.status_code, 200, ws_res.text)
        ws_id = ws_res.json()["id"]

        template_res = self.client.post(
            f"/api/v1/workspaces/{ws_id}/templates",
            headers=self.headers,
            json={
                "name": "API QA",
                "template_type": "test",
                "content": {"body": "Cover auth, validation, and error responses."},
            },
        )
        self.assertEqual(template_res.status_code, 200, template_res.text)
        template_id = template_res.json()["id"]

        detail_res = self.client.get(f"/api/v1/workspaces/{ws_id}", headers=self.headers)
        self.assertEqual(detail_res.status_code, 200, detail_res.text)
        detail = detail_res.json()
        self.assertEqual(detail["role"], "owner")
        self.assertEqual(detail["templates"][0]["name"], "API QA")

        with SessionLocal() as db:
            conn = JiraConnection(
                user_id=self.test_user.id,
                auth_type=JiraAuthType.CLOUD,
                host_url="https://example.atlassian.net",
                username="test@example.com",
                encrypted_token=encrypt_credential("jira-token"),
                verify_ssl=True,
                is_active=True,
            )
            db.add(conn)
            db.commit()
            conn_id = conn.id

        share_res = self.client.post(f"/api/v1/workspaces/{ws_id}/connections/{conn_id}/share", headers=self.headers)
        self.assertEqual(share_res.status_code, 200, share_res.text)
        self.assertTrue(share_res.json()["is_shared"])
        self.assertEqual(share_res.json()["workspace_id"], ws_id)

        connections_res = self.client.get(f"/api/v1/workspaces/{ws_id}/connections", headers=self.headers)
        self.assertEqual(connections_res.status_code, 200, connections_res.text)
        self.assertEqual(len(connections_res.json()), 1)

        usage_res = self.client.get(f"/api/v1/workspaces/{ws_id}/usage", headers=self.headers)
        self.assertEqual(usage_res.status_code, 200, usage_res.text)
        usage = usage_res.json()
        self.assertEqual(usage["members_count"], 1)
        self.assertEqual(usage["templates_count"], 1)
        self.assertEqual(usage["shared_connections_count"], 1)
        self.assertGreaterEqual(usage["audit_events_count"], 2)

        audit_res = self.client.get(f"/api/v1/workspaces/{ws_id}/audit-logs", headers=self.headers)
        self.assertEqual(audit_res.status_code, 200, audit_res.text)
        actions = {row["action"] for row in audit_res.json()}
        self.assertIn("workspace.template_create", actions)
        self.assertIn("workspace.connection_share", actions)

        unshare_res = self.client.delete(f"/api/v1/workspaces/{ws_id}/connections/{conn_id}/share", headers=self.headers)
        self.assertEqual(unshare_res.status_code, 200, unshare_res.text)
        self.assertFalse(unshare_res.json()["is_shared"])

        delete_res = self.client.delete(f"/api/v1/workspaces/{ws_id}/templates/{template_id}", headers=self.headers)
        self.assertEqual(delete_res.status_code, 204, delete_res.text)

if __name__ == "__main__":
    unittest.main()
