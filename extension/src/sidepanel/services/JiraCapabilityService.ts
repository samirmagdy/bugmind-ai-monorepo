import { IssueData, IssueType, JiraCapabilityFeatureGroup, JiraCapabilityFeatureStatus, JiraCapabilityFieldSchema, JiraCapabilityProfile, JiraFieldOption, JiraIssueLinkTypeProfile, JiraNamedEntity, JiraProject, JiraProjectCapabilityDetails, JiraWorkflowStatus, TabSession } from '../types';

type JiraAuthType = 'cloud' | 'server';

export interface JiraCapabilityDiscoveryOptions {
  baseUrl: string;
  username: string;
  token: string;
  authType: JiraAuthType;
  projectKey?: string;
  xrayMode?: 'auto' | 'server-dc-raven' | 'xray-cloud' | 'jira-fields' | 'description-fallback';
}

type RawField = {
  id?: string;
  key?: string;
  fieldId?: string;
  name?: string;
  required?: boolean;
  schema?: { type?: string; system?: string; custom?: string };
  allowedValues?: unknown[];
};

type FeatureInput = Omit<JiraCapabilityFeatureStatus, 'status'> & {
  supported?: boolean;
  partial?: boolean;
  blocked?: boolean;
};

export type JiraReadinessItem = {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail?: string;
};

export type JiraCapabilityFeature = {
  key: string;
  label: string;
  enabled: boolean;
  detail: string;
};

export type QAInsightItem = {
  key: string;
  label: string;
  ok: boolean;
  severity: 'info' | 'warning' | 'danger' | 'success';
  detail: string;
};

export type StoryQualityProfile = {
  score: number;
  status: 'ready' | 'usable' | 'weak';
  items: QAInsightItem[];
};

export type CoverageMatrixItem = {
  reference: string;
  status: 'covered' | 'partial' | 'missing';
  testIndexes: number[];
  testTitles: string[];
};

export type PayloadDryRunResult = {
  valid: boolean;
  issues: QAInsightItem[];
};

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`.replace(/\/(browse|issues|projects|rest)(?:\/.*)?$/i, '');
  } catch {
    return trimmed;
  }
}

function encodeBasicAuth(username: string, token: string): string {
  return btoa(unescape(encodeURIComponent(`${username}:${token}`)));
}

function fieldId(field: RawField): string {
  return String(field.fieldId || field.id || field.key || '').trim();
}

function normalizeFieldType(field: RawField): string {
  return String(field.schema?.type || field.schema?.custom || 'unknown');
}

function normalizeAllowedValues(values: unknown[] | undefined): JiraFieldOption[] | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  return values
    .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
    .map((value) => ({
      id: String(value.id ?? value.key ?? value.value ?? value.name ?? ''),
      name: typeof value.name === 'string' ? value.name : undefined,
      value: typeof value.value === 'string' ? value.value : undefined,
      label: typeof value.label === 'string' ? value.label : undefined,
    }));
}

function normalizeCreateFields(raw: unknown): Record<string, JiraCapabilityFieldSchema> {
  const fields: RawField[] = [];

  if (raw && typeof raw === 'object') {
    const payload = raw as Record<string, unknown>;
    if (Array.isArray(payload.fields)) {
      fields.push(...payload.fields as RawField[]);
    } else if (payload.fields && typeof payload.fields === 'object') {
      Object.entries(payload.fields as Record<string, RawField>).forEach(([key, value]) => {
        fields.push({ fieldId: key, ...value });
      });
    } else if (Array.isArray(payload.projects)) {
      const project = (payload.projects as Record<string, unknown>[])[0];
      const issueType = Array.isArray(project?.issuetypes) ? (project.issuetypes as Record<string, unknown>[])[0] : undefined;
      const nested = issueType?.fields;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        Object.entries(nested as Record<string, RawField>).forEach(([key, value]) => fields.push({ fieldId: key, ...value }));
      }
    }
  }

  return fields.reduce<Record<string, JiraCapabilityFieldSchema>>((acc, field) => {
    const id = fieldId(field);
    if (!id) return acc;
    acc[id] = {
      name: String(field.name || id),
      type: normalizeFieldType(field),
      required: Boolean(field.required),
      allowedValues: normalizeAllowedValues(field.allowedValues),
    };
    return acc;
  }, {});
}

function normalizeIssueType(raw: Record<string, unknown>): IssueType {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : undefined,
    icon_url: typeof raw.icon_url === 'string' ? raw.icon_url : undefined,
    subtask: Boolean(raw.subtask),
  };
}

function normalizeNamedEntity(raw: Record<string, unknown>): JiraNamedEntity {
  return {
    id: String(raw.id ?? raw.name ?? ''),
    name: String(raw.name ?? ''),
    archived: typeof raw.archived === 'boolean' ? raw.archived : undefined,
    released: typeof raw.released === 'boolean' ? raw.released : undefined,
  };
}

function normalizeWorkflowStatus(raw: Record<string, unknown>): JiraWorkflowStatus {
  const category = raw.statusCategory && typeof raw.statusCategory === 'object'
    ? String((raw.statusCategory as Record<string, unknown>).name || '')
    : undefined;
  return {
    id: String(raw.id ?? raw.name ?? ''),
    name: String(raw.name ?? ''),
    category,
  };
}

function normalizeIssueLinkTypes(payload: Record<string, unknown> | null): JiraIssueLinkTypeProfile[] {
  const types = Array.isArray(payload?.issueLinkTypes) ? payload.issueLinkTypes as Record<string, unknown>[] : [];
  return types
    .map(type => ({
      id: type.id ? String(type.id) : undefined,
      name: String(type.name || ''),
      inward: String(type.inward || ''),
      outward: String(type.outward || ''),
    }))
    .filter(type => type.name);
}

function findByNames(issueTypes: IssueType[], names: string[]): IssueType | null {
  const normalized = names.map(name => name.toLowerCase());
  return issueTypes.find(item => normalized.includes(item.name.trim().toLowerCase())) ||
    issueTypes.find(item => normalized.some(name => item.name.toLowerCase().includes(name))) ||
    null;
}

function pickSourceMapping(fields: Array<{ id: string; name: string; type: string }>): JiraCapabilityProfile['sourceStoryMapping'] {
  const find = (patterns: RegExp[]) => fields.find(field => patterns.some(pattern => pattern.test(field.name)));
  const mapping = {
    acceptanceCriteria: find([/acceptance\s*criteria/i, /\bAC\b/i])?.id,
    mainFlow: find([/main\s*flow/i, /happy\s*path/i])?.id,
    alternativeFlow: find([/alternative\s*flow/i, /alternate\s*flow/i, /exception\s*flow/i])?.id,
    businessRules: find([/business\s*rules?/i])?.id,
    expectedBehavior: find([/expected\s*behaviou?r/i, /expected\s*result/i])?.id,
    outOfScope: find([/out\s*of\s*scope/i, /not\s*in\s*scope/i])?.id,
    assumptions: find([/assumptions?/i])?.id,
    dependencies: find([/dependencies|dependency/i])?.id,
    testNotes: find([/test\s*notes?|qa\s*notes?|testing\s*notes?/i])?.id,
  };
  const detectedCount = Object.values(mapping).filter(Boolean).length;
  return {
    ...mapping,
    confidenceScore: Math.round((detectedCount / 9) * 100),
  };
}

function featureStatus(feature: FeatureInput): JiraCapabilityFeatureStatus {
  return {
    key: feature.key,
    label: feature.label,
    detail: feature.detail,
    status: feature.blocked ? 'blocked' : feature.supported ? 'supported' : feature.partial ? 'partial' : 'planned',
  };
}

function groupStatus(features: JiraCapabilityFeatureStatus[]): JiraCapabilityFeatureGroup['status'] {
  if (features.every(feature => feature.status === 'supported')) return 'supported';
  if (features.some(feature => feature.status === 'blocked')) return 'blocked';
  if (features.some(feature => feature.status === 'supported' || feature.status === 'partial')) return 'partial';
  return 'planned';
}

function featureGroup(key: string, label: string, features: FeatureInput[]): JiraCapabilityFeatureGroup {
  const resolvedFeatures = features.map(featureStatus);
  return {
    key,
    label,
    status: groupStatus(resolvedFeatures),
    features: resolvedFeatures,
  };
}

function buildFeatureGroups(profile: JiraCapabilityProfile, hasCreateFields: boolean): JiraCapabilityFeatureGroup[] {
  const mappedSourceFields = Object.values(profile.sourceStoryMapping).filter(Boolean).length;
  const hasXray = profile.xray.installed || profile.xray.mode !== 'unknown';
  const hasRequiredDefaults = profile.readiness.missingRequiredFields.length === 0;
  const canSync = profile.permissions.canCreateIssues && Boolean(profile.issueTypes.test) && hasRequiredDefaults;
  const projectDetails = profile.projectDetails;

  return [
    featureGroup('jira_connection', 'Jira Connection', [
      { key: 'base_url_email_token', label: 'Base URL + user + token connection', supported: profile.connection.connected, detail: profile.connection.baseUrl },
      { key: 'validate_token', label: 'Validate Jira token', supported: profile.connection.connected, detail: 'Validated through Jira /myself.' },
      { key: 'cloud_server_detection', label: 'Detect Cloud vs Server/DC', supported: true, detail: profile.connection.deploymentType },
      { key: 'api_version_detection', label: 'Detect Jira API version', supported: true, detail: `REST API v${profile.connection.apiVersion}` },
      { key: 'user_profile', label: 'Connected user profile', supported: Boolean(profile.user.displayName || profile.user.accountId), detail: profile.user.displayName || profile.user.accountId || 'No user details returned.' },
      { key: 'health_status', label: 'Connection health status', supported: true, detail: profile.diagnostics?.health || 'connected' },
      { key: 'manual_discovery_refresh', label: 'Manual discovery refresh', partial: true, detail: 'Reconnect & Discover reruns discovery; direct tokenless refresh is limited.' },
      { key: 'save_profile', label: 'Save capability profile', supported: true, detail: 'Stored per base URL/project in extension storage.' },
      { key: 'profile_import_export', label: 'Import/export profile', supported: true, detail: 'Sanitized JSON import/export is available in the sidepanel.' },
      { key: 'multiple_environments', label: 'Multiple Jira environments', supported: true, detail: `${profile.projects.length} accessible project(s) discovered.` },
      { key: 'read_only_full_sync_modes', label: 'Read-only/full-sync modes', partial: true, detail: canSync ? 'Sync enabled.' : 'Read-only/generate-only behavior enforced by readiness.' },
      { key: 'clear_token_profile', label: 'Clear token/session/profile', partial: true, detail: 'Profile can be cleared locally; server-side connection deletion clears saved token.' },
    ]),
    featureGroup('project_discovery', 'Project Discovery', [
      { key: 'active_project', label: 'Active project from issue', supported: Boolean(profile.selectedProject), detail: profile.selectedProject?.key || 'No selected project.' },
      { key: 'accessible_projects', label: 'List accessible projects', supported: profile.projects.length > 0, detail: `${profile.projects.length} project(s).` },
      { key: 'project_identity', label: 'Detect project ID/key/name/type', supported: Boolean(profile.selectedProject?.id && profile.selectedProject?.key), detail: profile.selectedProject ? `${profile.selectedProject.key} - ${profile.selectedProject.name}` : 'No project.' },
      { key: 'team_managed_detection', label: 'Company/team-managed detection', partial: typeof profile.selectedProject?.simplified === 'boolean', detail: typeof profile.selectedProject?.simplified === 'boolean' ? (profile.selectedProject.simplified ? 'Team-managed' : 'Company-managed') : 'Jira did not return simplified flag.' },
      { key: 'central_qa_project', label: 'Central QA project selection', supported: true, detail: 'Xray target project can differ from source story project.' },
      { key: 'project_settings', label: 'Project-specific settings/mappings', partial: true, detail: 'Capability profiles and field mappings are project-scoped; advanced per-component/release templates are planned.' },
      { key: 'components_versions_workflows', label: 'Components, versions, workflows', supported: Boolean(projectDetails), detail: `${projectDetails?.components.length || 0} component(s), ${projectDetails?.versions.length || 0} version(s), ${projectDetails?.statuses.length || 0} workflow status(es).` },
    ]),
    featureGroup('permissions', 'Permission-Based Modes', [
      { key: 'browse', label: 'Browse Projects', supported: profile.permissions.canBrowse, blocked: !profile.permissions.canBrowse, detail: profile.permissions.canBrowse ? 'Available' : 'Generation from Jira is blocked.' },
      { key: 'create', label: 'Create Issues', supported: profile.permissions.canCreateIssues, blocked: !profile.permissions.canCreateIssues, detail: profile.permissions.canCreateIssues ? 'Available' : 'Xray sync is disabled.' },
      { key: 'edit_link_transition_comment', label: 'Edit/link/transition/comment permissions', partial: true, detail: `Edit ${profile.permissions.canEditIssues ? 'yes' : 'no'}, link ${profile.permissions.canLinkIssues ? 'yes' : 'no'}, transition ${profile.permissions.canTransitionIssues ? 'yes' : 'no'}, comment ${profile.permissions.canAddComments ? 'yes' : 'no'}.` },
      { key: 'blocked_reasoning', label: 'Blocked feature reasons/checklist', supported: true, detail: 'Readiness cards explain blocking checks.' },
      { key: 'admin_diagnostic_mode', label: 'Admin diagnostic/report mode', partial: true, detail: 'Sanitized profile export exists; full admin report is planned.' },
    ]),
    featureGroup('issue_types', 'Issue Types', [
      { key: 'available_types', label: 'Available issue types', supported: profile.issueTypes.all.length > 0, detail: `${profile.issueTypes.all.length} type(s).` },
      { key: 'story_bug_test', label: 'Story/Bug/Test detection', partial: true, detail: `Story ${profile.issueTypes.story?.name || 'missing'}, Bug ${profile.issueTypes.bug?.name || 'missing'}, Test ${profile.issueTypes.test?.name || 'missing'}.` },
      { key: 'test_type_id_truth', label: 'Use Test issue type ID', supported: Boolean(profile.issueTypes.test?.id), detail: profile.issueTypes.test?.id || 'No Test type selected.' },
      { key: 'manual_test_type', label: 'Manual renamed Test selection', supported: true, detail: 'User can select and save the Test issue type.' },
      { key: 'create_metadata', label: 'Issue type create metadata', supported: hasCreateFields, detail: `${Object.keys(profile.targetTestCreateFields.fieldSchemas).length} create field(s).` },
    ]),
    featureGroup('source_mapping', 'Source Story Mapping', [
      { key: 'core_sections', label: 'AC/Main/Alternative/Business Rules', supported: mappedSourceFields >= 4, partial: mappedSourceFields > 0, detail: `${mappedSourceFields} mapped field(s), ${profile.sourceStoryMapping.confidenceScore || 0}% confidence.` },
      { key: 'manual_mapping', label: 'Manual source field mapping', partial: true, detail: 'Source mapping can be persisted in the profile; full UI editor is limited.' },
      { key: 'preview_extraction', label: 'Extracted story preview', supported: true, detail: 'Issue preview uses active Jira context.' },
      { key: 'extended_sections', label: 'Expected behavior/out-of-scope/assumptions/dependencies/test notes', partial: Boolean(profile.sourceStoryMapping.expectedBehavior || profile.sourceStoryMapping.outOfScope || profile.sourceStoryMapping.assumptions || profile.sourceStoryMapping.dependencies || profile.sourceStoryMapping.testNotes), detail: 'Extended source fields are auto-detected and stored when matching Jira fields exist.' },
    ]),
    featureGroup('active_issue', 'Active Jira Issue', [
      { key: 'active_issue_fetch', label: 'Detect and fetch active issue', supported: true, detail: 'Content script and bootstrap context resolve the current Jira issue.' },
      { key: 'core_issue_fields', label: 'Summary/description/AC/status/priority/labels/components/versions', partial: true, detail: 'Core issue fields are modeled; availability depends on Jira response and mappings.' },
      { key: 'links_and_duplicates', label: 'Linked tests duplicate signal', partial: true, detail: 'Linked Test keys can warn before publish.' },
      { key: 'comments_attachments_subtasks', label: 'Comments, attachments, subtasks', partial: true, detail: 'Bulk attachment metadata/BRD extraction exists; active issue extraction is limited.' },
    ]),
    featureGroup('target_fields', 'Target Test Create Fields', [
      { key: 'required_optional_fields', label: 'Required/optional fields', supported: hasCreateFields, detail: `${profile.targetTestCreateFields.requiredFields.length} required field(s).` },
      { key: 'allowed_values', label: 'Allowed values/dropdowns', partial: hasCreateFields, detail: 'Allowed values are used when Jira returns them.' },
      { key: 'field_defaults', label: 'Default values and mappings', supported: true, detail: 'Defaults are saved and applied before sync.' },
      { key: 'payload_preview', label: 'Payload preview/validation', supported: true, detail: 'Dry-run preview validates blockers before publish.' },
    ]),
    featureGroup('xray', 'Xray Detection and Sync', [
      { key: 'xray_mode', label: 'Xray mode detection/fallback', partial: hasXray, detail: profile.xray.mode },
      { key: 'native_steps', label: 'Native Xray steps', partial: profile.xray.supportsNativeSteps, detail: profile.xray.supportsNativeSteps ? 'Detected' : 'Backend can attempt steps; browser discovery is conservative.' },
      { key: 'manual_steps_description', label: 'Manual steps/description fallback', supported: true, detail: profile.syncStrategy.fallbackWhenNativeStepsFail },
      { key: 'folders', label: 'Repository folders', partial: profile.xray.supportsRepositoryFolders, detail: profile.xray.supportsRepositoryFolders ? 'Server/DC folder API detected.' : 'Folder path can still be sent as metadata/fallback.' },
      { key: 'cloud_credentials', label: 'Xray Cloud credentials', partial: profile.xray.mode === 'xray-cloud', detail: 'Cloud wizard stores credentials on the backend connection.' },
    ]),
    featureGroup('linking_sync', 'Linking and Sync Strategy', [
      { key: 'link_types', label: 'Detect/select link type', supported: Boolean(projectDetails?.issueLinkTypes.length), detail: `${projectDetails?.issueLinkTypes.length || 0} link type(s); preferred ${profile.linking.preferredLinkType} (${profile.linking.outward}/${profile.linking.inward})` },
      { key: 'link_created_tests', label: 'Link Test to Story', partial: profile.permissions.canLinkIssues, detail: profile.permissions.canLinkIssues ? 'Linking attempted during publish.' : 'Permission missing; publish can continue with warning.' },
      { key: 'inheritance', label: 'Inherit labels/components/fix versions/priority', supported: true, detail: 'Configured in sync strategy and publish payload.' },
      { key: 'transition_comment', label: 'Transition/comment after creation', partial: false, detail: 'Permissions are detected; automation is planned.' },
    ]),
    featureGroup('readiness_dry_run', 'Readiness and Dry Run', [
      { key: 'setup_readiness', label: 'Setup readiness score', supported: true, detail: profile.readiness.canSyncToXray ? 'Sync-ready' : 'Blockers or warnings present.' },
      { key: 'blocking_warnings', label: 'Blocking/warning issues', supported: true, detail: profile.readiness.warnings.join(', ') || 'No discovery warnings.' },
      { key: 'dry_run_payload', label: 'Dry-run payload preview', supported: true, detail: 'Payload preview and blocking validation run before publish.' },
      { key: 'bulk_dry_run_history', label: 'Bulk dry-run history/reporting', partial: false, detail: 'Planned.' },
    ]),
    featureGroup('ai_quality_coverage', 'AI, Quality, Coverage', [
      { key: 'test_generation_categories', label: 'Manual tests by category', supported: true, detail: 'Positive, negative, boundary, regression, permission, validation, API, UI, mobile, accessibility, performance.' },
      { key: 'prompt_from_jira', label: 'Prompt from mapped Jira fields', partial: true, detail: 'Uses issue context and selected mappings; advanced templates are planned.' },
      { key: 'privacy_redaction', label: 'Sensitive data masking before AI', supported: true, detail: 'Server-side redaction handles common emails, tokens, long IDs, phones, auth/cookies.' },
      { key: 'requirement_analysis', label: 'Requirement analysis and clarification', partial: true, detail: 'Gap analysis exists; full PO/BA checklists are planned.' },
      { key: 'quality_coverage', label: 'Test quality and coverage signals', partial: true, detail: 'Coverage matrix and story quality cards exist; advanced scoring is planned.' },
    ]),
    featureGroup('bulk_reporting_admin', 'Bulk, Reporting, Enterprise', [
      { key: 'bulk_epic', label: 'Bulk Epic workflows', partial: true, detail: 'Epic child fetch, bulk generation, audit, and BRD comparison exist.' },
      { key: 'exports', label: 'Reports and exports', partial: true, detail: 'Profile export exists; CSV/Excel/PDF/report packages are planned.' },
      { key: 'dashboard_cards', label: 'Dashboard cards', partial: true, detail: 'Readiness, capability, story quality, dry-run and sync cards exist.' },
      { key: 'security_admin', label: 'Security/admin controls', partial: true, detail: 'Workspaces, roles, shared connections/templates and audit views exist; locked policies/approvals are planned.' },
      { key: 'automation', label: 'Automation and recommendations', partial: true, detail: 'Discovery, issue detection, inheritance, fallback, and suggestions are partially automated.' },
    ]),
  ];
}

function normalizeProfileShape(profile: JiraCapabilityProfile, reason: string): JiraCapabilityProfile {
  const sourceFields = Object.values(profile.sourceStoryMapping || {}).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const projectKey = profile.selectedProject?.key || '';
  const normalized: JiraCapabilityProfile = {
    ...profile,
    projectDetails: profile.projectDetails || {
      components: [],
      versions: [],
      statuses: [],
      issueLinkTypes: [],
    },
    sourceStoryMapping: {
      ...profile.sourceStoryMapping,
      confidenceScore: profile.sourceStoryMapping?.confidenceScore ?? Math.round((sourceFields.length / 9) * 100),
    },
    diagnostics: profile.diagnostics || {
      lastSuccessfulDiscoveryAt: profile.connection.lastCheckedAt,
      lastDiscoveryWarnings: profile.readiness.warnings || [],
      health: profile.connection.connected ? 'connected' : 'blocked',
      healthReasons: profile.readiness.warnings?.length ? profile.readiness.warnings : [reason],
    },
    privacy: profile.privacy || {
      fieldsSentToAi: sourceFields,
      excludedFieldsFromAi: [],
      maskSensitiveData: true,
      disableCommentsExtraction: true,
      disableAttachmentMetadataExtraction: false,
      externalAiDisabled: false,
      minimalDataAiMode: false,
      domainAllowlist: [profile.connection.baseUrl],
      projectAllowlist: projectKey ? [projectKey] : [],
    },
    workflow: profile.workflow || {
      mode: profile.permissions.canCreateIssues ? 'sync_enabled' : profile.permissions.canBrowse ? 'generate_only' : 'safe_mode',
      defaultFolderByProject: projectKey ? { [projectKey]: projectKey } : {},
      defaultFolderByComponent: {},
      preferredComponents: [],
      preferredFixVersions: [],
      addCommentAfterSync: false,
      transitionAfterCreate: false,
    },
  };
  return normalized;
}

export class JiraCapabilityService {
  private baseUrl = '';
  private headers: HeadersInit = {};
  private serverBasicHeaders: HeadersInit = {};

  async discover(options: JiraCapabilityDiscoveryOptions): Promise<JiraCapabilityProfile> {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!this.baseUrl) throw new Error('Jira Base URL is required.');

    const basicHeaders = {
      Authorization: `Basic ${encodeBasicAuth(options.username, options.token)}`,
      Accept: 'application/json',
    };
    this.serverBasicHeaders = basicHeaders;
    this.headers = options.authType === 'cloud'
      ? basicHeaders
      : { Authorization: `Bearer ${options.token}`, Accept: 'application/json' };

    const apiVersion: '2' | '3' = options.authType === 'cloud' ? '3' : '2';
    const warnings: string[] = [];

    const user = await this.requiredJson<Record<string, unknown>>(`/rest/api/${apiVersion}/myself`, 'Could not validate Jira credentials.');
    const [serverInfo, projects, allFields, issueLinkTypes] = await Promise.all([
      this.optionalJson<Record<string, unknown>>(`/rest/api/2/serverInfo`, warnings, 'Server info unavailable'),
      this.fetchProjects(options.authType, warnings),
      this.optionalJson<Array<Record<string, unknown>>>(`/rest/api/${apiVersion}/field`, warnings, 'Field metadata unavailable'),
      this.optionalJson<Record<string, unknown>>(`/rest/api/${apiVersion}/issueLinkType`, warnings, 'Issue link types unavailable'),
    ]);

    const selectedProject = this.selectProject(projects, options.projectKey);
    const issueTypes = selectedProject ? await this.fetchIssueTypes(selectedProject, apiVersion, warnings) : [];
    const storyIssueType = findByNames(issueTypes, ['Story', 'User Story']);
    const bugIssueType = findByNames(issueTypes, ['Bug', 'Defect']);
    let testIssueType = findByNames(issueTypes.filter(item => !item.subtask), ['Test', 'Xray Test', 'Manual Test']);
    let createFields: Record<string, JiraCapabilityFieldSchema> = {};
    if (selectedProject && testIssueType) {
      createFields = await this.fetchCreateFields(selectedProject, testIssueType, apiVersion, warnings);
    }
    if (selectedProject && !testIssueType) {
      const candidates = issueTypes.filter(item => !item.subtask);
      for (const candidate of candidates) {
        const candidateFields = await this.fetchCreateFields(selectedProject, candidate, apiVersion, warnings);
        const detected = this.detectXrayFields(candidateFields, []);
        if (detected.testTypeFieldId || detected.manualStepsFieldId) {
          testIssueType = candidate;
          createFields = candidateFields;
          break;
        }
      }
    }
    const permissions = selectedProject
      ? await this.fetchPermissions(selectedProject.key, apiVersion, warnings)
      : { canBrowse: false, canCreateIssues: false, canEditIssues: false, canLinkIssues: false, canTransitionIssues: false };

    const visibleFields = Array.isArray(allFields)
      ? allFields.map(field => ({
        id: String(field.id || field.key || ''),
        name: String(field.name || ''),
        type: String((field.schema as { type?: string } | undefined)?.type || ''),
      })).filter(field => field.id && field.name)
      : [];
    const sourceStoryMapping = pickSourceMapping(visibleFields);
    const xrayFields = this.detectXrayFields(createFields, visibleFields);
    const xrayProbe = selectedProject ? await this.probeXray(selectedProject.key, options.xrayMode, warnings) : { supportsNativeSteps: false, supportsRepositoryFolders: false };
    const linking = this.detectLinking(issueLinkTypes);
    const projectDetails = selectedProject
      ? await this.fetchProjectDetails(selectedProject, apiVersion, issueLinkTypes, warnings)
      : { components: [], versions: [], statuses: [], issueLinkTypes: normalizeIssueLinkTypes(issueLinkTypes) };
    const missingRequiredFields = Object.entries(createFields)
      .filter(([key, field]) => field.required && !['project', 'issuetype', 'summary'].includes(key))
      .map(([, field]) => field.name);

    const profile: JiraCapabilityProfile = {
      jiraProfileVersion: 1,
      connection: {
        baseUrl: this.baseUrl,
        deploymentType: options.authType === 'cloud' ? 'cloud' : 'dataCenter',
        apiVersion,
        connected: true,
        lastCheckedAt: new Date().toISOString(),
        buildNumber: serverInfo?.buildNumber ? String(serverInfo.buildNumber) : undefined,
        version: serverInfo?.version ? String(serverInfo.version) : undefined,
      },
      user: {
        accountId: user.accountId ? String(user.accountId) : undefined,
        displayName: user.displayName ? String(user.displayName) : undefined,
        emailAddress: user.emailAddress ? String(user.emailAddress) : undefined,
        timeZone: user.timeZone ? String(user.timeZone) : undefined,
        active: typeof user.active === 'boolean' ? user.active : undefined,
      },
      projects,
      selectedProject,
      projectDetails,
      permissions,
      issueTypes: { story: storyIssueType, test: testIssueType, bug: bugIssueType, all: issueTypes },
      sourceStoryMapping,
      targetTestCreateFields: {
        requiredFields: Object.entries(createFields).filter(([, field]) => field.required).map(([key]) => key),
        fieldSchemas: createFields,
      },
      xray: {
        installed: Boolean(testIssueType || xrayFields.testTypeFieldId || xrayFields.manualStepsFieldId || xrayProbe.supportsRepositoryFolders),
        mode: options.xrayMode && options.xrayMode !== 'auto'
          ? options.xrayMode
          : xrayProbe.supportsRepositoryFolders ? 'server-dc-raven' : xrayFields.manualStepsFieldId ? 'jira-fields' : options.authType === 'cloud' ? 'xray-cloud' : 'unknown',
        supportsNativeSteps: xrayProbe.supportsNativeSteps,
        supportsRepositoryFolders: xrayProbe.supportsRepositoryFolders,
        supportsManualStepsField: Boolean(xrayFields.manualStepsFieldId),
        testTypeFieldId: xrayFields.testTypeFieldId,
        manualStepsFieldId: xrayFields.manualStepsFieldId,
      },
      linking,
      syncStrategy: {
        createInSourceProject: true,
        fallbackWhenNativeStepsFail: xrayFields.manualStepsFieldId ? 'manualStepsField' : 'description',
        transitionAfterCreate: false,
        inheritLabels: true,
        inheritComponents: true,
        inheritVersions: true,
      },
      readiness: {
        canGenerateFromJira: permissions.canBrowse,
        canSyncToXray: Boolean(selectedProject && testIssueType && permissions.canCreateIssues && missingRequiredFields.length === 0),
        missingRequiredFields,
        warnings,
      },
      diagnostics: {
        lastSuccessfulDiscoveryAt: new Date().toISOString(),
        lastDiscoveryWarnings: warnings,
        health: warnings.length > 0 ? 'degraded' : 'connected',
        healthReasons: warnings.length > 0 ? warnings : ['Discovery completed successfully.'],
      },
      privacy: {
        fieldsSentToAi: Object.values(sourceStoryMapping).filter((value): value is string => typeof value === 'string' && value.length > 0),
        excludedFieldsFromAi: [],
        maskSensitiveData: true,
        disableCommentsExtraction: true,
        disableAttachmentMetadataExtraction: false,
        externalAiDisabled: false,
        minimalDataAiMode: false,
        domainAllowlist: [this.baseUrl],
        projectAllowlist: selectedProject?.key ? [selectedProject.key] : [],
      },
      workflow: {
        mode: permissions.canCreateIssues ? 'sync_enabled' : permissions.canBrowse ? 'generate_only' : 'safe_mode',
        defaultFolderByProject: selectedProject?.key ? { [selectedProject.key]: selectedProject.key } : {},
        defaultFolderByComponent: {},
        preferredComponents: [],
        preferredFixVersions: [],
        addCommentAfterSync: false,
        transitionAfterCreate: false,
      },
    };
    profile.featureGroups = buildFeatureGroups(profile, Object.keys(createFields).length > 0);
    return profile;
  }

  async save(profile: JiraCapabilityProfile): Promise<void> {
    const key = this.profileStorageKey(profile);
    const profiles = await this.loadAll();
    await chrome.storage.local.set({
      jiraCapabilityProfile: profile,
      jiraCapabilityProfiles: {
        ...profiles,
        [key]: profile,
      },
    });
  }

  async load(params?: { baseUrl?: string | null; projectKey?: string | null }): Promise<JiraCapabilityProfile | null> {
    return new Promise(resolve => {
      chrome.storage.local.get(['jiraCapabilityProfile', 'jiraCapabilityProfiles'], result => {
        const profiles = (result.jiraCapabilityProfiles as Record<string, JiraCapabilityProfile> | undefined) || {};
        const normalizeLoaded = (profile: JiraCapabilityProfile | undefined): JiraCapabilityProfile | null => {
          if (!profile) return null;
          const normalized = normalizeProfileShape(profile, 'Loaded saved profile.');
          return {
            ...normalized,
            featureGroups: normalized.featureGroups || buildFeatureGroups(normalized, Object.keys(normalized.targetTestCreateFields.fieldSchemas).length > 0),
          };
        };
        const normalizedBase = params?.baseUrl ? normalizeBaseUrl(params.baseUrl) : '';
        const normalizedProject = params?.projectKey?.trim().toUpperCase() || '';
        if (normalizedBase && normalizedProject) {
          const direct = profiles[`${normalizedBase}::${normalizedProject}`];
          if (direct) {
            resolve(normalizeLoaded(direct));
            return;
          }
          resolve(null);
          return;
        }
        resolve(normalizeLoaded(result.jiraCapabilityProfile as JiraCapabilityProfile | undefined));
      });
    });
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(['jiraCapabilityProfile', 'jiraCapabilityProfiles']);
  }

  async importProfile(profile: JiraCapabilityProfile): Promise<JiraCapabilityProfile> {
    const normalizedProfile = normalizeProfileShape(profile, 'Imported profile.');
    normalizedProfile.featureGroups = normalizedProfile.featureGroups || buildFeatureGroups(normalizedProfile, Object.keys(normalizedProfile.targetTestCreateFields.fieldSchemas).length > 0);
    await this.save(normalizedProfile);
    return normalizedProfile;
  }

  private async loadAll(): Promise<Record<string, JiraCapabilityProfile>> {
    return new Promise(resolve => {
      chrome.storage.local.get(['jiraCapabilityProfiles'], result => resolve((result.jiraCapabilityProfiles as Record<string, JiraCapabilityProfile> | undefined) || {}));
    });
  }

  private profileStorageKey(profile: JiraCapabilityProfile): string {
    return `${normalizeBaseUrl(profile.connection.baseUrl)}::${profile.selectedProject?.key || 'GLOBAL'}`;
  }

  async saveXrayFieldDefaults(profile: JiraCapabilityProfile, defaults: Record<string, unknown>): Promise<JiraCapabilityProfile> {
    const updated: JiraCapabilityProfile = {
      ...profile,
      xray: {
        ...profile.xray,
        fieldDefaults: defaults,
      },
    };
    await this.save(updated);
    return updated;
  }

  async saveTestIssueType(profile: JiraCapabilityProfile, issueType: IssueType): Promise<JiraCapabilityProfile> {
    const updated: JiraCapabilityProfile = {
      ...profile,
      issueTypes: {
        ...profile.issueTypes,
        test: issueType,
      },
      readiness: {
        ...profile.readiness,
        canSyncToXray: Boolean(profile.selectedProject && profile.permissions.canCreateIssues && profile.readiness.missingRequiredFields.length === 0),
      },
    };
    await this.save(updated);
    return updated;
  }

  async saveSyncStrategy(profile: JiraCapabilityProfile, syncStrategy: JiraCapabilityProfile['syncStrategy']): Promise<JiraCapabilityProfile> {
    const updated: JiraCapabilityProfile = {
      ...profile,
      syncStrategy,
      workflow: profile.workflow ? {
        ...profile.workflow,
        transitionAfterCreate: syncStrategy.transitionAfterCreate,
      } : profile.workflow,
    };
    await this.save(updated);
    return updated;
  }

  async saveWorkflowSettings(profile: JiraCapabilityProfile, workflow: NonNullable<JiraCapabilityProfile['workflow']>): Promise<JiraCapabilityProfile> {
    const updated: JiraCapabilityProfile = {
      ...profile,
      workflow,
    };
    await this.save(updated);
    return updated;
  }

  async saveSourceStoryMapping(profile: JiraCapabilityProfile, sourceStoryMapping: JiraCapabilityProfile['sourceStoryMapping']): Promise<JiraCapabilityProfile> {
    const updated: JiraCapabilityProfile = {
      ...profile,
      sourceStoryMapping,
    };
    await this.save(updated);
    return updated;
  }

  private async fetchProjects(authType: JiraAuthType, warnings: string[]): Promise<JiraProject[]> {
    const raw = authType === 'cloud'
      ? await this.optionalJson<Record<string, unknown>>('/rest/api/3/project/search', warnings, 'Project search unavailable')
      : await this.optionalJson<unknown[]>('/rest/api/2/project', warnings, 'Project list unavailable');
    const values = Array.isArray(raw) ? raw : Array.isArray(raw?.values) ? raw.values as Record<string, unknown>[] : [];
    return values.map(project => ({
      id: String((project as Record<string, unknown>).id || ''),
      key: String((project as Record<string, unknown>).key || ''),
      name: String((project as Record<string, unknown>).name || ''),
      projectTypeKey: typeof (project as Record<string, unknown>).projectTypeKey === 'string' ? String((project as Record<string, unknown>).projectTypeKey) : undefined,
      simplified: typeof (project as Record<string, unknown>).simplified === 'boolean' ? Boolean((project as Record<string, unknown>).simplified) : undefined,
    })).filter(project => project.id && project.key);
  }

  private selectProject(projects: JiraProject[], projectKey?: string): JiraProject | null {
    const requested = projectKey?.trim().toLowerCase();
    return (requested ? projects.find(project => project.key.toLowerCase() === requested) : undefined) || projects[0] || null;
  }

  private async fetchIssueTypes(project: JiraProject, apiVersion: '2' | '3', warnings: string[]): Promise<IssueType[]> {
    const cloudMeta = apiVersion === '3'
      ? await this.optionalJson<Record<string, unknown>>(`/rest/api/3/issue/createmeta/${encodeURIComponent(project.id || project.key)}/issuetypes`, warnings, 'Issue type create metadata unavailable')
      : null;
    const values = Array.isArray(cloudMeta?.issueTypes) ? cloudMeta.issueTypes as Record<string, unknown>[] : Array.isArray(cloudMeta?.values) ? cloudMeta.values as Record<string, unknown>[] : null;
    if (values) return values.map(normalizeIssueType).filter(type => type.id);

    const projectPayload = await this.optionalJson<Record<string, unknown>>(`/rest/api/${apiVersion}/project/${encodeURIComponent(project.id || project.key)}`, warnings, 'Project issue types unavailable');
    const issueTypes = Array.isArray(projectPayload?.issueTypes) ? projectPayload.issueTypes as Record<string, unknown>[] : [];
    return issueTypes.map(normalizeIssueType).filter(type => type.id);
  }

  private async fetchCreateFields(project: JiraProject, issueType: IssueType, apiVersion: '2' | '3', warnings: string[]): Promise<Record<string, JiraCapabilityFieldSchema>> {
    const projectRef = encodeURIComponent(project.id || project.key);
    const issueTypeId = encodeURIComponent(issueType.id);
    const modern = await this.optionalJson<unknown>(`/rest/api/${apiVersion}/issue/createmeta/${projectRef}/issuetypes/${issueTypeId}?expand=allowedValues`, warnings, 'Modern create field metadata unavailable');
    let fields = normalizeCreateFields(modern);
    if (Object.keys(fields).length > 0) return fields;

    const param = /^\d+$/.test(project.id) ? `projectIds=${encodeURIComponent(project.id)}` : `projectKeys=${encodeURIComponent(project.key)}`;
    const legacy = await this.optionalJson<unknown>(`/rest/api/${apiVersion}/issue/createmeta?${param}&issuetypeIds=${issueTypeId}&expand=projects.issuetypes.fields`, warnings, 'Legacy create field metadata unavailable');
    fields = normalizeCreateFields(legacy);
    return fields;
  }

  private async fetchProjectDetails(
    project: JiraProject,
    apiVersion: '2' | '3',
    issueLinkTypes: Record<string, unknown> | null,
    warnings: string[]
  ): Promise<JiraProjectCapabilityDetails> {
    const projectRef = encodeURIComponent(project.id || project.key);
    const projectKey = encodeURIComponent(project.key);
    const [componentsRaw, versionsRaw, statusesRaw] = await Promise.all([
      this.optionalJson<Record<string, unknown>[] | Record<string, unknown>>(`/rest/api/${apiVersion}/project/${projectRef}/components`, warnings, 'Project components unavailable'),
      this.optionalJson<Record<string, unknown>[] | Record<string, unknown>>(`/rest/api/${apiVersion}/project/${projectRef}/versions`, warnings, 'Project versions unavailable'),
      this.optionalJson<Record<string, unknown>[] | Record<string, unknown>>(`/rest/api/${apiVersion}/project/${projectKey}/statuses`, warnings, 'Project statuses unavailable'),
    ]);
    const toValues = (raw: Record<string, unknown>[] | Record<string, unknown> | null): Record<string, unknown>[] => {
      if (Array.isArray(raw)) return raw;
      if (Array.isArray(raw?.values)) return raw.values as Record<string, unknown>[];
      return [];
    };
    const statuses = toValues(statusesRaw)
      .flatMap(item => Array.isArray(item.statuses) ? item.statuses as Record<string, unknown>[] : [item])
      .map(normalizeWorkflowStatus)
      .filter(status => status.id && status.name);
    return {
      components: toValues(componentsRaw).map(normalizeNamedEntity).filter(item => item.id && item.name),
      versions: toValues(versionsRaw).map(normalizeNamedEntity).filter(item => item.id && item.name),
      statuses,
      issueLinkTypes: normalizeIssueLinkTypes(issueLinkTypes),
    };
  }

  private async fetchPermissions(projectKey: string, apiVersion: '2' | '3', warnings: string[]): Promise<JiraCapabilityProfile['permissions']> {
    const payload = await this.optionalJson<Record<string, unknown>>(`/rest/api/${apiVersion}/mypermissions?projectKey=${encodeURIComponent(projectKey)}`, warnings, 'Project permissions unavailable');
    const permissions = payload?.permissions && typeof payload.permissions === 'object' ? payload.permissions as Record<string, { havePermission?: boolean }> : {};
    const have = (key: string) => Boolean(permissions[key]?.havePermission);
    return {
      canBrowse: have('BROWSE_PROJECTS'),
      canCreateIssues: have('CREATE_ISSUES'),
      canEditIssues: have('EDIT_ISSUES'),
      canLinkIssues: have('LINK_ISSUES'),
      canTransitionIssues: have('TRANSITION_ISSUES'),
      canAddComments: have('ADD_COMMENTS'),
      canDeleteIssues: have('DELETE_ISSUES'),
    };
  }

  private detectXrayFields(createFields: Record<string, JiraCapabilityFieldSchema>, visibleFields: Array<{ id: string; name: string }>) {
    const merged = [
      ...Object.entries(createFields).map(([id, field]) => ({ id, name: field.name })),
      ...visibleFields,
    ];
    return {
      testTypeFieldId: merged.find(field => /^(xray\s*)?test\s*type$/i.test(field.name))?.id,
      manualStepsFieldId: merged.find(field => /manual\s*test\s*steps?|test\s*steps/i.test(field.name))?.id,
    };
  }

  private async probeXray(projectKey: string, xrayMode: JiraCapabilityDiscoveryOptions['xrayMode'], warnings: string[]) {
    if (xrayMode === 'xray-cloud' || xrayMode === 'description-fallback' || xrayMode === 'jira-fields') {
      return { supportsNativeSteps: false, supportsRepositoryFolders: false };
    }
    const foldersV2 = await this.optionalResponse(`/rest/raven/2.0/api/testrepository/${encodeURIComponent(projectKey)}/folders`);
    const foldersV1 = foldersV2.ok ? foldersV2 : await this.optionalResponse(`/rest/raven/1.0/api/testrepository/${encodeURIComponent(projectKey)}/folders`);
    if (!foldersV1.ok && foldersV1.status && ![401, 403, 404].includes(foldersV1.status)) {
      warnings.push('Xray repository probe failed');
    }
    return {
      supportsNativeSteps: false,
      supportsRepositoryFolders: foldersV1.ok,
    };
  }

  private detectLinking(payload: Record<string, unknown> | null): JiraCapabilityProfile['linking'] {
    const types = Array.isArray(payload?.issueLinkTypes) ? payload.issueLinkTypes as Record<string, unknown>[] : [];
    const preferred = types.find(type => /test/i.test(String(type.name || type.outward || type.inward))) || types.find(type => /relates/i.test(String(type.name || '')));
    return {
      preferredLinkType: String(preferred?.name || 'Tests'),
      outward: String(preferred?.outward || 'tests'),
      inward: String(preferred?.inward || 'is tested by'),
      direction: 'test_to_story',
    };
  }

  private async requiredJson<T>(path: string, errorMessage: string): Promise<T> {
    const response = await this.request(path);
    if (!response.ok) throw new Error(errorMessage);
    return response.json() as Promise<T>;
  }

  private async optionalJson<T>(path: string, warnings: string[], warning: string): Promise<T | null> {
    const response = await this.optionalResponse(path);
    if (!response.ok) {
      if (response.status && ![401, 403, 404].includes(response.status)) warnings.push(warning);
      return null;
    }
    return response.json() as Promise<T>;
  }

  private async optionalResponse(path: string): Promise<Response> {
    try {
      return await this.request(path);
    } catch {
      return new Response(null, { status: 599 });
    }
  }

  private async request(path: string): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const primary = await fetch(url, { headers: this.headers });
    if (primary.status !== 401 || this.headers === this.serverBasicHeaders) return primary;
    return fetch(url, { headers: this.serverBasicHeaders });
  }
}

export const jiraCapabilityService = new JiraCapabilityService();

export function isEmptyCapabilityValue(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

export function getMissingRequiredTargetFieldKeys(
  profile: JiraCapabilityProfile | null | undefined,
  defaults: Record<string, unknown> = {}
): string[] {
  if (!profile) return [];
  return profile.targetTestCreateFields.requiredFields
    .filter(fieldKey => !['project', 'issuetype', 'summary', 'description'].includes(fieldKey))
    .filter(fieldKey => isEmptyCapabilityValue(defaults[fieldKey]));
}

export function getMappedSourceStoryFields(profile: JiraCapabilityProfile | null | undefined): Array<{ key: keyof JiraCapabilityProfile['sourceStoryMapping']; label: string; fieldId?: string }> {
  if (!profile) return [];
  return [
    { key: 'acceptanceCriteria', label: 'Acceptance Criteria', fieldId: profile.sourceStoryMapping.acceptanceCriteria },
    { key: 'mainFlow', label: 'Main Flow', fieldId: profile.sourceStoryMapping.mainFlow },
    { key: 'alternativeFlow', label: 'Alternative Flow', fieldId: profile.sourceStoryMapping.alternativeFlow },
    { key: 'businessRules', label: 'Business Rules', fieldId: profile.sourceStoryMapping.businessRules },
    { key: 'expectedBehavior', label: 'Expected Behavior', fieldId: profile.sourceStoryMapping.expectedBehavior },
    { key: 'outOfScope', label: 'Out of Scope', fieldId: profile.sourceStoryMapping.outOfScope },
    { key: 'assumptions', label: 'Assumptions', fieldId: profile.sourceStoryMapping.assumptions },
    { key: 'dependencies', label: 'Dependencies', fieldId: profile.sourceStoryMapping.dependencies },
    { key: 'testNotes', label: 'Test Notes', fieldId: profile.sourceStoryMapping.testNotes },
  ];
}

export function buildJiraReadinessItems(
  profile: JiraCapabilityProfile | null | undefined,
  defaults: Record<string, unknown> = {},
  hasXrayCloudCredentials = false
): JiraReadinessItem[] {
  if (!profile) return [];
  const missingRequired = getMissingRequiredTargetFieldKeys(profile, defaults);
  const mappedSources = getMappedSourceStoryFields(profile).filter(item => item.fieldId).length;
  const requiresCloudCredentials = profile.xray.mode === 'xray-cloud';

  return [
    { key: 'connection', label: 'Jira connected', ok: profile.connection.connected, blocking: true },
    { key: 'project', label: 'Project selected', ok: Boolean(profile.selectedProject), blocking: true },
    { key: 'browse', label: 'Can read stories', ok: profile.permissions.canBrowse, blocking: true },
    { key: 'create', label: 'Can create Test issues', ok: profile.permissions.canCreateIssues, blocking: true },
    { key: 'link', label: 'Can link Tests to Stories', ok: profile.permissions.canLinkIssues, blocking: false },
    { key: 'issueType', label: 'Test issue type found', ok: Boolean(profile.issueTypes.test), blocking: true },
    {
      key: 'requiredDefaults',
      label: 'Required defaults configured',
      ok: missingRequired.length === 0,
      blocking: true,
      detail: missingRequired.map(fieldKey => profile.targetTestCreateFields.fieldSchemas[fieldKey]?.name || fieldKey).join(', '),
    },
    { key: 'sourceFields', label: 'Source fields mapped', ok: mappedSources > 0, blocking: false, detail: mappedSources ? `${mappedSources} mapped` : 'Description only' },
    { key: 'xrayMode', label: 'Xray mode detected', ok: profile.xray.mode !== 'unknown', blocking: false, detail: profile.xray.mode },
    {
      key: 'xrayCloudCredentials',
      label: 'Xray Cloud credentials',
      ok: !requiresCloudCredentials || hasXrayCloudCredentials,
      blocking: requiresCloudCredentials,
      detail: requiresCloudCredentials ? (hasXrayCloudCredentials ? 'Configured' : 'Required for native Cloud publish') : 'Not required',
    },
  ];
}

export function getJiraReadinessScore(items: JiraReadinessItem[]): number | null {
  if (!items.length) return null;
  return Math.round((items.filter(item => item.ok).length / items.length) * 100);
}

export function getBlockingReadinessFailures(items: JiraReadinessItem[]): JiraReadinessItem[] {
  return items.filter(item => item.blocking && !item.ok);
}

export function buildCapabilityFeatures(
  profile: JiraCapabilityProfile | null | undefined,
  hasXrayCloudCredentials = false
): JiraCapabilityFeature[] {
  if (!profile) return [];
  const mappedSources = getMappedSourceStoryFields(profile).filter(item => item.fieldId).length;
  return [
    {
      key: 'storyExtraction',
      label: 'Source story enrichment',
      enabled: profile.permissions.canBrowse && mappedSources > 0,
      detail: mappedSources > 0 ? `${mappedSources} story field mappings active` : 'Using summary and description only',
    },
    {
      key: 'dynamicTestPayload',
      label: 'Dynamic Test payload',
      enabled: Object.keys(profile.targetTestCreateFields.fieldSchemas).length > 0,
      detail: `${profile.targetTestCreateFields.requiredFields.length} required fields detected`,
    },
    {
      key: 'nativeSteps',
      label: 'Native Xray steps',
      enabled: profile.xray.supportsNativeSteps,
      detail: profile.xray.supportsNativeSteps ? 'Raven step API available' : `Fallback: ${profile.syncStrategy.fallbackWhenNativeStepsFail}`,
    },
    {
      key: 'manualStepsField',
      label: 'Manual steps field fallback',
      enabled: profile.xray.supportsManualStepsField,
      detail: profile.xray.manualStepsFieldId || 'Not detected',
    },
    {
      key: 'repositoryFolders',
      label: 'Repository folders',
      enabled: profile.xray.supportsRepositoryFolders,
      detail: profile.xray.supportsRepositoryFolders ? 'Folder publish enabled' : 'Folder path kept as metadata only',
    },
    {
      key: 'issueLinking',
      label: 'Story linking',
      enabled: profile.permissions.canLinkIssues,
      detail: `${profile.linking.preferredLinkType} (${profile.linking.outward}/${profile.linking.inward})`,
    },
    {
      key: 'cloudCredentials',
      label: 'Xray Cloud native publish',
      enabled: profile.xray.mode !== 'xray-cloud' || hasXrayCloudCredentials,
      detail: profile.xray.mode === 'xray-cloud' ? (hasXrayCloudCredentials ? 'Credentials configured' : 'Needs Xray Cloud API credentials') : 'Not a Cloud-native mode',
    },
  ];
}

export function buildXrayTargetDefaults(profile: JiraCapabilityProfile | null | undefined, session: Pick<TabSession, 'xrayFieldDefaults' | 'issueData'>): Record<string, unknown> {
  const issueData = session.issueData;
  const inheritedVersions = profile?.syncStrategy.inheritVersions ? (issueData?.fixVersions || []) : [];
  return {
    ...session.xrayFieldDefaults,
    ...(inheritedVersions.length > 0 ? { fixVersions: inheritedVersions.map(name => ({ name })) } : {}),
  };
}

export function buildXrayPayloadPreview(profile: JiraCapabilityProfile | null | undefined, session: Pick<TabSession, 'issueData' | 'xrayTargetProjectKey' | 'xrayTargetProjectId' | 'xrayTestIssueTypeName' | 'xrayLinkType' | 'xrayFolderPath' | 'xrayFieldDefaults'>) {
  if (!profile || !session.issueData) return null;
  return {
    project: session.xrayTargetProjectKey || profile.selectedProject?.key || session.xrayTargetProjectId,
    issuetype: profile.issueTypes.test?.id || session.xrayTestIssueTypeName,
    linkType: profile.linking.preferredLinkType || session.xrayLinkType,
    folderPath: session.xrayFolderPath || session.issueData.key,
    xrayMode: profile.xray.mode,
    fallback: profile.syncStrategy.fallbackWhenNativeStepsFail,
    fields: Object.fromEntries(
      Object.entries(session.xrayFieldDefaults)
        .filter(([, value]) => !isEmptyCapabilityValue(value))
        .map(([key, value]) => [profile.targetTestCreateFields.fieldSchemas[key]?.name || key, value])
    ),
    inherited: {
      labels: profile.syncStrategy.inheritLabels ? session.issueData.labels || [] : [],
      components: profile.syncStrategy.inheritComponents ? session.issueData.components || [] : [],
      fixVersions: profile.syncStrategy.inheritVersions ? session.issueData.fixVersions || [] : [],
    },
  };
}

export function isIssueInProfileProject(issueData: IssueData | null | undefined, profile: JiraCapabilityProfile | null | undefined): boolean {
  if (!issueData || !profile?.selectedProject?.key) return true;
  return issueData.key.split('-')[0]?.toUpperCase() === profile.selectedProject.key.toUpperCase();
}

function splitRequirementReferences(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  const candidates = lines
    .filter(line => /(^|\b)(AC|BR|REQ|Rule|Flow|\d+[.)-])/i.test(line) || line.length >= 18)
    .map((line, index) => {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      const explicit = cleaned.match(/^((?:AC|BR|REQ)[-\s]?\d+|\d+[.)-])/i)?.[1];
      return explicit ? explicit.replace(/[.)-]$/, '') : `Requirement ${index + 1}`;
    });
  return Array.from(new Set(candidates)).slice(0, 20);
}

export function buildStoryQualityProfile(issueData: IssueData | null | undefined, profile: JiraCapabilityProfile | null | undefined): StoryQualityProfile {
  const descriptionLength = issueData?.description?.trim().length || 0;
  const acLength = issueData?.acceptanceCriteria?.trim().length || 0;
  const mappedSources = getMappedSourceStoryFields(profile).filter(item => item.fieldId).length;
  const linkedTests = issueData?.linkedTestKeys?.length || 0;
  const items: QAInsightItem[] = [
    {
      key: 'summary',
      label: 'Clear summary',
      ok: Boolean(issueData?.summary && issueData.summary.trim().length >= 12),
      severity: issueData?.summary && issueData.summary.trim().length >= 12 ? 'success' : 'warning',
      detail: issueData?.summary ? 'Summary is available for generation context.' : 'No summary found on the active issue.',
    },
    {
      key: 'description',
      label: 'Useful description',
      ok: descriptionLength >= 80,
      severity: descriptionLength >= 80 ? 'success' : descriptionLength > 0 ? 'warning' : 'danger',
      detail: descriptionLength ? `${descriptionLength} characters detected.` : 'No usable description was detected.',
    },
    {
      key: 'acceptanceCriteria',
      label: 'Acceptance criteria',
      ok: acLength >= 60,
      severity: acLength >= 60 ? 'success' : acLength > 0 ? 'warning' : 'danger',
      detail: acLength ? `${splitRequirementReferences(issueData?.acceptanceCriteria || '').length || 1} requirement signals detected.` : 'No acceptance criteria were found.',
    },
    {
      key: 'mappedFields',
      label: 'Mapped story fields',
      ok: mappedSources > 0,
      severity: mappedSources > 0 ? 'success' : 'warning',
      detail: mappedSources > 0 ? `${mappedSources} Jira source fields enrich generation.` : 'Generation will use summary/description only.',
    },
    {
      key: 'existingTests',
      label: 'Existing linked tests',
      ok: linkedTests === 0,
      severity: linkedTests > 0 ? 'warning' : 'success',
      detail: linkedTests > 0 ? `${linkedTests} linked Test issue(s) detected. Review before creating duplicates.` : 'No linked Test issues detected.',
    },
  ];
  const score = Math.round((items.filter(item => item.ok).length / items.length) * 100);
  return {
    score,
    status: score >= 80 ? 'ready' : score >= 50 ? 'usable' : 'weak',
    items,
  };
}

export function buildCoverageMatrix(issueData: IssueData | null | undefined, testCases: TabSession['testCases']): CoverageMatrixItem[] {
  const references = splitRequirementReferences(issueData?.acceptanceCriteria || '');
  const fallbackRefs = references.length ? references : ['Story summary', 'Main scenario'];
  return fallbackRefs.map((reference) => {
    const normalizedReference = reference.toLowerCase();
    const matches = testCases
      .map((testCase, index) => ({ testCase, index }))
      .filter(({ testCase }) => {
        const refs = (testCase.acceptance_criteria_refs || []).join(' ').toLowerCase();
        const body = [
          testCase.title,
          testCase.objective,
          testCase.expected_result,
          testCase.coverage_notes,
          ...(testCase.steps || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return refs.includes(normalizedReference) || body.includes(normalizedReference);
      });
    const status: CoverageMatrixItem['status'] = matches.length > 0
      ? matches.length >= 2 ? 'covered' : 'partial'
      : 'missing';
    return {
      reference,
      status,
      testIndexes: matches.map(item => item.index),
      testTitles: matches.map(item => item.testCase.title || `Test ${item.index + 1}`),
    };
  });
}

export function dryRunXrayPayload(
  profile: JiraCapabilityProfile | null | undefined,
  session: Pick<TabSession, 'issueData' | 'testCases' | 'xrayTargetProjectId' | 'xrayFieldDefaults' | 'xrayTestIssueTypeName'>
): PayloadDryRunResult {
  const issues: QAInsightItem[] = [];
  if (!profile) {
    issues.push({ key: 'profile', label: 'Capability profile', ok: false, severity: 'danger', detail: 'Run Jira discovery before publishing.' });
  }
  if (!session.issueData?.key) {
    issues.push({ key: 'story', label: 'Source story', ok: false, severity: 'danger', detail: 'Open a Jira story before publishing.' });
  }
  if (session.issueData?.key && profile?.selectedProject && !isIssueInProfileProject(session.issueData, profile)) {
    issues.push({
      key: 'projectMismatch',
      label: 'Project mismatch',
      ok: true,
      severity: 'warning',
      detail: `Story is in ${session.issueData.key.split('-')[0]}, while the capability profile targets ${profile.selectedProject.key}.`,
    });
  }
  if (!session.xrayTargetProjectId && !profile?.selectedProject?.id) {
    issues.push({ key: 'project', label: 'Target project', ok: false, severity: 'danger', detail: 'Select an Xray target project.' });
  }
  if (!profile?.issueTypes.test && !session.xrayTestIssueTypeName) {
    issues.push({ key: 'issueType', label: 'Test issue type', ok: false, severity: 'danger', detail: 'Select or discover the Xray Test issue type.' });
  }
  getMissingRequiredTargetFieldKeys(profile, session.xrayFieldDefaults).forEach(fieldKey => {
    issues.push({
      key: `required:${fieldKey}`,
      label: profile?.targetTestCreateFields.fieldSchemas[fieldKey]?.name || fieldKey,
      ok: false,
      severity: 'danger',
      detail: 'Required by Jira create metadata.',
    });
  });
  if (!session.testCases.some(testCase => testCase.selected !== false)) {
    issues.push({ key: 'selectedTests', label: 'Selected tests', ok: false, severity: 'danger', detail: 'Select at least one test case.' });
  }
  session.testCases.forEach((testCase, index) => {
    if (!testCase.title?.trim()) {
      issues.push({ key: `test:${index}:title`, label: `Test ${index + 1} title`, ok: false, severity: 'warning', detail: 'Title is empty.' });
    }
    if (!testCase.steps?.length) {
      issues.push({ key: `test:${index}:steps`, label: `Test ${index + 1} steps`, ok: false, severity: 'warning', detail: 'No execution steps.' });
    }
    if (!testCase.expected_result?.trim()) {
      issues.push({ key: `test:${index}:expected`, label: `Test ${index + 1} expected result`, ok: false, severity: 'warning', detail: 'Expected result is empty.' });
    }
  });
  if (profile && !profile.permissions.canLinkIssues) {
    issues.push({ key: 'link', label: 'Story link', ok: true, severity: 'warning', detail: 'Tests can be created, but linking may be skipped.' });
  }
  return {
    valid: !issues.some(issue => issue.severity === 'danger'),
    issues,
  };
}

export function suggestTestType(issueData: IssueData | null | undefined, testCases: TabSession['testCases'], profile: JiraCapabilityProfile | null | undefined): string {
  const combined = [
    issueData?.summary,
    issueData?.description,
    issueData?.acceptanceCriteria,
    ...testCases.flatMap(testCase => [testCase.title, ...(testCase.steps || [])]),
  ].filter(Boolean).join('\n').toLowerCase();
  const allowed = profile?.xray.testTypeFieldId
    ? profile.targetTestCreateFields.fieldSchemas[profile.xray.testTypeFieldId]?.allowedValues || []
    : [];
  const chooseAllowed = (candidates: string[], fallback: string) => {
    const match = allowed.find(option => candidates.some(candidate =>
      [option.name, option.value, option.label, option.id].filter(Boolean).some(value => String(value).toLowerCase().includes(candidate))
    ));
    return match?.value || match?.name || match?.label || fallback;
  };
  if (/given\s+.*when\s+.*then|gherkin|cucumber/.test(combined)) return chooseAllowed(['cucumber', 'gherkin'], 'Cucumber');
  if (/\bapi\b|endpoint|payload|json|graphql|rest\b/.test(combined)) return chooseAllowed(['generic', 'api'], 'Generic');
  return chooseAllowed(['manual'], 'Manual');
}

export function buildSyncRepairSuggestions(error: string | null | undefined, profile: JiraCapabilityProfile | null | undefined): QAInsightItem[] {
  const message = (error || '').toLowerCase();
  const suggestions: QAInsightItem[] = [];
  if (!message) return suggestions;
  if (/required|missing/.test(message)) {
    suggestions.push({ key: 'required-fields', label: 'Repair required fields', ok: false, severity: 'warning', detail: 'Refresh discovery or fill missing defaults in Detected Test Fields.' });
  }
  if (/option|allowed|valid value|invalid value/.test(message)) {
    suggestions.push({ key: 'allowed-values', label: 'Refresh allowed values', ok: false, severity: 'warning', detail: 'Jira rejected a value. Reconnect & Discover to reload field options.' });
  }
  if (/issue type|issuetype/.test(message)) {
    suggestions.push({ key: 'issue-type', label: 'Repair Test issue type', ok: false, severity: 'warning', detail: 'Select the detected Test issue type again or rerun discovery.' });
  }
  if (/link|permission|403|forbidden/.test(message)) {
    suggestions.push({ key: 'permissions', label: 'Permission repair', ok: false, severity: 'warning', detail: profile?.permissions.canCreateIssues ? 'Create is allowed; check Link Issues or Xray permissions.' : 'Ask a Jira admin for create/link permissions.' });
  }
  if (/xray|raven|step/.test(message)) {
    suggestions.push({ key: 'xray-fallback', label: 'Switch Xray fallback', ok: false, severity: 'warning', detail: 'Use Manual Steps field or Description fallback when native Xray APIs fail.' });
  }
  return suggestions;
}

export function sanitizeJiraCapabilityProfile(profile: JiraCapabilityProfile): Record<string, unknown> {
  return {
    ...profile,
    user: {
      accountId: profile.user.accountId ? 'redacted' : undefined,
      displayName: profile.user.displayName,
      emailAddress: profile.user.emailAddress ? 'redacted' : undefined,
      timeZone: profile.user.timeZone,
      active: profile.user.active,
    },
  };
}

export function buildAdminDiagnosticReport(profile: JiraCapabilityProfile, readinessItems: JiraReadinessItem[] = []): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    connection: profile.connection,
    selectedProject: profile.selectedProject,
    user: sanitizeJiraCapabilityProfile(profile).user,
    permissions: profile.permissions,
    recommendedPermissions: [
      'BROWSE_PROJECTS',
      'CREATE_ISSUES',
      'EDIT_ISSUES',
      'LINK_ISSUES',
      'TRANSITION_ISSUES',
      'ADD_COMMENTS',
    ],
    missingPermissions: [
      !profile.permissions.canBrowse ? 'BROWSE_PROJECTS' : null,
      !profile.permissions.canCreateIssues ? 'CREATE_ISSUES' : null,
      !profile.permissions.canEditIssues ? 'EDIT_ISSUES' : null,
      !profile.permissions.canLinkIssues ? 'LINK_ISSUES' : null,
      !profile.permissions.canTransitionIssues ? 'TRANSITION_ISSUES' : null,
      !profile.permissions.canAddComments ? 'ADD_COMMENTS' : null,
    ].filter(Boolean),
    issueTypes: profile.issueTypes,
    projectDetails: profile.projectDetails,
    sourceStoryMapping: profile.sourceStoryMapping,
    targetTestCreateFields: profile.targetTestCreateFields,
    xray: profile.xray,
    linking: profile.linking,
    workflow: profile.workflow,
    privacy: profile.privacy,
    readiness: {
      ...profile.readiness,
      checklist: readinessItems,
    },
    diagnostics: profile.diagnostics,
    featureGroups: profile.featureGroups,
  };
}

export function buildDryRunReport(
  profile: JiraCapabilityProfile | null | undefined,
  session: Pick<TabSession, 'issueData' | 'testCases' | 'xrayTargetProjectId' | 'xrayTargetProjectKey' | 'xrayFieldDefaults' | 'xrayTestIssueTypeName' | 'xrayLinkType' | 'xrayFolderPath'>
): Record<string, unknown> {
  const dryRun = dryRunXrayPayload(profile, session);
  const payloadPreview = buildXrayPayloadPreview(profile, session);
  return {
    generatedAt: new Date().toISOString(),
    valid: dryRun.valid,
    issues: dryRun.issues,
    selectedProject: profile?.selectedProject,
    sourceIssue: session.issueData,
    selectedIssueType: profile?.issueTypes.test || session.xrayTestIssueTypeName,
    expectedLinkType: profile?.linking.preferredLinkType || session.xrayLinkType,
    expectedFolderPath: session.xrayFolderPath || session.issueData?.key,
    targetFieldDefaults: session.xrayFieldDefaults,
    testCount: session.testCases.filter(testCase => testCase.selected !== false).length,
    payloadPreview,
  };
}

export function buildSessionUpdatesFromJiraProfile(
  profile: JiraCapabilityProfile,
  current?: Partial<TabSession>
): Partial<TabSession> {
  const selectedProject = current?.xrayTargetProjectId
    ? profile.projects.find(project => project.id === current.xrayTargetProjectId) || profile.selectedProject
    : profile.selectedProject;
  const bugIssueType = profile.issueTypes.bug || current?.defaultBugIssueType || null;
  const testIssueType = profile.issueTypes.test || current?.defaultTestCaseIssueType || null;
  const selectedIssueType = current?.selectedIssueType || bugIssueType || testIssueType || profile.issueTypes.story || profile.issueTypes.all[0] || null;

  return {
    jiraCapabilityProfile: profile,
    issueTypes: profile.issueTypes.all.length ? profile.issueTypes.all : current?.issueTypes || [],
    issueTypesFetched: profile.issueTypes.all.length > 0 || current?.issueTypesFetched || false,
    defaultBugIssueType: bugIssueType,
    defaultTestCaseIssueType: testIssueType,
    defaultGapAnalysisIssueType: bugIssueType,
    selectedIssueType,
    xrayProjects: profile.projects,
    xrayTargetProjectId: selectedProject?.id || null,
    xrayTargetProjectKey: selectedProject?.key || null,
    xrayTestIssueTypeName: testIssueType?.name || current?.xrayTestIssueTypeName || 'Test',
    xrayLinkType: profile.linking.preferredLinkType || current?.xrayLinkType || 'Tests',
    xrayPublishSupported: profile.readiness.canSyncToXray || profile.readiness.missingRequiredFields.length === 0,
    xrayPublishMode: profile.xray.mode === 'xray-cloud' ? 'xray_cloud' : 'jira_server',
    xrayUnsupportedReason: profile.readiness.missingRequiredFields.length > 0
      ? `Required fields missing: ${profile.readiness.missingRequiredFields.join(', ')}`
      : null,
    xrayRepositoryPathFieldId: current?.xrayRepositoryPathFieldId || '',
    xrayFieldDefaults: current?.xrayFieldDefaults && Object.keys(current.xrayFieldDefaults).length > 0
      ? current.xrayFieldDefaults
      : profile.xray.fieldDefaults || {},
  };
}

export function getProfileProjectParams(profile: JiraCapabilityProfile | null | undefined): { projectKey?: string; projectId?: string } {
  if (!profile?.selectedProject) return {};
  return {
    projectKey: profile.selectedProject.key,
    projectId: profile.selectedProject.id,
  };
}
