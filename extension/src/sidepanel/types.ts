export interface JiraUser {
  id: string;
  name: string;
  avatar?: string;
}

export interface JiraFieldOption {
  id: string;
  name?: string;
  value?: string;
  label?: string;
}

export interface CreatedIssue {
  id: string;
  key: string;
  self: string;
}

export interface TestCase {
  title: string;
  steps: string[];
  expected_result: string;
  priority: string;
}

export interface XrayPublishResult {
  created_tests: CreatedIssue[];
  folder_path: string;
  repository_path_field_id?: string | null;
  link_type_used?: string | null;
  warnings: string[];
}

export interface IssueContextPayload {
  issue_key?: string;
  summary: string;
  description: string;
  acceptance_criteria: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface BugReport {
  summary: string;
  description: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  severity: string;
  extra_fields?: Record<string, string | number | boolean | JiraUser | JiraFieldOption | (JiraUser | JiraFieldOption | string)[] | null>;
  // Isolated search state per bug
  userSearchQuery?: string;
  userSearchResults?: JiraUser[];
  isSearchingUsers?: boolean;
  activeUserSearchField?: string | null;
  lastSearchedQuery?: string;
}

export type ResolvedFieldObject = {
  id?: string;
  name?: string;
  value?: string;
  [key: string]: unknown;
};

export type ResolvedFieldValue =
  | string
  | number
  | boolean
  | null
  | ResolvedFieldObject
  | ResolvedFieldObject[];

export interface ResolvedPayload {
  fields: Record<string, ResolvedFieldValue>;
  [key: string]: unknown;
}

export interface MissingField {
  key: string;
  name: string;
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
  testCases: TestCase[];
  coverageScore: number | null;
  manualDesc: string;
  showManualInput: boolean;
  jiraMetadata: JiraMetadata | null;
  issueTypes: IssueType[];
  selectedIssueType: IssueType | null;
  visibleFields: string[];
  aiMapping: Record<string, string>;
  fieldDefaults: Record<string, unknown>;
  settingsTab: 'ai' | 'jira' | 'connections';
  createdIssues: CreatedIssue[];
  theme: 'light' | 'dark';
  themeSource: 'auto' | 'manual';
  onboardingCompleted: boolean;
  jiraConnectionId: number | null;
  connections: JiraConnection[];
  issueTypesFetched: boolean;
  currentTabId: number | null;
  xrayProjects: JiraProject[];
  xrayTargetProjectId: string | null;
  xrayTargetProjectKey: string | null;
  xrayTestIssueTypeName: string;
  xrayRepositoryPathFieldId: string;
  xrayFolderPath: string;
  xrayLinkType: string;
  xrayWarnings: string[];
  previewBugIndex: number | null;
  validationErrors: string[];
  resolvedPayload: ResolvedPayload | null;
}

export interface JiraConnection {
  id: number;
  auth_type: string;
  host_url: string;
  username: string;
  is_active: boolean;
  verify_ssl?: boolean;
  icon_url?: string;
}

export interface JiraField {
  key: string;
  name: string;
  type: string;
  required: boolean;
  system?: string | null;
  allowed_values?: JiraFieldOption[];
}

export interface JiraMetadata {
  project_id?: string;
  project_key: string;
  issue_type_id?: string;
  fields: JiraField[];
}

export interface JiraBootstrapContext {
  connection_id: number;
  instance_url: string;
  platform: 'cloud' | 'server';
  verify_ssl: boolean;
  issue_types: IssueType[];
  selected_issue_type: IssueType | null;
  visible_fields: string[];
  ai_mapping: Record<string, string>;
  field_defaults: Record<string, unknown>;
  jira_metadata: JiraMetadata | null;
}

export interface XrayDefaultsResponse {
  projects: JiraProject[];
  target_project_id: string | null;
  target_project_key: string | null;
  test_issue_type_name: string;
  repository_path_field_id?: string | null;
  folder_path: string;
  link_type: string;
}

export interface IssueType {
  id: string;
  name: string;
  iconUrl?: string;
  icon_url?: string; // Align with backend
  subtask: boolean;
}

export interface IssueData {
  key: string;
  projectId: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  typeName: string;
  iconUrl?: string;
}

export type View = 'auth' | 'setup' | 'main' | 'success' | 'settings' | 'preview';

export const INITIAL_SESSION: TabSession = {
  view: 'main',
  loading: false,
  error: null,
  success: null,
  issueData: null,
  instanceUrl: null,
  bugs: [],
  expandedBug: null,
  testCases: [],
  coverageScore: null,
  manualDesc: '',
  showManualInput: false,
  jiraMetadata: null,
  issueTypes: [],
  selectedIssueType: null,
  visibleFields: [],
  aiMapping: {},
  fieldDefaults: {},
  settingsTab: 'ai',
  createdIssues: [],
  theme: 'dark',
  themeSource: 'auto',
  onboardingCompleted: false,
  jiraConnectionId: null,
  connections: [],
  issueTypesFetched: false,
  currentTabId: null,
  xrayProjects: [],
  xrayTargetProjectId: null,
  xrayTargetProjectKey: null,
  xrayTestIssueTypeName: 'Test',
  xrayRepositoryPathFieldId: '',
  xrayFolderPath: '',
  xrayLinkType: 'Tests',
  xrayWarnings: [],
  previewBugIndex: null,
  validationErrors: [],
  resolvedPayload: null
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
