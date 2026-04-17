from app.api.jira import get_jira_status
from app.db.session import SessionLocal
from app.models.database import User, JiraConnection
from fastapi import Request

def test_status():
    db = SessionLocal()
    user = db.query(User).first()
    if not user:
        print("No user found")
        return
    
    conn = db.query(JiraConnection).filter(JiraConnection.user_id == user.id).first()
    if not conn:
        print("No connection found")
        return
        
    print(f"Testing status for user {user.email} and base_url {conn.base_url}")
    try:
        # Mocking the dependency injection manually
        res = get_jira_status(base_url=conn.base_url, current_user=user, db=db)
        print(f"Result: {res}")
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_status()
