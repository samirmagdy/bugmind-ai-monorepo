from app.services.jira import JiraService
from app.db.session import SessionLocal
from app.models.database import User, JiraConnection
from app.core.crypto import decrypt_token
import asyncio

async def test_jira_calls():
    db = SessionLocal()
    user = db.query(User).first()
    conn = db.query(JiraConnection).filter(JiraConnection.user_id == user.id).first()
    
    print(f"Testing Jira calls for {conn.base_url} with verify_ssl={conn.verify_ssl}")
    
    jira = JiraService(
        base_url=conn.base_url,
        auth_type=conn.auth_type.value if hasattr(conn.auth_type, 'value') else conn.auth_type,
        token=decrypt_token(conn.token_encrypted),
        username=conn.username,
        verify_ssl=conn.verify_ssl
    )
    
    try:
        print("Fetching deployment type...")
        dtype = await jira.get_deployment_type()
        print(f"Deployment type: {dtype}")
        
        print("Fetching issue types...")
        # Hardcoding the project key from user's request
        types = await jira.get_project_issue_types("YMA")
        print(f"Found {len(types)} issue types")
    except Exception as e:
        print(f"FAILURE: {type(e).__name__}: {str(e)}")

if __name__ == "__main__":
    asyncio.run(test_jira_calls())
