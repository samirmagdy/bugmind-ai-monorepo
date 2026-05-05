import pytest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
from app.services.jira.xray_cloud import XrayCloudClient
from app.models.jira import JiraConnection
from app.core import security

@pytest.fixture
def mock_connection():
    conn = JiraConnection(
        id=1,
        xray_cloud_client_id="test_client_id",
        encrypted_xray_cloud_client_secret=security.encrypt_credential("test_secret")
    )
    return conn

@pytest.fixture
def xray_client(mock_connection):
    return XrayCloudClient(mock_connection)

@patch("app.services.jira.xray_cloud.httpx.post")
def test_get_token_success(mock_post, xray_client):
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.text = '"test_token"'
    mock_post.return_value = mock_response

    token = xray_client._get_token()
    assert token == "test_token"
    mock_post.assert_called_once()
    assert mock_post.call_args[1]["json"]["client_id"] == "test_client_id"
    assert mock_post.call_args[1]["json"]["client_secret"] == "test_secret"

@patch("app.services.jira.xray_cloud.httpx.post")
def test_get_token_failure(mock_post, xray_client):
    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = Exception("Auth failed")
    mock_post.return_value = mock_response

    with pytest.raises(HTTPException) as excinfo:
        xray_client._get_token()
    
    assert excinfo.value.status_code == 401
    assert "Failed to authenticate" in str(excinfo.value.detail)

@patch("app.services.jira.xray_cloud.httpx.post")
def test_graphql_success(mock_post, xray_client):
    xray_client._token = "test_token"
    
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"data": {"result": "success"}}
    mock_post.return_value = mock_response

    result = xray_client._graphql("query test {}")
    assert result == {"result": "success"}
    mock_post.assert_called_once()

@patch("app.services.jira.xray_cloud.httpx.post")
def test_graphql_error_response(mock_post, xray_client):
    xray_client._token = "test_token"
    
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"errors": [{"message": "GraphQL syntax error"}]}
    mock_post.return_value = mock_response

    with pytest.raises(HTTPException) as excinfo:
        xray_client._graphql("query test {}")
    
    assert excinfo.value.status_code == 502
    assert "GraphQL syntax error" in str(excinfo.value.detail)

@patch.object(XrayCloudClient, "_graphql")
def test_create_folder(mock_graphql, xray_client):
    mock_graphql.return_value = {"createFolder": {"folder": {"id": "f1", "name": "Test"}}}
    
    folder_id = xray_client.create_folder("P1", "Test")
    assert folder_id == "f1"
    mock_graphql.assert_called_once()
    variables = mock_graphql.call_args[0][1]
    assert variables["projectId"] == "P1"
    assert variables["name"] == "Test"

@patch.object(XrayCloudClient, "_graphql")
def test_add_test_steps(mock_graphql, xray_client):
    mock_graphql.return_value = {}
    
    steps = [
        {"action": "Do this", "data": "Precondition", "result": ""},
        {"action": "Do that", "data": "", "result": "Expected"}
    ]
    xray_client.add_test_steps("123", steps)
    
    assert mock_graphql.call_count == 2
    
    # First step
    vars_1 = mock_graphql.call_args_list[0][0][1]
    assert vars_1["issueId"] == "123"
    assert vars_1["step"]["action"] == "Do this"
    
    # Second step
    vars_2 = mock_graphql.call_args_list[1][0][1]
    assert vars_2["issueId"] == "123"
    assert vars_2["step"]["result"] == "Expected"
