from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api import deps
from app.core.audit import log_audit
from app.models.audit import AuditLog
from app.models.jira import JiraConnection
from app.models.job import Job
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole, WorkspaceTemplate, WorkspaceTemplateAssignment
from app.schemas.jira import JiraConnectionResponse
from app.schemas.workspace import (
    WorkspaceCreate, WorkspaceResponse, WorkspaceDetailResponse,
    WorkspaceAuditLogResponse,
    WorkspaceMemberResponse,
    WorkspaceMemberUpdate,
    WorkspaceTemplateCreate,
    WorkspaceTemplateAssignmentCreate,
    WorkspaceTemplateAssignmentResponse,
    WorkspaceTemplateAssignmentUpdate,
    WorkspaceTemplateResponse,
    WorkspaceTemplateUpdate,
    WorkspaceUsageResponse,
)
from app.core.rbac import Action, check_permission

router = APIRouter()

@router.post("/", response_model=WorkspaceResponse)
def create_workspace(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    workspace_in: WorkspaceCreate
):
    # Create workspace
    workspace = Workspace(name=workspace_in.name, owner_id=current_user.id)
    db.add(workspace)
    db.flush() # Get ID
    
    # Add owner as member
    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=current_user.id,
        role=WorkspaceRole.OWNER
    )
    db.add(member)
    
    # Set as default if user has none
    if current_user.default_workspace_id is None:
        current_user.default_workspace_id = workspace.id
        db.add(current_user)
        
    db.commit()
    db.refresh(workspace)
    response = WorkspaceResponse.model_validate(workspace)
    response.role = WorkspaceRole.OWNER
    return response

@router.get("/", response_model=List[WorkspaceResponse])
def list_workspaces(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    memberships = db.query(WorkspaceMember).join(Workspace).filter(
        WorkspaceMember.user_id == current_user.id
    ).all()
    responses = []
    for membership in memberships:
        response = WorkspaceResponse.model_validate(membership.workspace)
        response.role = membership.role
        responses.append(response)
    return responses

@router.get("/{workspace_id}", response_model=WorkspaceDetailResponse)
def get_workspace(
    workspace_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if not check_permission(db, current_user.id, workspace_id, Action.WORKSPACE_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
        
    # Build response manually to include members with emails
    members = []
    for m in workspace.members:
        member_resp = WorkspaceMemberResponse.model_validate(m)
        member_resp.email = m.user.email
        members.append(member_resp)
        
    # Templates
    templates = workspace.templates if hasattr(workspace, "templates") else []
    
    return {
        "id": workspace.id,
        "name": workspace.name,
        "owner_id": workspace.owner_id,
        "role": get_workspace_role(db, current_user.id, workspace_id),
        "created_at": workspace.created_at,
        "updated_at": workspace.updated_at,
        "members": members,
        "templates": templates,
        "template_assignments": workspace.template_assignments if hasattr(workspace, "template_assignments") else [],
    }


def get_workspace_role(db: Session, user_id: int, workspace_id: int) -> Optional[WorkspaceRole]:
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id,
    ).first()
    return member.role if member else None

@router.post("/{workspace_id}/members", response_model=WorkspaceMemberResponse)
def add_workspace_member(
    workspace_id: int,
    email: str,
    role: WorkspaceRole = WorkspaceRole.VIEWER,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if not check_permission(db, current_user.id, workspace_id, Action.MEMBERS_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    # Check if user exists
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User with this email not found")
    
    # Check if already a member
    existing = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already a member")
        
    member = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=user.id,
        role=role
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    
    resp = WorkspaceMemberResponse.model_validate(member)
    resp.email = user.email
    return resp

@router.delete("/{workspace_id}/members/{user_id}", status_code=204)
def remove_workspace_member(
    workspace_id: int,
    user_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if not check_permission(db, current_user.id, workspace_id, Action.MEMBERS_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    if member.role == WorkspaceRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot remove owner")
        
    db.delete(member)
    db.commit()
    return None

@router.put("/{workspace_id}/members/{user_id}", response_model=WorkspaceMemberResponse)
def update_member_role(
    workspace_id: int,
    user_id: int,
    member_in: WorkspaceMemberUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if not check_permission(db, current_user.id, workspace_id, Action.MEMBERS_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    if member.role == WorkspaceRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot change owner role")
        
    member.role = member_in.role
    db.add(member)
    db.commit()
    db.refresh(member)
    
    resp = WorkspaceMemberResponse.model_validate(member)
    resp.email = member.user.email
    return resp

@router.post("/{workspace_id}/activate")
def set_active_workspace(
    workspace_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    if not check_permission(db, current_user.id, workspace_id, Action.WORKSPACE_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
        
    current_user.default_workspace_id = workspace_id
    db.add(current_user)
    db.commit()
    return {"status": "success"}


@router.get("/{workspace_id}/templates", response_model=List[WorkspaceTemplateResponse])
def list_workspace_templates(
    workspace_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.WORKSPACE_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return db.query(WorkspaceTemplate).filter(WorkspaceTemplate.workspace_id == workspace_id).order_by(WorkspaceTemplate.id.asc()).all()


@router.post("/{workspace_id}/templates", response_model=WorkspaceTemplateResponse)
def create_workspace_template(
    workspace_id: int,
    template_in: WorkspaceTemplateCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.TEMPLATES_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    template = WorkspaceTemplate(
        workspace_id=workspace_id,
        name=template_in.name,
        template_type=template_in.template_type,
        content=template_in.content,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    log_audit("workspace.template_create", current_user.id, workspace_id=workspace_id, db=db, template_id=template.id)
    return template


@router.put("/{workspace_id}/templates/{template_id}", response_model=WorkspaceTemplateResponse)
def update_workspace_template(
    workspace_id: int,
    template_id: int,
    template_in: WorkspaceTemplateUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.TEMPLATES_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    template = db.query(WorkspaceTemplate).filter(
        WorkspaceTemplate.workspace_id == workspace_id,
        WorkspaceTemplate.id == template_id,
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    update_data = template_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(template, field, value)
    db.add(template)
    db.commit()
    db.refresh(template)
    log_audit("workspace.template_update", current_user.id, workspace_id=workspace_id, db=db, template_id=template.id)
    return template


@router.delete("/{workspace_id}/templates/{template_id}", status_code=204)
def delete_workspace_template(
    workspace_id: int,
    template_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.TEMPLATES_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    template = db.query(WorkspaceTemplate).filter(
        WorkspaceTemplate.workspace_id == workspace_id,
        WorkspaceTemplate.id == template_id,
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(template)
    db.commit()
    log_audit("workspace.template_delete", current_user.id, workspace_id=workspace_id, db=db, template_id=template_id)
    return None


@router.get("/{workspace_id}/template-assignments", response_model=List[WorkspaceTemplateAssignmentResponse])
def list_template_assignments(
    workspace_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.WORKSPACE_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return (
        db.query(WorkspaceTemplateAssignment)
        .filter(WorkspaceTemplateAssignment.workspace_id == workspace_id)
        .order_by(WorkspaceTemplateAssignment.is_default.desc(), WorkspaceTemplateAssignment.id.asc())
        .all()
    )


def _validate_template_for_workspace(db: Session, workspace_id: int, template_id: int) -> WorkspaceTemplate:
    template = db.query(WorkspaceTemplate).filter(
        WorkspaceTemplate.workspace_id == workspace_id,
        WorkspaceTemplate.id == template_id,
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found in workspace")
    return template


@router.post("/{workspace_id}/template-assignments", response_model=WorkspaceTemplateAssignmentResponse)
def create_template_assignment(
    workspace_id: int,
    assignment_in: WorkspaceTemplateAssignmentCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.TEMPLATES_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    _validate_template_for_workspace(db, workspace_id, assignment_in.template_id)
    assignment = WorkspaceTemplateAssignment(
        workspace_id=workspace_id,
        template_id=assignment_in.template_id,
        project_key=assignment_in.project_key or None,
        issue_type_id=assignment_in.issue_type_id or None,
        workflow=assignment_in.workflow or None,
        is_default=assignment_in.is_default,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    log_audit("workspace.template_assignment_create", current_user.id, workspace_id=workspace_id, db=db, assignment_id=assignment.id)
    return assignment


@router.put("/{workspace_id}/template-assignments/{assignment_id}", response_model=WorkspaceTemplateAssignmentResponse)
def update_template_assignment(
    workspace_id: int,
    assignment_id: int,
    assignment_in: WorkspaceTemplateAssignmentUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.TEMPLATES_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    assignment = db.query(WorkspaceTemplateAssignment).filter(
        WorkspaceTemplateAssignment.workspace_id == workspace_id,
        WorkspaceTemplateAssignment.id == assignment_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Template assignment not found")
    update_data = assignment_in.model_dump(exclude_unset=True)
    if "template_id" in update_data and update_data["template_id"] is not None:
        _validate_template_for_workspace(db, workspace_id, update_data["template_id"])
    for field, value in update_data.items():
        if field in ["project_key", "issue_type_id", "workflow"]:
            setattr(assignment, field, value or None)
        else:
            setattr(assignment, field, value)
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    log_audit("workspace.template_assignment_update", current_user.id, workspace_id=workspace_id, db=db, assignment_id=assignment.id)
    return assignment


@router.delete("/{workspace_id}/template-assignments/{assignment_id}", status_code=204)
def delete_template_assignment(
    workspace_id: int,
    assignment_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.TEMPLATES_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    assignment = db.query(WorkspaceTemplateAssignment).filter(
        WorkspaceTemplateAssignment.workspace_id == workspace_id,
        WorkspaceTemplateAssignment.id == assignment_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Template assignment not found")
    db.delete(assignment)
    db.commit()
    log_audit("workspace.template_assignment_delete", current_user.id, workspace_id=workspace_id, db=db, assignment_id=assignment_id)
    return None


@router.get("/{workspace_id}/connections", response_model=List[JiraConnectionResponse])
def list_workspace_connections(
    workspace_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.WORKSPACE_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return db.query(JiraConnection).filter(
        JiraConnection.workspace_id == workspace_id,
        JiraConnection.is_shared == True,
    ).order_by(JiraConnection.id.asc()).all()


@router.post("/{workspace_id}/connections/{conn_id}/share", response_model=JiraConnectionResponse)
def share_connection_with_workspace(
    workspace_id: int,
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.CONNECTIONS_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.user_id == current_user.id,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Personal Jira connection not found")
    conn.workspace_id = workspace_id
    conn.is_shared = True
    db.add(conn)
    db.commit()
    db.refresh(conn)
    log_audit("workspace.connection_share", current_user.id, workspace_id=workspace_id, db=db, connection_id=conn.id)
    return conn


@router.delete("/{workspace_id}/connections/{conn_id}/share", response_model=JiraConnectionResponse)
def unshare_connection_from_workspace(
    workspace_id: int,
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.CONNECTIONS_MANAGE):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.workspace_id == workspace_id,
        JiraConnection.is_shared == True,
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Shared Jira connection not found")
    if conn.user_id != current_user.id and get_workspace_role(db, current_user.id, workspace_id) != WorkspaceRole.OWNER:
        raise HTTPException(status_code=403, detail="Only the connection owner or workspace owner can unshare this connection")
    conn.workspace_id = None
    conn.is_shared = False
    db.add(conn)
    db.commit()
    db.refresh(conn)
    log_audit("workspace.connection_unshare", current_user.id, workspace_id=workspace_id, db=db, connection_id=conn.id)
    return conn


@router.get("/{workspace_id}/audit-logs", response_model=List[WorkspaceAuditLogResponse])
def list_workspace_audit_logs(
    workspace_id: int,
    limit: int = 50,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.AUDIT_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    rows = db.query(AuditLog).filter(AuditLog.workspace_id == workspace_id).order_by(AuditLog.created_at.desc()).limit(max(1, min(limit, 200))).all()
    return [
        WorkspaceAuditLogResponse(
            id=row.id,
            user_id=row.user_id,
            action=row.action,
            metadata=row.event_metadata or {},
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/{workspace_id}/usage", response_model=WorkspaceUsageResponse)
def get_workspace_usage(
    workspace_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    if not check_permission(db, current_user.id, workspace_id, Action.AUDIT_READ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return WorkspaceUsageResponse(
        workspace_id=workspace_id,
        members_count=db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == workspace_id).count(),
        templates_count=db.query(WorkspaceTemplate).filter(WorkspaceTemplate.workspace_id == workspace_id).count(),
        shared_connections_count=db.query(JiraConnection).filter(JiraConnection.workspace_id == workspace_id, JiraConnection.is_shared == True).count(),
        jobs_count=db.query(Job).filter(Job.workspace_id == workspace_id).count(),
        audit_events_count=db.query(AuditLog).filter(AuditLog.workspace_id == workspace_id).count(),
    )
