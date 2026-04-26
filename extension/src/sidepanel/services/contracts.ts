import {
  BugReport,
  CreatedIssue,
  IssueContextPayload,
  IssueData,
  JiraBootstrapContext,
  JiraConnection,
  MissingField,
  GapAnalysisSummary,
  ResolvedPayload,
  TestCase,
  Usage,
  XrayDefaultsResponse,
  XrayPublishResult,
} from '../types';

export interface ProjectRequestParams {
  project_key?: string;
  project_id?: string;
}

export interface AuthBootstrapRequestPayload extends ProjectRequestParams {
  instance_url?: string;
  issue_key?: string;
  issue_type_id?: string;
}

export interface RegisterRequestPayload {
  email: string;
  password: string;
}

export interface AISettingsUpdateRequestPayload {
  custom_model?: string;
  openrouter_key?: string;
}

export interface AuthRefreshRequestPayload {
  refresh_token: string;
}

export interface JiraBootstrapRequestPayload extends ProjectRequestParams {
  instance_url: string;
  issue_key?: string;
  issue_type_id?: string;
}

export interface JiraConnectionCreateRequestPayload {
  host_url: string;
  username: string;
  token: string;
  auth_type: 'cloud' | 'server';
  verify_ssl: boolean;
}

export interface JiraConnectionMutationResponsePayload {
  id: number;
}

export interface AIGenerationRequestPayload extends ProjectRequestParams {
  issue_context?: IssueContextPayload;
  selected_text?: string;
  jira_connection_id: number;
  instance_url?: string | null;
  issue_type_id: string;
  issue_type_name?: string;
  user_description?: string;
  bug_count?: number;
  focus_bug_summary?: string;
  refinement_prompt?: string;
  supporting_context?: string;
}

export interface AIPreviewRequestPayload extends ProjectRequestParams {
  jira_connection_id: number;
  instance_url?: string | null;
  issue_type_id: string;
  bug: BugReport;
}

export interface AISubmitRequestPayload extends ProjectRequestParams {
  jira_connection_id: number;
  instance_url?: string | null;
  story_issue_key?: string;
  issue_type_id: string;
  bugs: BugReport[];
}

export interface JiraUserSearchRequestPayload extends ProjectRequestParams {
  jira_connection_id: number;
  query: string;
  issue_type_id?: string | null;
  field_id?: string | null;
}

export interface JiraSettingsRequestPayload extends ProjectRequestParams {
  jira_connection_id: number;
  issue_type_id: string;
  visible_fields: string[];
  ai_mapping: Record<string, string>;
  field_defaults: Record<string, unknown>;
}

export interface XrayPublishRequestPayload {
  jira_connection_id: number;
  story_issue_key: string;
  xray_project_id: string;
  xray_project_key: string | null;
  test_cases: TestCase[];
  test_issue_type_id?: string;
  test_issue_type_name: string;
  repository_path_field_id?: string;
  folder_path?: string;
  link_type?: string;
}

export interface AISettingsResponsePayload {
  custom_model?: string;
  has_custom_key?: boolean;
}

export interface AuthTokenResponsePayload {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  detail?: string;
}

export interface AuthBootstrapResponsePayload {
  view: 'main' | 'setup';
  has_connections: boolean;
  bootstrap_context: JiraBootstrapContext | null;
  bootstrap_error?: {
    code: string;
    message: string;
  } | null;
}

export interface GeneratedFindingResponsePayload {
  summary: string;
  description: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  severity?: string;
  confidence?: number;
  category?: string;
  acceptance_criteria_refs?: string[];
  evidence?: string[];
  duplicate_group?: string | null;
  overlap_warning?: string | null;
  fields?: Record<string, unknown>;
}

export interface FindingGenerationResponsePayload {
  bugs: GeneratedFindingResponsePayload[];
  warnings?: string[];
}

export interface ManualBugGenerationResponsePayload extends FindingGenerationResponsePayload {}

export interface GapAnalysisResponsePayload extends FindingGenerationResponsePayload {
  ac_coverage?: number;
  analysis_summary?: GapAnalysisSummary | null;
}

export interface AITestCasesResponsePayload {
  test_cases: TestCase[];
  coverage_score: number;
}

export interface AIPreviewResponsePayload {
  valid: boolean;
  missing_fields: MissingField[];
  resolved_payload: ResolvedPayload;
}

export interface AISubmitResponsePayload {
  created_issues: CreatedIssue[];
  warnings?: string[];
  linked_story_issue_key?: string | null;
  link_type_used?: string | null;
  linked_issue_keys?: string[];
  unlinked_issue_keys?: string[];
}

export type JiraConnectionsResponsePayload = JiraConnection[];
export type JiraProjectsResponsePayload = Array<{ id?: string | number; key?: string; name?: string }>;
export type JiraUsersSearchResponsePayload = Array<{ id: string; name: string; avatar?: string }>;
export type JiraBootstrapResponsePayload = JiraBootstrapContext;
export type UsageResponsePayload = Usage;
export type XrayDefaultsResponsePayload = XrayDefaultsResponse;
export type XrayPublishResponsePayload = XrayPublishResult;

export function buildIssueContextPayload(issueData: IssueData | null | undefined): IssueContextPayload {
  return {
    issue_key: issueData?.key,
    summary: issueData?.summary || '',
    description: issueData?.description || '',
    acceptance_criteria: issueData?.acceptanceCriteria || '',
  };
}

type ProjectIssueLike = {
  key?: string;
  projectId?: string;
};

export function buildProjectRequestParams(issueData: ProjectIssueLike | null | undefined): ProjectRequestParams {
  const issueKey = issueData?.key || '';
  const project_key = issueKey.includes('-') ? issueKey.split('-')[0] : issueKey;
  const rawProjectId = issueData?.projectId;
  const project_id = typeof rawProjectId === 'string' && rawProjectId.trim() ? rawProjectId.trim() : undefined;

  return {
    project_key,
    project_id,
  };
}
