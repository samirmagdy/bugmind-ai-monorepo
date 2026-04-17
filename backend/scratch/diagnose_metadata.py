import asyncio
import os
import sys
import base64
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add parent dir to path to import app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.jira import JiraService
from app.models.database import JiraConnection, User
from app.core.crypto import decrypt_token

async def run_diagnostics():
    # 1. Setup DB
    db_path = "../../bugmind.db"
    if not os.path.exists(db_path):
        db_path = "bugmind.db"
    
    engine = create_engine(f"sqlite:///{db_path}")
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()

    try:
        # 2. Get connection
        conn = db.query(JiraConnection).first()
        if not conn:
            print("No Jira connection found in DB")
            return

        print(f"Testing Connection: {conn.base_url} (Auth: {conn.auth_type}, User: {conn.username})")
        token = decrypt_token(conn.token_encrypted)
        
        jira = JiraService(
            base_url=conn.base_url,
            auth_type=conn.auth_type.value if hasattr(conn.auth_type, 'value') else conn.auth_type,
            token=token,
            username=conn.username
        )

        project_key = "YMA"
        print(f"\n--- STEP 1: Fetching Issue Types for {project_key} ---")
        types = await jira.get_project_issue_types(project_key)
        print(f"Found {len(types)} issue types")
        if not types: return

        # Try a few types
        target_types = [t for t in types if t['name'].lower() in ['bug', 'task']][:2]
        if not target_types: target_types = [types[0]]

        for it in target_types:
            it_id = it['id']
            it_name = it['name']
            print(f"\n--- STEP 2: Fetching Metadata for {it_name} (ID: {it_id}) ---")
            
            # Manual Strategy 2 Check
            url_granular = f"{jira.base_url}/rest/api/2/issue/createmeta/{project_key}/issuetypes/{it_id}"
            print(f"Requesting Granular: {url_granular}")
            res = await jira._make_request("GET", url_granular)
            print(f"Granular Response: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                print(f"Granular Keys: {list(data.keys())}")
                if "fields" in data:
                    print(f"Found {len(data['fields'])} fields in 'fields' key")
                if "values" in data:
                    print(f"Found {len(data['values'])} items in 'values' key")
            
            # Legacy Strategy 3 Check
            url_legacy = f"{jira.base_url}/rest/api/2/issue/createmeta?projectKeys={project_key}&expand=projects.issuetypes.fields&issueTypeIds={it_id}"
            print(f"Requesting Legacy: {url_legacy}")
            res = await jira._make_request("GET", url_legacy)
            print(f"Legacy Response: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                projs = data.get("projects", [])
                if projs:
                    its = projs[0].get("issuetypes", [])
                    if its:
                        print(f"Found {len(its[0].get('fields', {}))} fields in Legacy strategy")
                    else:
                        print("Legacy: projects found but issuetypes empty")
                else:
                    print("Legacy: no projects in response")

    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
