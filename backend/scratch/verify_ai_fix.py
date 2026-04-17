import asyncio
import httpx
from app.services.ai_engine import AIEngine, AIConnectionError
import os

async def verify_ai_timeout():
    print("--- Simulating AI Connection Timeout ---")
    
    # We use a non-existent port on localhost to force a connection failure
    engine = AIEngine(api_key="sk-or-v1-test", model="test-model")
    engine.base_url = "http://10.255.255.1/api/v1/chat/completions" # Non-routable IP
    
    start_time = asyncio.get_event_loop().time()
    try:
        await engine.generate_bug_from_description("Test bug", "Test context")
    except AIConnectionError as e:
        end_time = asyncio.get_event_loop().time()
        duration = end_time - start_time
        print(f"Caught expected AIConnectionError: {e}")
        print(f"Duration: {duration:.2f} seconds")
        
        # We expect it to fail within ~35 seconds (15s connect * 2 attempts + overhead)
        if duration < 40:
            print("SUCCESS: AI timeout is within acceptable fast-fail limits.")
        else:
            print(f"FAILURE: AI timeout took too long ({duration:.2f}s).")
    except Exception as e:
        print(f"Caught UNEXPECTED error: {type(e).__name__}: {e}")

if __name__ == "__main__":
    # Ensure we are in the backend directory and app is importable
    import sys
    sys.path.append(os.getcwd())
    asyncio.run(verify_ai_timeout())
