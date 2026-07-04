#!/usr/bin/env python3
"""Strict production readiness gate for BugMind AI.

The gate intentionally fails when production-only assets are missing. It should
be run before go-live and after every material production configuration change.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
BACKEND_PYTHON = ROOT / "backend" / ".venv" / "bin" / "python"
DEFAULT_BASE_URL = "https://bugmind-ai-monorepo.onrender.com"
DEFAULT_WEB_SERVICE_ID = "srv-d7j6kfhj2pic73b9mlog"
DEFAULT_WORKER_SERVICE_ID = "srv-d94e2juq1p3s73bfth3g"

REAL_TENANT_ENV = [
    "RUN_REAL_TENANT_CONTRACTS",
    "REAL_JIRA_CLOUD_URL",
    "REAL_JIRA_CLOUD_EMAIL",
    "REAL_JIRA_CLOUD_API_TOKEN",
    "REAL_JIRA_SERVER_URL",
    "REAL_JIRA_SERVER_USERNAME",
    "REAL_JIRA_SERVER_TOKEN",
    "REAL_XRAY_CLOUD_CLIENT_ID",
    "REAL_XRAY_CLOUD_CLIENT_SECRET",
]

SECRET_PATTERNS = [
    ("Stripe live secret", re.compile(r"sk_live_[A-Za-z0-9]{8,}")),
    ("Stripe test secret", re.compile(r"sk_test_[A-Za-z0-9]{8,}")),
    ("Stripe webhook secret", re.compile(r"whsec_[A-Za-z0-9]{8,}")),
    ("OpenRouter key", re.compile(r"sk-or-v1-[A-Za-z0-9_-]{16,}")),
    ("Postgres URL with password", re.compile(r"postgres(?:ql)?://[^:\s]+:[^@\s]+@")),
    ("Redis URL with password", re.compile(r"redis://[^:\s]+:[^@\s]+@")),
]


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str


class Gate:
    def __init__(self) -> None:
        self.results: list[CheckResult] = []

    def pass_(self, name: str, detail: str = "") -> None:
        self.results.append(CheckResult(name, "PASS", detail))

    def fail(self, name: str, detail: str) -> None:
        self.results.append(CheckResult(name, "FAIL", detail))

    def block(self, name: str, detail: str) -> None:
        self.results.append(CheckResult(name, "BLOCKED", detail))

    def has_failures(self) -> bool:
        return any(result.status in {"FAIL", "BLOCKED"} for result in self.results)

    def print_summary(self) -> None:
        for result in self.results:
            suffix = f" - {result.detail}" if result.detail else ""
            print(f"[{result.status}] {result.name}{suffix}")


def run_command(gate: Gate, name: str, command: list[str], cwd: Path = ROOT, timeout: int = 240) -> None:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        gate.fail(name, f"command not found: {exc.filename}")
        return
    except subprocess.TimeoutExpired:
        gate.fail(name, f"timed out after {timeout}s")
        return

    if completed.returncode == 0:
        gate.pass_(name)
        return

    output = "\n".join(
        line
        for line in (completed.stdout + "\n" + completed.stderr).splitlines()[-20:]
        if line.strip()
    )
    gate.fail(name, output or f"exit code {completed.returncode}")


def command_json(command: list[str], cwd: Path = ROOT, timeout: int = 120) -> tuple[int, dict | list | None, str]:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except Exception as exc:  # pragma: no cover - diagnostic path
        return 1, None, str(exc)

    raw = completed.stdout or completed.stderr
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    return completed.returncode, parsed, raw


def read_render_api_key() -> str | None:
    if os.getenv("RENDER_API_KEY"):
        return os.environ["RENDER_API_KEY"]

    config = Path.home() / ".render" / "cli.yaml"
    if not config.exists():
        return None

    text = config.read_text(encoding="utf-8", errors="ignore")
    in_api_section = False
    for line in text.splitlines():
        if line.startswith("api:"):
            in_api_section = True
            continue
        if in_api_section and line and not line.startswith(" "):
            in_api_section = False
        if in_api_section and line.strip().startswith("key:"):
            key = line.split(":", 1)[1].strip().strip('"').strip("'")
            return key or None
    return None


def render_env(service_id: str, api_key: str) -> dict[str, str]:
    request = urllib.request.Request(
        f"https://api.render.com/v1/services/{service_id}/env-vars?limit=100",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    env: dict[str, str] = {}
    for item in payload:
        env_var = item.get("envVar", item)
        key = env_var.get("key")
        value = env_var.get("value")
        if key:
            env[key] = "" if value is None else str(value)
    return env


def is_valid_fernet_key(value: str) -> bool:
    try:
        return len(base64.urlsafe_b64decode(value.encode("utf-8"))) == 32
    except Exception:
        return False


def missing_or_placeholder(value: str | None) -> bool:
    if not value:
        return True
    lowered = value.lower()
    return any(marker in lowered for marker in ("changeme", "replace", "your-", "example", "placeholder"))


def require_keys(
    gate: Gate,
    env: dict[str, str],
    label: str,
    keys: Iterable[str],
) -> None:
    missing = [key for key in keys if missing_or_placeholder(env.get(key))]
    if missing:
        gate.block(f"{label} required env vars", ", ".join(missing))
    else:
        gate.pass_(f"{label} required env vars")


def check_render(gate: Gate, args: argparse.Namespace) -> None:
    api_key = read_render_api_key()
    if not api_key:
        gate.block("Render env inspection", "set RENDER_API_KEY or run `render login`")
        return

    try:
        web = render_env(args.web_service_id, api_key)
        worker = render_env(args.worker_service_id, api_key)
    except urllib.error.HTTPError as exc:
        gate.fail("Render env inspection", f"Render API returned {exc.code}")
        return
    except Exception as exc:
        gate.fail("Render env inspection", str(exc))
        return

    require_keys(
        gate,
        web,
        "Render web",
        [
            "SECRET_KEY",
            "ENCRYPTION_KEY",
            "DATABASE_URL",
            "DATABASE_EXTERNAL_URL",
            "REDIS_URL",
            "OPENROUTER_API_KEY",
            "GOOGLE_OAUTH_CLIENT_ID",
            "CORS_ORIGINS",
            "ALLOWED_HOSTS",
            "EXTENSION_ORIGINS",
            "MONITORING_SECRET_TOKEN",
        ],
    )
    require_keys(
        gate,
        worker,
        "Render worker",
        ["SECRET_KEY", "ENCRYPTION_KEY", "DATABASE_URL", "DATABASE_EXTERNAL_URL", "REDIS_URL", "OPENROUTER_API_KEY"],
    )

    if len(web.get("SECRET_KEY", "")) >= 48 and web.get("SECRET_KEY") == worker.get("SECRET_KEY"):
        gate.pass_("Render SECRET_KEY strength/consistency")
    else:
        gate.fail("Render SECRET_KEY strength/consistency", "must be >=48 chars and identical on web/worker")

    if is_valid_fernet_key(web.get("ENCRYPTION_KEY", "")) and web.get("ENCRYPTION_KEY") == worker.get("ENCRYPTION_KEY"):
        gate.pass_("Render ENCRYPTION_KEY format/consistency")
    else:
        gate.fail("Render ENCRYPTION_KEY format/consistency", "must be a valid Fernet key and identical on web/worker")

    for key, expected in {
        "ENVIRONMENT": "production",
        "RATE_LIMITS_ENABLED": "true",
        "ALLOW_PRIVATE_JIRA_HOSTS": "false",
        "ALLOW_INSECURE_JIRA_SSL": "false",
    }.items():
        if web.get(key) == expected and worker.get(key) == expected:
            gate.pass_(f"Render {key}")
        else:
            gate.fail(f"Render {key}", f"expected {expected} on web and worker")

    google_client_id = web.get("GOOGLE_OAUTH_CLIENT_ID", "")
    if google_client_id.endswith(".apps.googleusercontent.com"):
        gate.pass_("Google OAuth client ID")
    else:
        gate.block("Google OAuth client ID", "set GOOGLE_OAUTH_CLIENT_ID to the production Google OAuth client ID")

    stripe_checks = {
        "STRIPE_SECRET_KEY": lambda value: value.startswith("sk_live_"),
        "STRIPE_WEBHOOK_SECRET": lambda value: value.startswith("whsec_"),
        "STRIPE_PRO_PRICE_ID": lambda value: value.startswith("price_"),
        "STRIPE_BILLING_SUCCESS_URL": lambda value: value.startswith("https://"),
        "STRIPE_BILLING_CANCEL_URL": lambda value: value.startswith("https://"),
        "STRIPE_CUSTOMER_PORTAL_RETURN_URL": lambda value: value.startswith("https://"),
    }
    stripe_bad = [key for key, predicate in stripe_checks.items() if not predicate(web.get(key, ""))]
    if stripe_bad:
        gate.block("Stripe live configuration", ", ".join(stripe_bad))
    else:
        gate.pass_("Stripe live configuration")

    ext_origins = web.get("EXTENSION_ORIGINS", "")
    if re.search(r"chrome-extension://[a-p]{32}$", ext_origins):
        gate.pass_("Chrome extension production origin")
    else:
        gate.block("Chrome extension production origin", "set EXTENSION_ORIGINS to the Chrome Web Store extension ID")

    if web.get("MONITORING_SECRET_TOKEN") and (
        web.get("ALERT_WEBHOOK_URL") or (web.get("ALERT_EMAIL_RECIPIENTS") and web.get("SMTP_HOST") and web.get("SMTP_PASSWORD"))
    ):
        gate.pass_("Monitoring protection and alert channel")
    else:
        gate.block("Monitoring protection and alert channel", "set MONITORING_SECRET_TOKEN and Slack/webhook or SMTP alerting")

    if args.custom_domain:
        allowed_hosts = web.get("ALLOWED_HOSTS", "")
        cors_origins = web.get("CORS_ORIGINS", "")
        if args.custom_domain in allowed_hosts and args.custom_domain in cors_origins:
            gate.pass_("Custom domain env allowlists")
        else:
            gate.block("Custom domain env allowlists", f"{args.custom_domain} must be in ALLOWED_HOSTS and CORS_ORIGINS")
    else:
        gate.block("Custom domain", "set PRODUCTION_CUSTOM_DOMAIN or pass --custom-domain")


def check_live_health(gate: Gate, base_url: str) -> None:
    for path in ("/health", "/health/db", "/health/ai", "/metrics"):
        url = f"{base_url.rstrip('/')}{path}"
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                body = response.read().decode("utf-8", errors="ignore")
                status_code = response.getcode()
        except Exception as exc:
            gate.fail(f"Live {path}", str(exc))
            continue

        if status_code != 200:
            gate.fail(f"Live {path}", f"HTTP {status_code}")
            continue

        if path == "/health/ai":
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                gate.fail("Live /health/ai", "non-JSON response")
                continue
            if payload.get("status") == "ok":
                gate.pass_("Live /health/ai")
            else:
                gate.block("Live /health/ai", body[:300])
        else:
            gate.pass_(f"Live {path}")

    google_config_url = f"{base_url.rstrip('/')}/api/v1/auth/google/config"
    try:
        with urllib.request.urlopen(google_config_url, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8", errors="ignore"))
    except Exception as exc:
        gate.fail("Live Google auth config", str(exc))
        return

    client_id = str(payload.get("client_id") or "")
    if payload.get("enabled") is True and client_id.endswith(".apps.googleusercontent.com"):
        gate.pass_("Live Google auth config")
    else:
        gate.block("Live Google auth config", "Google sign-in is disabled or GOOGLE_OAUTH_CLIENT_ID is invalid")


def check_secret_scan(gate: Gate) -> None:
    findings: list[str] = []
    try:
        tracked = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=ROOT,
            capture_output=True,
            check=True,
        ).stdout.split(b"\0")
    except subprocess.CalledProcessError as exc:
        gate.fail("Secret scan", f"git ls-files failed: {exc}")
        return

    for raw_path in tracked:
        if not raw_path:
            continue
        path = ROOT / raw_path.decode("utf-8")
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".db"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if any(marker in line for marker in ("<password>", "<user>", "<username>", "...", "[^")):
                continue
            for label, pattern in SECRET_PATTERNS:
                if pattern.search(line):
                    findings.append(f"{path.relative_to(ROOT)}:{line_number}: {label}")
                    break

    if findings:
        gate.fail("Secret scan", "; ".join(findings[:20]))
    else:
        gate.pass_("Secret scan")


def check_audits(gate: Gate) -> None:
    python = str(BACKEND_PYTHON if BACKEND_PYTHON.exists() else sys.executable)
    run_command(
        gate,
        "Backend dependency audit",
        [python, "-m", "pip_audit", "-r", "backend/requirements.txt", "-r", "backend/requirements-dev.txt"],
        timeout=240,
    )

    code, payload, raw = command_json(["npm", "audit", "--json"], cwd=ROOT / "extension", timeout=180)
    vulnerabilities = {}
    if isinstance(payload, dict):
        vulnerabilities = payload.get("metadata", {}).get("vulnerabilities", {})
    if code == 0 and all(vulnerabilities.get(level, 0) == 0 for level in ("critical", "high", "moderate", "low")):
        gate.pass_("Extension dependency audit")
    else:
        gate.fail("Extension dependency audit", raw[-1200:])


def check_local_quality(gate: Gate) -> None:
    python = str(BACKEND_PYTHON if BACKEND_PYTHON.exists() else sys.executable)
    run_command(gate, "Backend tests", [python, "-m", "pytest", "backend/tests"], timeout=600)
    run_command(gate, "Backend compile", [python, "-m", "compileall", "backend/app"], timeout=180)
    run_command(gate, "Extension lint", ["npm", "run", "lint"], cwd=ROOT / "extension", timeout=240)
    run_command(gate, "Extension build", ["npm", "run", "build"], cwd=ROOT / "extension", timeout=240)
    run_command(gate, "Extension Playwright smoke", ["npm", "run", "test:e2e"], cwd=ROOT / "extension", timeout=300)

    manifest = ROOT / "extension" / "dist" / "manifest.json"
    if not manifest.exists():
        gate.fail("Extension package artifact", "extension/dist/manifest.json was not created")
        return
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    if payload.get("manifest_version") == 3 and payload.get("host_permissions") == ["https://*.atlassian.net/*"]:
        gate.pass_("Extension manifest production allowlist")
    else:
        gate.fail("Extension manifest production allowlist", "manifest must be MV3 and restrict host_permissions to Atlassian Cloud")

    permissions = payload.get("permissions") or []
    if "identity" in permissions:
        gate.pass_("Extension Google identity permission")
    else:
        gate.fail("Extension Google identity permission", "manifest must include the Chrome identity permission for Google sign-in")


def check_blueprint(gate: Gate) -> None:
    run_command(gate, "Render Blueprint validation", ["render", "blueprints", "validate", "-o", "json"], timeout=120)


def check_real_tenants(gate: Gate) -> None:
    missing = [key for key in REAL_TENANT_ENV if os.getenv(key) != "true" if key == "RUN_REAL_TENANT_CONTRACTS"]
    missing.extend(key for key in REAL_TENANT_ENV if key != "RUN_REAL_TENANT_CONTRACTS" and not os.getenv(key))
    if missing:
        gate.block("Real Jira/Xray tenant contracts", ", ".join(missing))
        return

    python = str(BACKEND_PYTHON if BACKEND_PYTHON.exists() else sys.executable)
    run_command(
        gate,
        "Real Jira/Xray tenant contracts",
        [python, "-m", "pytest", "backend/tests/test_real_tenant_contracts.py", "-q"],
        timeout=300,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the strict BugMind AI production readiness gate.")
    parser.add_argument("--base-url", default=os.getenv("BUGMIND_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--web-service-id", default=os.getenv("RENDER_WEB_SERVICE_ID", DEFAULT_WEB_SERVICE_ID))
    parser.add_argument("--worker-service-id", default=os.getenv("RENDER_WORKER_SERVICE_ID", DEFAULT_WORKER_SERVICE_ID))
    parser.add_argument("--custom-domain", default=os.getenv("PRODUCTION_CUSTOM_DOMAIN"))
    parser.add_argument("--skip-local", action="store_true", help="Skip local tests/builds. Not acceptable for final go-live.")
    parser.add_argument("--skip-live", action="store_true", help="Skip live Render health checks. Not acceptable for final go-live.")
    parser.add_argument("--skip-render", action="store_true", help="Skip Render env inspection. Not acceptable for final go-live.")
    parser.add_argument("--skip-real-tenants", action="store_true", help="Skip real Jira/Xray contracts. Not acceptable for final go-live.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    gate = Gate()

    if args.skip_local:
        gate.block("Local quality checks", "skipped")
    else:
        check_local_quality(gate)
        check_audits(gate)
        check_secret_scan(gate)
        check_blueprint(gate)

    if args.skip_live:
        gate.block("Live health checks", "skipped")
    else:
        check_live_health(gate, args.base_url)

    if args.skip_render:
        gate.block("Render env inspection", "skipped")
    else:
        check_render(gate, args)

    if args.skip_real_tenants:
        gate.block("Real Jira/Xray tenant contracts", "skipped")
    else:
        check_real_tenants(gate)

    gate.print_summary()
    return 1 if gate.has_failures() else 0


if __name__ == "__main__":
    raise SystemExit(main())
