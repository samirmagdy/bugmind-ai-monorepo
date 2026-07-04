import os

import pytest

from app.models.jira import JiraAuthType, JiraConnection
from app.core import security
from app.services.jira.adapters.cloud import JiraCloudAdapter
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.xray_cloud import XrayCloudClient


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_REAL_TENANT_CONTRACTS") != "true",
    reason="Real tenant contract tests require RUN_REAL_TENANT_CONTRACTS=true and tenant credentials.",
)


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        pytest.skip(f"{name} is required for real tenant contract tests")
    return value


def test_real_jira_cloud_identity_contract():
    identity = JiraCloudAdapter(
        _required("REAL_JIRA_CLOUD_URL"),
        _required("REAL_JIRA_CLOUD_EMAIL"),
        _required("REAL_JIRA_CLOUD_API_TOKEN"),
    ).get_current_user()

    assert identity.get("accountId") or identity.get("emailAddress")


def test_real_jira_server_identity_contract():
    identity = JiraServerAdapter(
        _required("REAL_JIRA_SERVER_URL"),
        _required("REAL_JIRA_SERVER_USERNAME"),
        _required("REAL_JIRA_SERVER_TOKEN"),
        verify_ssl=os.getenv("REAL_JIRA_SERVER_VERIFY_SSL", "true").lower() != "false",
    ).get_current_user()

    assert identity.get("name") or identity.get("key") or identity.get("accountId")


def test_real_xray_cloud_auth_contract():
    conn = JiraConnection(
        auth_type=JiraAuthType.CLOUD,
        host_url=_required("REAL_JIRA_CLOUD_URL"),
        username=_required("REAL_JIRA_CLOUD_EMAIL"),
        encrypted_token=_required("REAL_JIRA_CLOUD_API_TOKEN"),
        xray_cloud_client_id=_required("REAL_XRAY_CLOUD_CLIENT_ID"),
        encrypted_xray_cloud_client_secret=security.encrypt_credential(_required("REAL_XRAY_CLOUD_CLIENT_SECRET")),
    )

    token = XrayCloudClient(conn)._get_token()

    assert token
