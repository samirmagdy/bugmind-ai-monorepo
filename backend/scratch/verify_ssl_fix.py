import asyncio
import httpx
from unittest.mock import MagicMock, AsyncMock, patch
from app.services.jira import JiraService, JiraConnectionError

async def test_ssl_error_handling():
    # Mock httpx.AsyncClient.request to raise an SSL ConnectError
    mock_response = AsyncMock()
    
    with patch("httpx.AsyncClient.request", side_effect=httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: certificate has expired")):
        service = JiraService(
            base_url="https://expired.jira.com",
            auth_type="server",
            token="test-token"
        )
        
        try:
            await service.get_project_issue_types("PROJ")
        except JiraConnectionError as e:
            print(f"Caught expected error: {e}")
            assert "SSL Verification failed" in str(e)
            return
        except Exception as e:
            print(f"Caught wrong exception type: {type(e).__name__}: {e}")
            raise e
            
        raise Exception("Should have raised JiraConnectionError")

if __name__ == "__main__":
    asyncio.run(test_ssl_error_handling())
    print("Verification successful!")
