import importlib
import os
import sys

# Mock dependencies before imports
from unittest.mock import MagicMock
mock_redis = MagicMock()
mock_redis_exceptions = MagicMock()
sys.modules["redis"] = mock_redis
sys.modules["redis.exceptions"] = mock_redis_exceptions

mock_settings = MagicMock()
mock_settings.REDIS_URL = "redis://localhost"
sys.modules["app.core.config"] = MagicMock(settings=mock_settings)

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

JiraFieldResolver = importlib.import_module(
    "app.services.jira.field_resolver"
).JiraFieldResolver
JiraMetadataEngine = importlib.import_module(
    "app.services.jira.metadata_engine"
).JiraMetadataEngine

def test_field_resolver():
    print("Testing JiraFieldResolver...")
    
    schema = [
        {"key": "summary", "name": "Summary", "type": "string"},
        {"key": "assignee", "name": "Assignee", "type": "user"},
        {"key": "customfield_101", "name": "Select", "type": "option"},
        {"key": "labels", "name": "Labels", "type": "array", "items": "string"},
        {"key": "priority", "name": "Priority", "type": "priority"}
    ]
    
    mapping = {
        "summary": "summary",
        "assignee": "assignee",
        "select": "customfield_101",
        "labels": "labels",
        "priority": "priority"
    }
    
    # Test Cloud
    resolver_cloud = JiraFieldResolver(mapping, schema, platform="cloud")
    ai_output = {
        "summary": "Cloud Bug",
        "assignee": {"id": "acc-123"},
        "select": "opt-1",
        "labels": ["l1", "l2"],
        "priority": "High"
    }
    
    resolved_cloud = resolver_cloud.resolve(ai_output)
    print("\nCloud Resolved Payload:")
    print(resolved_cloud["fields"])
    
    assert resolved_cloud["fields"]["assignee"] == {"accountId": "acc-123"}
    assert resolved_cloud["fields"]["customfield_101"] == {"id": "opt-1"}
    assert resolved_cloud["fields"]["labels"] == ["l1", "l2"]
    
    # Test Server
    resolver_server = JiraFieldResolver(mapping, schema, platform="server")
    ai_output_server = {
        "summary": "Server Bug",
        "assignee": {"id": "samir"},
        "select": {"id": "opt-1"}, # already structured from frontend
        "labels": ["l1", "l2"],
        "priority": "High"
    }
    
    resolved_server = resolver_server.resolve(ai_output_server)
    print("\nServer Resolved Payload:")
    print(resolved_server["fields"])
    
    assert resolved_server["fields"]["assignee"] == {"name": "samir"}
    assert resolved_server["fields"]["customfield_101"] == {"id": "opt-1"} # Verify no double-wrap
    assert resolved_server["fields"]["labels"] == ["l1", "l2"]

def test_metadata_engine():
    print("\nTesting JiraMetadataEngine...")
    
    mock_adapter = MagicMock()
    # Mock modern createmeta response
    mock_adapter.get_fields.return_value = [
        {
            "fieldId": "customfield_102",
            "name": "User Picker",
            "schema": {"type": "string", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:userpicker"},
            "allowedValues": []
        },
        {
            "fieldId": "customfield_103",
            "name": "Multi Select",
            "schema": {"type": "array", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:multiselect"},
            "values": [{"id": "1", "value": "A"}] # Modern sometimes uses 'values'
        }
    ]
    
    # Setup mock redis (ignore for now, we'll bypass it)
    engine = JiraMetadataEngine(mock_adapter)
    engine.redis = MagicMock()
    engine.redis.get.return_value = None
    
    schema = engine.get_field_schema("PROJ", "1")
    for f in schema:
        print(f"Field: {f['name']}, Type: {f['type']}, Allowed: {f['allowed_values']}")
        
    assert schema[0]["type"] == "user"
    assert schema[1]["type"] == "multi-select"
    assert len(schema[1]["allowed_values"]) == 1

if __name__ == "__main__":
    try:
        test_field_resolver()
        test_metadata_engine()
        print("\nAll tests passed!")
    except Exception as e:
        print(f"\nTest failed: {e}")
        import traceback
        traceback.print_exc()
