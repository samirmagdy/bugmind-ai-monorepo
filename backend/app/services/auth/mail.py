from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("bugmind.http")


def send_password_reset_code(*, to_email: str, code: str) -> None:
    if not settings.SMTP_HOST or not settings.SMTP_FROM_EMAIL:
        logger.warning("password_reset_email_skipped smtp_not_configured email=%s code=%s", to_email, code)
        return

    message = EmailMessage()
    message["Subject"] = "Your BugMind password reset code"
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = to_email
    message.set_content(
        "\n".join(
            [
                "Use the following code to reset your BugMind password:",
                "",
                code,
                "",
                f"This code expires in {settings.PASSWORD_RESET_CODE_EXPIRE_MINUTES} minutes.",
                "If you did not request this, you can ignore this email.",
            ]
        )
    )

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
        if settings.SMTP_USE_TLS:
            smtp.starttls()
        if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
            smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        smtp.send_message(message)
