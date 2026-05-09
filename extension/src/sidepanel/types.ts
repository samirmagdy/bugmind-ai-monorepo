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

export interface SupportingArtifact {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
}

export interface ManualBugInput {
  text: string;
  supportingContext: string;
  supportingArtifacts: SupportingArtifact[];
}

export interface AnalysisCoverageItem {
  reference: string;
  status: string;
  rationale: string;
  related_bug_indexes: number[];
}

export interface RiskSummaryGroup {
  group: string;
  title: string;
  description: string;
  count: number;
}

export interface GapAnalysisSummary {
  issue_type_mode?: string | null;
  summary_headline?: string | null;
  highest_risk_area?: string | null;
  recommended_next_action?: string | null;
  grouped_risks: RiskSummaryGroup[];
  missing_ac_recommendations: string[];
  ac_coverage_map: AnalysisCoverageItem[];
}

export interface CreatedIssue {
  id: string;
  key: string;
  self: string;
  linkedToStory?: boolean;
  updated?: boolean;
}

export interface TestCase {
  title: string;
  objective?: string;
  steps: string[];
  expected_result: string;
  priority: string;
  selected?: boolean;
  test_type?: string;
  preconditions?: string;
  test_data?: string;
  review_notes?: string;
  acceptance_criteria_refs?: string[];
  labels?: string[];
  components?: string[];
  covered_acceptance_criteria_ids?: string[];
  scenario_type?: string;
  risk_level?: string;
  category?: string;
  coverage_notes?: string;
  existing_issue_key?: string;
}

export interface XrayPublishResult {
  created_tests: CreatedIssue[];
  folder_path: string;
  repository_path_field_id?: string | null;
  link_type_used?: string | null;
  transitioned_tests?: string[];
  commented_story?: boolean;
  warnings: string[];
}

export interface XraySyncHistoryItem {
  id: number;
  story_issue_key: string;
  project_id?: string | null;
  project_key?: string | null;
  operation: string;
  status: string;
  created_test_keys: string[];
  updated_test_keys: string[];
  warnings: string[];
  error_detail?: unknown;
  created_at?: string | null;
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
  projectTypeKey?: string;
  simplified?: boolean;
}

export interface BugReport {
  summary: string;
  description: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  severity: string;
  priority?: string;
  confidence?: number;
  category?: string;
  environment?: string;
  root_cause?: string;
  acceptance_criteria_refs?: string[];
  evidence?: string[];
  suggested_evidence?: string[];
  labels?: string[];
  review_required?: boolean;
  duplicate_group?: string | null;
  overlap_warning?: string | null;
  edited?: boolean;
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
  mainWorkflow: MainWorkflow;
  loading: boolean;
  error: string | null;
  success: string | null;
  issueData: IssueData | null;
  instanceUrl: string | null; // e.g. https://company.atlassian.net
  bugs: BugReport[];
  expandedBug: number | null;
  testCases: TestCase[];
  coverageScore: number | null;
  gapAnalysisSummary: GapAnalysisSummary | null;
  bugGenerationCount: number;
  testGenerationTypes: string[];
  generationSupportingContext: string;
  supportingArtifacts: SupportingArtifact[];
  manualInputs: ManualBugInput[];
  jiraMetadata: JiraMetadata | null;
  jiraCapabilityProfile: JiraCapabilityProfile | null;
  issueTypes: IssueType[];
  selectedIssueType: IssueType | null;
  defaultBugIssueType: IssueType | null;
  defaultTestCaseIssueType: IssueType | null;
  defaultGapAnalysisIssueType: IssueType | null;
  visibleFields: string[];
  aiMapping: Record<string, string>;
  fieldDefaults: Record<string, unknown>;
  settingsTab: 'ai' | 'jira' | 'capability' | 'connections' | 'workspaces';
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
  xrayFieldDefaults: Record<string, unknown>;
  xrayWarnings: string[];
  xraySyncHistory: XraySyncHistoryItem[];
  xrayPublishSupported: boolean;
  xrayPublishMode: 'jira_server' | 'xray_cloud';
  xrayUnsupportedReason: string | null;
  bulkEpicKey: string;
  bulkStories: BulkStory[];
  bulkSelectedStoryKeys: string[];
  bulkEpicAttachments: BulkAttachment[];
  bulkProgressMessage: string;
  bulkProgressPercent: number;
  bulkBrdText: string;
  bulkBrdFileName?: string;
  previewBugIndex: number | null;
  validationErrors: string[];
  resolvedPayload: ResolvedPayload | null;
  submitIdempotencyKey: string | null;
  submitIdempotencyFingerprint: string | null;
  undoStack: WorkHistoryEntry[];
  redoStack: WorkHistoryEntry[];
  revisions: RevisionEntry[];
  generationProgressMessage: string;
  generationProgressPercent: number;
  generationEtaSeconds: number | null;
  locale: 'en' | 'ar';
  mappingWizardCompleted: boolean;
  // Phase 2: Duplicate detection
  duplicateMatches: DuplicateMatch[];
  duplicateCheckFailed: boolean;
  duplicateCheckFailureReason: string;
  duplicateCheckLoading: boolean;
  showXrayCloudWizard?: boolean;
  xrayCloudWizardMode?: 'publish' | 'settings';
  workspaces: Workspace[];
  activeWorkspaceId: number | null;
  activeWorkspaceRole: string | null;
  activityFeed: ActivityFeedItem[];
  toastHistory: ToastHistoryItem[];
  workflowPresets: WorkflowPreset[];
  commandPaletteOpen: boolean;
  selectedWorkspaceTemplateId: number | null;
}

export interface JiraConnection {
  id: number;
  auth_type: string;
  host_url: string;
  username: string;
  is_active: boolean;
  verify_ssl?: boolean;
  icon_url?: string;
  has_xray_cloud_credentials?: boolean;
  workspace_id?: number | null;
  is_shared?: boolean;
}

export interface WorkspaceMember {
  id: number;
  user_id: number;
  role: 'owner' | 'admin' | 'qa_lead' | 'qa_engineer' | 'viewer';
  email?: string;
}

export interface WorkspaceTemplate {
  id: number;
  workspace_id: number;
  name: string;
  template_type: 'bug' | 'test' | 'preset' | 'style';
  content: Record<string, unknown>;
}

export interface WorkspaceTemplateAssignment {
  id: number;
  workspace_id: number;
  template_id: number;
  project_key?: string | null;
  issue_type_id?: string | null;
  workflow?: MainWorkflow | string | null;
  is_default: boolean;
  template?: WorkspaceTemplate | null;
}

export interface Workspace {
  id: number;
  name: string;
  owner_id: number;
  members?: WorkspaceMember[];
  templates?: WorkspaceTemplate[];
  template_assignments?: WorkspaceTemplateAssignment[];
  role?: string;
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

export interface JiraCapabilityFieldSchema {
  name: string;
  type: string;
  required: boolean;
  allowedValues?: JiraFieldOption[];
}

export type JiraCapabilitySupportStatus = 'supported' | 'partial' | 'blocked' | 'planned';

export interface JiraCapabilityFeatureStatus {
  key: string;
  label: string;
  status: JiraCapabilitySupportStatus;
  detail: string;
}

export interface JiraCapabilityFeatureGroup {
  key: string;
  label: string;
  status: JiraCapabilitySupportStatus;
  features: JiraCapabilityFeatureStatus[];
}

export interface JiraCapabilityDiagnostics {
  lastSuccessfulDiscoveryAt?: string;
  lastDiscoveryWarnings: string[];
  health: 'connected' | 'degraded' | 'blocked';
  healthReasons: string[];
}

export interface JiraNamedEntity {
  id: string;
  name: string;
  archived?: boolean;
  released?: boolean;
}

export interface JiraWorkflowStatus {
  id: string;
  name: string;
  category?: string;
}

export interface JiraIssueLinkTypeProfile {
  id?: string;
  name: string;
  inward: string;
  outward: string;
}

export interface JiraProjectCapabilityDetails {
  components: JiraNamedEntity[];
  versions: JiraNamedEntity[];
  statuses: JiraWorkflowStatus[];
  issueLinkTypes: JiraIssueLinkTypeProfile[];
}

export interface JiraCapabilityPrivacySettings {
  fieldsSentToAi: string[];
  excludedFieldsFromAi: string[];
  maskSensitiveData: boolean;
  disableCommentsExtraction: boolean;
  disableAttachmentMetadataExtraction: boolean;
  externalAiDisabled: boolean;
  minimalDataAiMode: boolean;
  domainAllowlist: string[];
  projectAllowlist: string[];
}

export interface JiraCapabilityWorkflowSettings {
  mode: 'generate_only' | 'sync_enabled' | 'admin_diagnostic' | 'safe_mode';
  defaultFolderByProject: Record<string, string>;
  defaultFolderByComponent: Record<string, string>;
  preferredComponents: string[];
  preferredFixVersions: string[];
  defaultPriority?: string;
  addCommentAfterSync: boolean;
  transitionAfterCreate: boolean;
}

export interface JiraCapabilityProfile {
  jiraProfileVersion: 1;
  connection: {
    baseUrl: string;
    deploymentType: 'cloud' | 'server' | 'dataCenter' | 'unknown';
    apiVersion: '2' | '3';
    connected: boolean;
    lastCheckedAt: string;
    buildNumber?: string;
    version?: string;
  };
  user: {
    accountId?: string;
    displayName?: string;
    emailAddress?: string;
    timeZone?: string;
    active?: boolean;
  };
  projects: JiraProject[];
  selectedProject: JiraProject | null;
  projectDetails?: JiraProjectCapabilityDetails;
  permissions: {
    canBrowse: boolean;
    canCreateIssues: boolean;
    canEditIssues: boolean;
    canLinkIssues: boolean;
    canTransitionIssues: boolean;
    canAddComments?: boolean;
    canDeleteIssues?: boolean;
  };
  issueTypes: {
    story: IssueType | null;
    test: IssueType | null;
    bug: IssueType | null;
    all: IssueType[];
  };
  sourceStoryMapping: {
    acceptanceCriteria?: string;
    mainFlow?: string;
    alternativeFlow?: string;
    businessRules?: string;
    expectedBehavior?: string;
    outOfScope?: string;
    assumptions?: string;
    dependencies?: string;
    testNotes?: string;
    confidenceScore?: number;
  };
  targetTestCreateFields: {
    requiredFields: string[];
    fieldSchemas: Record<string, JiraCapabilityFieldSchema>;
  };
  xray: {
    installed: boolean;
    mode: 'server-dc-raven' | 'xray-cloud' | 'jira-fields' | 'description-fallback' | 'unknown';
    supportsNativeSteps: boolean;
    supportsRepositoryFolders: boolean;
    supportsManualStepsField: boolean;
    testTypeFieldId?: string;
    manualStepsFieldId?: string;
    fieldDefaults?: Record<string, unknown>;
  };
  linking: {
    preferredLinkType: string;
    outward: string;
    inward: string;
    direction: 'test_to_story' | 'story_to_test';
  };
  syncStrategy: {
    createInSourceProject: boolean;
    fallbackWhenNativeStepsFail: 'manualStepsField' | 'description';
    transitionAfterCreate: boolean;
    inheritLabels: boolean;
    inheritComponents: boolean;
    inheritVersions: boolean;
  };
  readiness: {
    canGenerateFromJira: boolean;
    canSyncToXray: boolean;
    missingRequiredFields: string[];
    warnings: string[];
  };
  diagnostics?: JiraCapabilityDiagnostics;
  featureGroups?: JiraCapabilityFeatureGroup[];
  privacy?: JiraCapabilityPrivacySettings;
  workflow?: JiraCapabilityWorkflowSettings;
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
  publish_supported: boolean;
  publish_mode: 'jira_server' | 'xray_cloud';
  unsupported_reason?: string | null;
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
  priority?: string;
  labels?: string[];
  components?: string[];
  fixVersions?: string[];
  linkedTestKeys?: string[];
}

export interface BulkAttachment {
  id: string;
  filename: string;
  mime_type?: string | null;
  size?: number | null;
  issue_key?: string | null;
}

export interface BulkStory {
  id: string;
  key: string;
  summary: string;
  description?: unknown;
  issue_type?: string | null;
  status?: string | null;
  risk_score: number;
  risk_reasons: string[];
  attachments: BulkAttachment[];
}

export interface BulkFetchResult {
  epic_key: string;
  jql: string;
  issues: BulkStory[];
  epic_attachments: BulkAttachment[];
}

export interface BulkProgressPayload {
  message: string;
  percent: number;
}

export interface WorkSnapshot {
  bugs: BugReport[];
  testCases: TestCase[];
}

export interface WorkHistoryEntry extends WorkSnapshot {
  label: string;
  createdAt: number;
}

export interface RevisionEntry {
  id: string;
  type: 'bug' | 'test';
  index: number;
  title: string;
  before: BugReport | TestCase | null;
  after: BugReport | TestCase | null;
  createdAt: number;
}

export type View = 'auth' | 'setup' | 'main' | 'success' | 'settings' | 'preview' | 'jobs' | 'workspace';
export type MainWorkflow = 'home' | 'manual' | 'analysis' | 'tests' | 'bulk';

export interface ActivityFeedItem {
  id: string;
  kind: 'generation' | 'publish' | 'job' | 'draft' | 'settings' | 'error' | 'success';
  title: string;
  detail?: string;
  issueKey?: string;
  createdAt: number;
  actionView?: View;
  actionWorkflow?: MainWorkflow;
}

export interface ToastHistoryItem {
  id: string;
  tone: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
  createdAt: number;
}

export interface WorkflowPreset {
  id: string;
  name: string;
  workflow: MainWorkflow;
  bugGenerationCount: number;
  testGenerationTypes: string[];
  selectedIssueTypeId?: string | null;
  xrayTargetProjectId?: string | null;
  xrayFolderPath?: string;
  createdAt: number;
  updatedAt: number;
}

// Phase 1: Test categories — must be before INITIAL_SESSION
export const TEST_CATEGORIES = [
  'Positive', 'Negative', 'Boundary', 'Regression', 'Permission',
  'Validation', 'API', 'UI', 'Mobile', 'Accessibility', 'Performance',
] as const;

export const DEFAULT_TEST_CATEGORIES = ['Positive', 'Negative', 'Boundary', 'Regression'];

export const INITIAL_SESSION: TabSession = {
  view: 'main',
  mainWorkflow: 'home',
  loading: false,
  error: null,
  success: null,
  issueData: null,
  instanceUrl: null,
  bugs: [],
  expandedBug: null,
  testCases: [],
  coverageScore: null,
  gapAnalysisSummary: null,
  bugGenerationCount: 5,
  testGenerationTypes: [...DEFAULT_TEST_CATEGORIES],
  generationSupportingContext: '',
  supportingArtifacts: [],
  manualInputs: [{ text: '', supportingContext: '', supportingArtifacts: [] }],
  jiraMetadata: null,
  jiraCapabilityProfile: null,
  issueTypes: [],
  selectedIssueType: null,
  defaultBugIssueType: null,
  defaultTestCaseIssueType: null,
  defaultGapAnalysisIssueType: null,
  visibleFields: [],
  aiMapping: {},
  fieldDefaults: {},
  settingsTab: 'ai',
  createdIssues: [],
  theme: 'light',
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
  xrayFieldDefaults: {},
  xrayWarnings: [],
  xraySyncHistory: [],
  xrayPublishSupported: true,
  xrayPublishMode: 'jira_server',
  xrayUnsupportedReason: null,
  bulkEpicKey: '',
  bulkStories: [],
  bulkSelectedStoryKeys: [],
  bulkEpicAttachments: [],
  bulkProgressMessage: '',
  bulkProgressPercent: 0,
  bulkBrdText: '',
  bulkBrdFileName: '',
  previewBugIndex: null,
  validationErrors: [],
  resolvedPayload: null,
  submitIdempotencyKey: null,
  submitIdempotencyFingerprint: null,
  undoStack: [],
  redoStack: [],
  revisions: [],
  generationProgressMessage: '',
  generationProgressPercent: 0,
  generationEtaSeconds: null,
  locale: 'en',
  mappingWizardCompleted: false,
  duplicateMatches: [],
  duplicateCheckFailed: false,
  duplicateCheckFailureReason: '',
  duplicateCheckLoading: false,
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspaceRole: null,
  activityFeed: [],
  toastHistory: [],
  workflowPresets: [],
  commandPaletteOpen: false,
  selectedWorkspaceTemplateId: null,
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

// Phase 1: Quality check
export interface QualityCheckItem {
  label: string;
  present: boolean;
  hint: string;
}

export interface QualityCheckResult {
  score: number;
  missing_items: QualityCheckItem[];
  hints: string[];
  summary: string;
}

// Phase 1: Story analysis
export interface StoryAnalysis {
  ac_count: number;
  estimated_complexity: 'small' | 'medium' | 'large';
  has_description: boolean;
  description_length: number;
  has_acceptance_criteria: boolean;
  privacy_redaction_active: boolean;
  content_warnings: string[];
  selected_categories?: string[] | null;
  include_description?: boolean;
}

// Phase 2: Duplicate detection
export interface DuplicateMatch {
  issue_key: string;
  summary: string;
  status: string;
  priority: string;
  similarity_score: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  url: string;
}

export interface DuplicateCheckResponse {
  matches: DuplicateMatch[];
  check_failed: boolean;
  failure_reason: string;
}

export interface DuplicateLinkResponse {
  linked: boolean;
  link_type_used: string;
  error?: string | null;
}
