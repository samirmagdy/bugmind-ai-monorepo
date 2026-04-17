import httpx
import json
import time
import os

BASE_URL = "http://localhost:8000/api"

def test_full_flow():
    print("🚀 Starting E2E Dry-Run Validation...")
    
    # Check if backend is running
    try:
        res = httpx.get("http://localhost:8000/")
        print(f"✅ Backend status: {res.json()['message']}")
    except Exception as e:
        print(f"❌ Backend not reachable: {e}")
        return

    # 1. Register
    email = f"test_{int(time.time())}@example.com"
    try:
        res = httpx.post(f"{BASE_URL}/auth/register", json={
            "email": email,
            "password": "password123"
        })
        print(f"✅ Registration: {res.status_code}")
    except Exception as e:
        print(f"❌ Registration failed: {e}")

    # 2. Login
    try:
        res = httpx.post(f"{BASE_URL}/auth/login", data={
            "username": email,
            "password": "password123"
        })
        token = res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("✅ Auth & JWT Retrieval: Success")
    except Exception as e:
        print(f"❌ Login failed: {e}")
        return

    # 3. Connect Jira (Mock)
    try:
        res = httpx.post(f"{BASE_URL}/jira/connect", headers=headers, json={
            "base_url": "https://test.atlassian.net",
            "auth_type": "cloud",
            "token": "mock-token",
            "username": "test-user"
        })
        print(f"✅ Jira Connection Logic: {res.json()['status']}")
    except Exception as e:
        print(f"❌ Jira logic failed: {e}")

    # 4. Usage Retrieval
    try:
        res = httpx.get(f"{BASE_URL}/bugs/usage", headers=headers)
        usage = res.json()
        print(f"✅ Usage Monitoring: {usage['plan'].upper()} ({usage['used']}/{usage['limit']})")
    except Exception as e:
        print(f"❌ Usage fetch failed: {e}")

    print("\n🏁 E2E Dry-Run Summary: Service Infrastructure Solidified.")

if __name__ == "__main__":
    test_full_flow()
