import pytest
from app.services.ai.base_generator import BaseAIGenerator

class MockGenerator(BaseAIGenerator):
    def generate_test_cases(self, *args, **kwargs):
        pass
    def generate_bug(self, *args, **kwargs):
        pass
    def analyze_gap(self, *args, **kwargs):
        pass

@pytest.fixture
def generator():
    return MockGenerator()

def test_sanitize_emails(generator):
    text = "Contact me at test@example.com or admin@internal.net"
    sanitized = generator._sanitize_for_ai(text)
    assert "test@example.com" not in sanitized
    assert "admin@internal.net" not in sanitized
    assert sanitized.count("[REDACTED_EMAIL]") == 2

def test_sanitize_tokens(generator):
    text = "Bearer 1234567890abcdef1234567890abcdef and secret_key_abc123_def456_ghi789_jkl"
    sanitized = generator._sanitize_for_ai(text)
    assert "[REDACTED_TOKEN]" in sanitized
    assert "1234567890abcdef1234567890abcdef" not in sanitized

def test_sanitize_jwt(generator):
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoyNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    text = f"Token: {jwt}"
    sanitized = generator._sanitize_for_ai(text)
    assert "[REDACTED_JWT]" in sanitized
    assert jwt not in sanitized

def test_sanitize_ids(generator):
    text = "My card is 1234567812345678 and ID 987654321098"
    sanitized = generator._sanitize_for_ai(text)
    assert "[REDACTED_ID]" in sanitized
    assert "1234567812345678" not in sanitized

def test_sanitize_phone(generator):
    text = "Call +1-555-010-9999 or (555) 123-4567"
    sanitized = generator._sanitize_for_ai(text)
    assert "[REDACTED_PHONE]" in sanitized
    assert "555-010-9999" not in sanitized

def test_sanitize_query_params(generator):
    text = "https://api.com?api_key=secret&session_id=123"
    sanitized = generator._sanitize_for_ai(text)
    assert "api_key=[REDACTED_CREDENTIAL]" in sanitized
    assert "session_id=[REDACTED_CREDENTIAL]" in sanitized
    assert "secret" not in sanitized
