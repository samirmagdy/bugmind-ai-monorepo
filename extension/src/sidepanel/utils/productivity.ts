import { ActivityFeedItem, MainWorkflow, TabSession, ToastHistoryItem, WorkflowPreset } from '../types';

export function makeLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function addActivity(session: TabSession, item: Omit<ActivityFeedItem, 'id' | 'createdAt'>): ActivityFeedItem[] {
  return [
    {
      id: makeLocalId('activity'),
      createdAt: Date.now(),
      issueKey: session.issueData?.key,
      ...item
    },
    ...(session.activityFeed || [])
  ].slice(0, 25);
}

export function addToast(session: TabSession, item: Omit<ToastHistoryItem, 'id' | 'createdAt'>): ToastHistoryItem[] {
  return [
    {
      id: makeLocalId('toast'),
      createdAt: Date.now(),
      ...item
    },
    ...(session.toastHistory || [])
  ].slice(0, 20);
}

export function createPresetFromSession(session: TabSession, name: string): WorkflowPreset {
  return {
    id: makeLocalId('preset'),
    name,
    workflow: session.mainWorkflow === 'home' ? 'tests' : session.mainWorkflow,
    bugGenerationCount: session.bugGenerationCount,
    testGenerationTypes: [...(session.testGenerationTypes || [])],
    selectedIssueTypeId: session.selectedIssueType?.id || null,
    xrayTargetProjectId: session.xrayTargetProjectId,
    xrayFolderPath: session.xrayFolderPath,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function getWorkflowLabel(workflow: MainWorkflow): string {
  switch (workflow) {
    case 'manual':
      return 'I Found a Bug';
    case 'analysis':
      return 'AI Gap Analysis';
    case 'tests':
      return 'Generate Test Cases';
    case 'bulk':
      return 'Bulk Epic Workflows';
    case 'home':
    default:
      return 'Workflow Home';
  }
}

export function getDraftStatus(session: TabSession): { label: string; tone: 'success' | 'warning' | 'danger' | 'info'; detail: string } {
  if (session.createdIssues.length > 0) {
    return {
      label: 'Published',
      tone: 'success',
      detail: `${session.createdIssues.length} Jira issue${session.createdIssues.length === 1 ? '' : 's'} created.`
    };
  }
  if (session.validationErrors.length > 0) {
    return {
      label: 'Needs Fields',
      tone: 'danger',
      detail: `${session.validationErrors.length} required field${session.validationErrors.length === 1 ? '' : 's'} missing.`
    };
  }
  if (session.bugs.length > 0) {
    const edited = session.bugs.filter((bug) => bug.edited).length;
    return {
      label: edited ? 'Edited Draft' : 'Draft Ready',
      tone: edited ? 'warning' : 'info',
      detail: `${session.bugs.length} bug draft${session.bugs.length === 1 ? '' : 's'} ready.`
    };
  }
  if (session.testCases.length > 0) {
    const selected = session.testCases.filter((testCase) => testCase.selected !== false).length;
    return {
      label: 'Test Draft',
      tone: 'info',
      detail: `${selected}/${session.testCases.length} selected for publish.`
    };
  }
  return {
    label: 'No Draft',
    tone: 'warning',
    detail: 'Start a workflow to create a recoverable draft.'
  };
}

export function getQualityWarnings(session: TabSession): Array<{ title: string; detail: string; tone: 'warning' | 'danger' | 'info' }> {
  const warnings: Array<{ title: string; detail: string; tone: 'warning' | 'danger' | 'info' }> = [];
  const issue = session.issueData;
  const acceptanceCriteria = issue?.acceptanceCriteria?.trim() || '';
  const description = issue?.description?.trim() || '';

  if (!issue) {
    warnings.push({ title: 'Jira context missing', detail: 'Open a Jira issue before generating or publishing.', tone: 'danger' });
  } else {
    if (description.length < 80) warnings.push({ title: 'Short story description', detail: 'Generation may miss edge cases without more context.', tone: 'warning' });
    if (acceptanceCriteria.length < 48) warnings.push({ title: 'Weak acceptance criteria', detail: 'Add or map acceptance criteria for stronger tests and gap analysis.', tone: 'warning' });
    if (!session.selectedIssueType && session.mainWorkflow !== 'manual') warnings.push({ title: 'Issue type not selected', detail: 'Jira metadata is still loading or needs setup.', tone: 'info' });
  }

  if (session.jiraCapabilityProfile) {
    if (!session.jiraCapabilityProfile.permissions.canCreateIssues) {
      warnings.push({ title: 'Create permission missing', detail: 'Your Jira profile cannot create target issues.', tone: 'danger' });
    }
    const missing = session.jiraCapabilityProfile.readiness.missingRequiredFields || [];
    if (missing.length > 0) {
      warnings.push({ title: 'Xray defaults incomplete', detail: `Missing defaults: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`, tone: 'warning' });
    }
  }

  if (session.duplicateMatches.some((match) => match.confidence === 'high')) {
    warnings.push({ title: 'High duplicate risk', detail: 'A similar Jira issue was found. Review before publishing.', tone: 'warning' });
  }

  return warnings.slice(0, 5);
}
