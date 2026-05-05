from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceRole
from app.schemas.workspace import (
    WorkspaceCreate, WorkspaceResponse, WorkspaceDetailResponse,
    WorkspaceMemberResponse, WorkspaceMemberUpdate
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
    return workspace

@router.get("/", response_model=List[WorkspaceResponse])
def list_workspaces(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    workspaces = db.query(Workspace).join(WorkspaceMember).filter(
        WorkspaceMember.user_id == current_user.id
    ).all()
    return workspaces

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
        member_resp = WorkspaceMemberResponse.from_orm(m)
        member_resp.email = m.user.email
        members.append(member_resp)
        
    # Templates
    templates = workspace.templates if hasattr(workspace, "templates") else []
    
    return {
        "id": workspace.id,
        "name": workspace.name,
        "owner_id": workspace.owner_id,
        "created_at": workspace.created_at,
        "updated_at": workspace.updated_at,
        "members": members,
        "templates": templates
    }

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
    
    resp = WorkspaceMemberResponse.from_orm(member)
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
    
    resp = WorkspaceMemberResponse.from_orm(member)
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
