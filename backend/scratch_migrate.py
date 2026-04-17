from app.db.session import engine
from sqlalchemy import text

def migrate():
    with engine.connect() as conn:
        print("Checking for verify_ssl in jira_connections...")
        try:
            # Check if column exists
            conn.execute(text("SELECT verify_ssl FROM jira_connections LIMIT 1"))
            print("Column verify_ssl already exists.")
        except Exception as e:
            print(f"Column missing or error: {e}")
            print("Attempting to add verify_ssl to jira_connections...")
            try:
                conn.execute(text("ALTER TABLE jira_connections ADD COLUMN verify_ssl BOOLEAN DEFAULT TRUE"))
                conn.commit()
                print("Column verify_ssl added successfully.")
            except Exception as e2:
                print(f"Failed to add column: {e2}")

if __name__ == "__main__":
    migrate()
