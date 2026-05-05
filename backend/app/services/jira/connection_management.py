from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core import security
from app.core.audit import log_audit
from app.core.request_security import enforce_secure_jira_ssl, validate_connection_host
from app.models.jira import JiraConnection
from app.models.user import User
from app.schemas.jira import JiraConnectionCreate, JiraConnectionUpdate
from app.services.jira.connection_service import verify_connection_credentials


from sqlalchemy import or_, and_
from app.models.workspace import WorkspaceMember

def list_user_connections(db: Session, current_user: User) -> list[JiraConnection]:
    # Fetch personal connections
    # OR connections shared in workspaces where user is a member
    return db.query(JiraConnection).outerjoin(
        WorkspaceMember, JiraConnection.workspace_id == WorkspaceMember.workspace_id
    ).filter(
        or_(
            JiraConnection.user_id == current_user.id,
            and_(
                JiraConnection.is_shared == True,
                WorkspaceMember.user_id == current_user.id
            )
        )
    ).order_by(JiraConnection.is_active.desc(), JiraConnection.id.asc()).distinct().all()


def create_user_connection(db: Session, current_user: User, conn_in: JiraConnectionCreate) -> JiraConnection:
    if not conn_in.token or not conn_in.token.strip():
        raise HTTPException(status_code=400, detail="API Token cannot be empty")
    enforce_secure_jira_ssl(conn_in.verify_ssl)
    safe_host_url = validate_connection_host(conn_in.host_url, conn_in.auth_type.value)
    verify_connection_credentials(conn_in.auth_type, safe_host_url, conn_in.username, conn_in.token, conn_in.verify_ssl)

    encrypted = security.encrypt_credential(conn_in.token)
    db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).update(
        {JiraConnection.is_active: False},
        synchronize_session=False,
    )
    conn = JiraConnection(
        user_id=current_user.id,
        auth_type=conn_in.auth_type,
        host_url=safe_host_url,
        username=conn_in.username,
        encrypted_token=encrypted,
        verify_ssl=conn_in.verify_ssl,
        is_active=True,
        xray_cloud_client_id=conn_in.xray_cloud_client_id,
        encrypted_xray_cloud_client_secret=security.encrypt_credential(conn_in.xray_cloud_client_secret) if conn_in.xray_cloud_client_secret else None,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    log_audit("jira.connection_create", current_user.id, db=db, connection_id=conn.id, host_url=conn.host_url)
    return conn


def update_user_connection(db: Session, current_user: User, conn_id: int, conn_in: JiraConnectionUpdate) -> JiraConnection:
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    update_data = conn_in.model_dump(exclude_unset=True)
    effective_auth_type = update_data.get("auth_type", conn.auth_type)
    effective_verify_ssl = update_data.get("verify_ssl", conn.verify_ssl)
    effective_host_url = conn.host_url
    effective_username = update_data.get("username", conn.username)
    effective_token = None

    if "verify_ssl" in update_data and update_data["verify_ssl"] is not None:
        enforce_secure_jira_ssl(update_data["verify_ssl"])
    if "host_url" in update_data and update_data["host_url"]:
        update_data["host_url"] = validate_connection_host(update_data["host_url"], effective_auth_type.value)
        effective_host_url = update_data["host_url"]
    if "token" in update_data:
        token_val = update_data.pop("token")
        if token_val and token_val.strip():
            update_data["encrypted_token"] = security.encrypt_credential(token_val)
            effective_token = token_val.strip()
    
    if "xray_cloud_client_secret" in update_data:
        xray_secret = update_data.pop("xray_cloud_client_secret")
        if xray_secret and xray_secret.strip():
            update_data["encrypted_xray_cloud_client_secret"] = security.encrypt_credential(xray_secret)
        elif xray_secret == "":
            update_data["encrypted_xray_cloud_client_secret"] = None

    should_verify = any(key in update_data for key in ("auth_type", "host_url", "username", "verify_ssl", "encrypted_token"))
    if should_verify:
        if effective_token is None:
            effective_token = security.decrypt_credential(conn.encrypted_token)
        verify_connection_credentials(
            effective_auth_type,
            effective_host_url,
            effective_username,
            effective_token,
            effective_verify_ssl,
        )

    if update_data.get("is_active") is True:
        db.query(JiraConnection).filter(
            JiraConnection.user_id == current_user.id,
            JiraConnection.id != conn_id,
        ).update({JiraConnection.is_active: False}, synchronize_session=False)

    for field, value in update_data.items():
        setattr(conn, field, value)

    db.add(conn)
    db.commit()
    db.refresh(conn)
    log_audit("jira.connection_update", current_user.id, db=db, connection_id=conn_id)
    return conn


def delete_user_connection(db: Session, current_user: User, conn_id: int) -> None:
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    was_active = bool(conn.is_active)
    db.delete(conn)
    if was_active:
        replacement = db.query(JiraConnection).filter(
            JiraConnection.user_id == current_user.id,
        ).order_by(JiraConnection.id.asc()).first()
        if replacement:
            replacement.is_active = True
            db.add(replacement)
    db.commit()
    log_audit("jira.connection_delete", current_user.id, db=db, connection_id=conn_id)
