from sqlalchemy.orm import Session
from app.models.workspace import WorkspaceMember, WorkspaceRole

# Permission actions
class Action:
    WORKSPACE_READ = "workspace.read"
    WORKSPACE_UPDATE = "workspace.update"
    MEMBERS_MANAGE = "members.manage"
    CONNECTIONS_MANAGE = "connections.manage"
    MAPPINGS_MANAGE = "mappings.manage"
    TEMPLATES_MANAGE = "templates.manage"
    AI_GENERATE = "ai.generate"
    PUBLISH = "publish"
    AUDIT_READ = "audit.read"

# Role to Actions mapping
ROLE_PERMISSIONS = {
    WorkspaceRole.OWNER: [
        Action.WORKSPACE_READ, Action.WORKSPACE_UPDATE, Action.MEMBERS_MANAGE,
        Action.CONNECTIONS_MANAGE, Action.MAPPINGS_MANAGE, Action.TEMPLATES_MANAGE, Action.AI_GENERATE,
        Action.PUBLISH, Action.AUDIT_READ
    ],
    WorkspaceRole.ADMIN: [
        Action.WORKSPACE_READ, Action.WORKSPACE_UPDATE, Action.MEMBERS_MANAGE,
        Action.CONNECTIONS_MANAGE, Action.MAPPINGS_MANAGE, Action.TEMPLATES_MANAGE, Action.AI_GENERATE,
        Action.PUBLISH, Action.AUDIT_READ
    ],
    WorkspaceRole.QA_LEAD: [
        Action.WORKSPACE_READ, Action.MAPPINGS_MANAGE, Action.TEMPLATES_MANAGE, Action.AI_GENERATE,
        Action.PUBLISH, Action.AUDIT_READ
    ],
    WorkspaceRole.QA_ENGINEER: [
        Action.WORKSPACE_READ, Action.AI_GENERATE
    ],
    WorkspaceRole.VIEWER: [
        Action.WORKSPACE_READ
    ]
}

def check_permission(db: Session, user_id: int, workspace_id: int, action: str) -> bool:
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    
    if not member:
        return False
        
    allowed_actions = ROLE_PERMISSIONS.get(member.role, [])
    return action in allowed_actions

def get_user_workspace_role(db: Session, user_id: int, workspace_id: int) -> Optional[WorkspaceRole]:
    member = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == workspace_id,
        WorkspaceMember.user_id == user_id
    ).first()
    return member.role if member else None
