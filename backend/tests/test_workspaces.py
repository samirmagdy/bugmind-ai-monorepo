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

from app.core.database import Base, SessionLocal, engine
from app.main import app
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole
from app.core.security import create_access_token, get_password_hash

class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        Base.metadata.drop_all(bind=engine)
        try:
            os.unlink(DB_FILE.name)
        except OSError:
            pass

    def setUp(self):
        with SessionLocal() as db:
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

if __name__ == "__main__":
    unittest.main()
