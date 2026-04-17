export interface BugReport {
  summary: string;
  description: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  severity: string;
  extra_fields?: Record<string, any>;
  // Isolated search state per bug
  userSearchQuery?: string;
  userSearchResults?: any[];
  isSearchingUsers?: boolean;
  activeUserSearchField?: string | null;
  lastSearchedQuery?: string;
}

export interface TabSession {
  view: View;
  loading: boolean;
  error: string | null;
  success: string | null;
  issueData: IssueData | null;
  instanceUrl: string | null; // e.g. https://company.atlassian.net
  bugs: BugReport[];
  expandedBug: number | null;
  manualDesc: string;
  showManualInput: boolean;
  jiraMetadata: JiraMetadata | null;
  issueTypes: IssueType[];
  selectedIssueType: IssueType | null;
  visibleFields: string[];
  aiMapping: Record<string, string>;
  settingsTab: 'ai' | 'jira';
  createdIssues: any[];
  theme: 'light' | 'dark';
  themeSource: 'auto' | 'manual';
  onboardingCompleted: boolean;
}

export interface JiraField {
  key: string;
  name: string;
  type: string;
  required: boolean;
  allowed_values?: any[];
}

export interface JiraMetadata {
  project_id?: string;
  project_key: string;
  issue_type_id?: string;
  fields: JiraField[];
}

export interface IssueType {
  id: string;
  name: string;
  iconUrl?: string;
  subtask: boolean;
}

export interface IssueData {
  key: string;
  projectId: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  typeName: string;
}

export type View = 'auth' | 'setup' | 'main' | 'success' | 'settings';

export const INITIAL_SESSION: TabSession = {
  view: 'main',
  loading: false,
  error: null,
  success: null,
  issueData: null,
  instanceUrl: null,
  bugs: [],
  expandedBug: null,
  manualDesc: '',
  showManualInput: false,
  jiraMetadata: null,
  issueTypes: [],
  selectedIssueType: null,
  visibleFields: [],
  aiMapping: {},
  settingsTab: 'ai',
  createdIssues: [],
  theme: 'dark',
  themeSource: 'auto',
  onboardingCompleted: false
};


export interface DebugLog {
  timestamp: string;
  tag: string;
  msg: string;
}

export interface Usage {
  count: number;
  limit: number;
  remaining: number;
  plan: string;
}

