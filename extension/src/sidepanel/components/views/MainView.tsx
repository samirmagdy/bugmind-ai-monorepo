import React, { useEffect, useRef } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { 
  Plus, ChevronDown, Bug,
  Loader2, Send, AlertCircle, Zap, RefreshCw,
  Compass, ArrowRight, Check, Layout, AlertTriangle, BrainCircuit, Paperclip, X, ClipboardList,
  Trash2, Copy, ArrowUp, ArrowDown, Square, CheckSquare, FileText, RotateCcw, RotateCw, History, HelpCircle, Download, Upload
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BugReport, JiraField, JiraFieldOption, JiraUser, SupportingArtifact, TestCase, ManualBugInput, AnalysisCoverageItem, MainWorkflow, TEST_CATEGORIES } from '../../types';
import AutoResizeTextarea from '../common/AutoResizeTextarea';
import { ActionButton, SurfaceCard, StatusBadge, StatusPanel } from '../common/DesignSystem';
import ProductivityPanel from '../common/ProductivityPanel';
import LuxurySearchableSelect, { SelectOption, SelectValue } from '../common/LuxurySearchableSelect';
import { TIMEOUTS } from '../../constants';
import { useI18n } from '../../i18n';
import {
  buildCapabilityFeatures,
  buildAdminDiagnosticReport,
  buildCoverageMatrix,
  buildDryRunReport,
  buildJiraReadinessItems,
  buildStoryQualityProfile,
  buildSyncRepairSuggestions,
  buildXrayPayloadPreview,
  dryRunXrayPayload,
  getJiraReadinessScore,
  getMappedSourceStoryFields,
  getMissingRequiredTargetFieldKeys,
  getProfileProjectParams,
  jiraCapabilityService,
  resolveProfileTargetProject,
  sanitizeJiraCapabilityProfile,
  suggestTestType
} from '../../services/JiraCapabilityService';

const HIDDEN_SYSTEM_FIELD_KEYS = new Set([
  'summary',
  'description',
  'project',
  'issuetype'
]);

type SelectDisplayValue = {
  id?: string | number;
  name?: string;
  value?: string;
  label?: string;
  avatar?: string;
};

type StoredSelectValue = {
  id: string;
  name?: string;
  value?: string;
  label?: string;
  avatar?: string;
};

type ExtraFieldValue =
  | string
  | number
  | boolean
  | null
  | JiraUser
  | JiraFieldOption
  | (JiraUser | JiraFieldOption | string)[];

function isSystemManagedField(field: JiraField): boolean {
  const normalizedKey = field.key.trim().toLowerCase().replace(/[_-]/g, '');
  const normalizedSystem = (field.system || '').trim().toLowerCase();

  return (
    HIDDEN_SYSTEM_FIELD_KEYS.has(field.key.trim().toLowerCase()) ||
    ['summary', 'description', 'project', 'issuetype'].includes(normalizedSystem) ||
    ['projectid', 'issuetypeid', 'pid', 'typeid'].includes(normalizedKey)
  );
}

function hasDisplayLabel(value: unknown): value is SelectDisplayValue {
  return typeof value === 'object' && value !== null && (
    'name' in value ||
    'value' in value ||
    'label' in value
  );
}

function mergeDisplayValue(currentValue: unknown, fallbackValue: unknown): unknown {
  if (Array.isArray(currentValue) && Array.isArray(fallbackValue)) {
    return currentValue.map((item) => {
      if (hasDisplayLabel(item) || typeof item !== 'object' || item === null || !('id' in item)) return item;
      const match = fallbackValue.find((fallbackItem) =>
        typeof fallbackItem === 'object' &&
        fallbackItem !== null &&
        'id' in fallbackItem &&
        fallbackItem.id === item.id
      );
      return match && typeof match === 'object' ? { ...match, ...item } : item;
    });
  }

  if (
    typeof currentValue === 'object' &&
    currentValue !== null &&
    'id' in currentValue &&
    !hasDisplayLabel(currentValue) &&
    typeof fallbackValue === 'object' &&
    fallbackValue !== null &&
    'id' in fallbackValue &&
    fallbackValue.id === currentValue.id
  ) {
    return { ...fallbackValue, ...currentValue };
  }

  return currentValue;
}

function toStoredSelectValue(value: SelectValue): StoredSelectValue {
  if (typeof value === 'object' && value !== null) {
    return {
      id: String(value.id ?? ''),
      name: value.name,
      value: value.value,
      label: value.label,
      avatar: value.avatar
    };
  }

  return { id: String(value ?? '') };
}

function isSelectOption(value: SelectValue | SelectValue[]): value is SelectOption {
  return !Array.isArray(value) && typeof value === 'object' && value !== null;
}

function toAllowedValueOption(option: JiraFieldOption): SelectOption {
  return {
    id: option.id,
    name: option.name,
    value: option.value,
    label: option.label
  };
}

function toUserOption(user: JiraUser): SelectOption {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar
  };
}

function coverageTone(status: string): 'success' | 'warning' | 'info' | 'danger' {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'covered') return 'success';
  if (normalized === 'partial') return 'warning';
  if (normalized === 'missing') return 'danger';
  return 'info';
}

const MainView: React.FC = () => {
  const { 
    session, updateSession, currentTabId, refreshIssue, debug, handleTabReload,
    jira,
    ai: { 
      generateBugs, generateTestCases, handleManualGenerate, 
      handleUpdateBug, handleUpdateTestCase, publishTestCasesToXray, 
      searchUsers, preparePreviewBug, regenerateBug,
      bulkFetchEpic, bulkGenerateTests, bulkAnalyzeStories, bulkCompareBrd, bulkLoadAttachmentAsBrd,
      recordHistory, undoWork, redoWork
    } 
  } = useBugMind();
  const { t } = useI18n();
  const { log } = debug;
  const isRecoveringStalePage = session.error === 'STALE_PAGE' && !session.issueData;
  const staleRecoveryAttemptsRef = useRef(0);
  const artifactInputRef = useRef<HTMLInputElement | null>(null);
  const profileImportInputRef = useRef<HTMLInputElement | null>(null);
  const manualInputs = session.manualInputs?.length ? session.manualInputs : [{ text: '', supportingContext: '', supportingArtifacts: [] }];
  const requiresIssueType = !session.issueData || !session.selectedIssueType?.id || session.issueTypes.length === 0;
  const acceptanceCriteria = session.issueData?.acceptanceCriteria?.trim() || '';
  const descriptionText = session.issueData?.description?.trim() || '';
  const hasStructuredCriteria = acceptanceCriteria.length > 120 || acceptanceCriteria.includes('\n') || acceptanceCriteria.includes('-');
  const recommendedWorkflow = !session.issueData ? null : hasStructuredCriteria ? 'tests' : (acceptanceCriteria.length < 48 && descriptionText.length > 0 ? 'analysis' : 'manual');
  const issueTypeLabel = session.issueData?.typeName?.trim() || 'Issue';
  const activeJiraConnection = session.connections?.find(connection => connection.id === session.jiraConnectionId);
  const targetTestFieldEntries = session.jiraCapabilityProfile
    ? Object.entries(session.jiraCapabilityProfile.targetTestCreateFields.fieldSchemas)
      .filter(([fieldKey]) => !['project', 'issuetype', 'summary', 'description'].includes(fieldKey))
      .map(([key, schema]) => ({ key, schema, required: session.jiraCapabilityProfile?.targetTestCreateFields.requiredFields.includes(key) || false }))
      .sort((a, b) => Number(b.required) - Number(a.required) || a.schema.name.localeCompare(b.schema.name))
    : [];
  const missingXrayRequiredDefaults = getMissingRequiredTargetFieldKeys(session.jiraCapabilityProfile, session.xrayFieldDefaults);
  const readinessChecks = buildJiraReadinessItems(
    session.jiraCapabilityProfile,
    session.xrayFieldDefaults,
    Boolean(activeJiraConnection?.has_xray_cloud_credentials)
  );
  const readinessScore = getJiraReadinessScore(readinessChecks);
  const capabilityFeatures = buildCapabilityFeatures(session.jiraCapabilityProfile, Boolean(activeJiraConnection?.has_xray_cloud_credentials));
  const mappedSourceStoryFields = getMappedSourceStoryFields(session.jiraCapabilityProfile);
  const canGenerateFromProfile = !session.jiraCapabilityProfile || session.jiraCapabilityProfile.permissions.canBrowse;
  const canCreateFromProfile = !session.jiraCapabilityProfile || session.jiraCapabilityProfile.permissions.canCreateIssues;
  const saveXrayDefault = (fieldKey: string, value: unknown) => {
    const nextDefaults = {
      ...session.xrayFieldDefaults,
      [fieldKey]: value
    };
    updateSession({ xrayFieldDefaults: nextDefaults });
    if (session.jiraCapabilityProfile) {
      void jiraCapabilityService.saveXrayFieldDefaults(session.jiraCapabilityProfile, nextDefaults).then((profile) => {
        updateSession({ jiraCapabilityProfile: profile });
      });
    }
  };
  const saveSyncStrategy = (updates: Partial<NonNullable<typeof session.jiraCapabilityProfile>['syncStrategy']>) => {
    const profile = session.jiraCapabilityProfile;
    if (!profile) return;
    const nextSyncStrategy = {
      ...profile.syncStrategy,
      ...updates
    };
    const updatedProfile = {
      ...profile,
      syncStrategy: nextSyncStrategy
    };
    updateSession({ jiraCapabilityProfile: updatedProfile });
    void jiraCapabilityService.saveSyncStrategy(profile, nextSyncStrategy).then((savedProfile) => {
      updateSession({ jiraCapabilityProfile: savedProfile });
    });
  };
  const saveWorkflowSettings = (updates: Partial<NonNullable<typeof session.jiraCapabilityProfile>['workflow']>) => {
    const profile = session.jiraCapabilityProfile;
    if (!profile?.workflow) return;
    const nextWorkflow = {
      ...profile.workflow,
      ...updates
    };
    const updatedProfile = {
      ...profile,
      workflow: nextWorkflow
    };
    updateSession({ jiraCapabilityProfile: updatedProfile });
    void jiraCapabilityService.saveWorkflowSettings(profile, nextWorkflow).then((savedProfile) => {
      updateSession({ jiraCapabilityProfile: savedProfile });
    });
  };
  const xrayPayloadPreview = buildXrayPayloadPreview(session.jiraCapabilityProfile, session);
  const recommendationLabel = !session.issueData
    ? 'Open a Jira issue to enable all workflows.'
    : recommendedWorkflow === 'tests'
      ? 'Recommended: Generate Test Cases for this issue'
      : recommendedWorkflow === 'analysis'
        ? 'Recommended: Run AI Gap Analysis to uncover missing scenarios'
        : 'Recommended: I Found a Bug for quick reporting';
  const workflowOptions: Array<{
    id: Exclude<MainWorkflow, 'home'>;
    title: string;
    description: string;
    detail: string;
    icon: LucideIcon;
    badge?: string;
    tone: 'manual' | 'analysis' | 'tests' | 'bulk';
  }> = [
    {
      id: 'tests',
      title: 'Generate Test Cases',
      description: 'Create Xray-ready tests from story context.',
      detail: 'Best when acceptance criteria are clear enough to validate.',
      icon: Check,
      tone: 'tests'
    },
    {
      id: 'analysis',
      title: 'AI Gap Analysis',
      description: 'Find missing requirements, edge cases, and risks.',
      detail: 'Best before refinement or when the story feels incomplete.',
      icon: Zap,
      tone: 'analysis'
    },
    {
      id: 'manual',
      title: 'I Found a Bug',
      description: 'Turn notes, logs, or repro steps into Jira-ready bugs.',
      detail: 'Best when you already know the defect you want to report.',
      icon: Bug,
      tone: 'manual'
    },
    {
      id: 'bulk',
      title: 'Bulk Epic Workflows',
      description: 'Audit or generate tests across child stories.',
      detail: 'Best for epic-level QA planning and BRD comparisons.',
      icon: Layout,
      badge: 'Beta',
      tone: 'bulk'
    }
  ];

  const updateWorkWithHistory = (label: string, updates: Partial<typeof session>) => {
    recordHistory(label);
    updateSession(updates);
  };

  const setWorkflow = (mainWorkflow: MainWorkflow) => {
    let nextIssueType = session.selectedIssueType;
    if (mainWorkflow === 'manual' && session.defaultBugIssueType) {
      nextIssueType = session.defaultBugIssueType;
    } else if (mainWorkflow === 'analysis' && session.defaultGapAnalysisIssueType) {
      nextIssueType = session.defaultGapAnalysisIssueType;
    } else if ((mainWorkflow === 'tests' || mainWorkflow === 'bulk') && session.defaultTestCaseIssueType) {
      nextIssueType = session.defaultTestCaseIssueType;
    }

    if (nextIssueType && session.selectedIssueType?.id !== nextIssueType.id) {
      updateSession({ mainWorkflow, selectedIssueType: nextIssueType, jiraMetadata: null, error: null });
      void bootstrapJiraConfig(nextIssueType.id, { force: true, loading: true, logTag: 'WORKFLOW-TYPE-SWITCH' });
    } else {
      updateSession({ mainWorkflow, error: null });
    }
  };

  const splitListInput = (value: string) => value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
  const selectedTestCaseCount = session.testCases.filter(testCase => testCase.selected !== false).length;
  const selectedBulkStoryCount = session.bulkSelectedStoryKeys.length;
  const allBulkStoriesSelected = session.bulkStories.length > 0 && selectedBulkStoryCount === session.bulkStories.length;
  const selectedBulkStoriesOutsideProfile = session.jiraCapabilityProfile
    ? session.bulkSelectedStoryKeys.filter(key => key.split('-')[0] !== session.jiraCapabilityProfile?.selectedProject?.key)
    : [];
  const storyQuality = buildStoryQualityProfile(session.issueData, session.jiraCapabilityProfile);
  const coverageMatrix = buildCoverageMatrix(session.issueData, session.testCases);
  const payloadDryRun = dryRunXrayPayload(session.jiraCapabilityProfile, session);
  const repairSuggestions = buildSyncRepairSuggestions(session.error, session.jiraCapabilityProfile);
  const suggestedTestType = suggestTestType(session.issueData, session.testCases, session.jiraCapabilityProfile);
  const missingCoverageCount = coverageMatrix.filter(item => item.status === 'missing').length;
  const highRiskBulkStories = session.bulkStories
    .map(story => ({
      ...story,
      qaRisk: Math.min(100, Math.round(
        (story.risk_score || 0) +
        (!story.description ? 18 : 0) +
        ((story.attachments || []).length > 0 ? 8 : 0) +
        (/blocked|critical|payment|security|permission/i.test(`${story.summary} ${story.status || ''}`) ? 12 : 0)
      ))
    }))
    .sort((a, b) => b.qaRisk - a.qaRisk)
    .slice(0, 5);
  const bulkStepIndex = !session.bulkStories.length
    ? 0
    : selectedBulkStoryCount === 0
      ? 1
      : session.bulkBrdText.trim()
        ? 3
        : 2;
  const bulkSteps = ['Epic', 'Select', 'Action', 'Review'];

  const copySanitizedProfile = async () => {
    if (!session.jiraCapabilityProfile) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(sanitizeJiraCapabilityProfile(session.jiraCapabilityProfile), null, 2));
      updateSession({ success: 'Sanitized Jira capability profile copied.' });
    } catch {
      updateSession({ error: 'Could not copy the sanitized profile.' });
    }
  };

  const downloadJson = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportSanitizedProfile = () => {
    if (!session.jiraCapabilityProfile) return;
    const projectKey = session.jiraCapabilityProfile.selectedProject?.key || 'global';
    downloadJson(sanitizeJiraCapabilityProfile(session.jiraCapabilityProfile), `jira-capability-profile-${projectKey}.json`);
    updateSession({ success: 'Sanitized Jira capability profile exported.' });
  };

  const exportAdminDiagnosticReport = () => {
    if (!session.jiraCapabilityProfile) return;
    const projectKey = session.jiraCapabilityProfile.selectedProject?.key || 'global';
    downloadJson(buildAdminDiagnosticReport(session.jiraCapabilityProfile, readinessChecks), `jira-admin-diagnostic-${projectKey}.json`);
    updateSession({ success: 'Admin diagnostic report exported.' });
  };

  const exportDryRunReport = () => {
    const projectKey = session.jiraCapabilityProfile?.selectedProject?.key || session.issueData?.key?.split('-')[0] || 'global';
    downloadJson(buildDryRunReport(session.jiraCapabilityProfile, session), `jira-dry-run-${projectKey}.json`);
    updateSession({ success: 'Dry-run report exported.' });
  };

  const importCapabilityProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || parsed.jiraProfileVersion !== 1 || !parsed.connection || !parsed.targetTestCreateFields) {
        updateSession({ error: 'The selected file is not a Jira capability profile.' });
        return;
      }
      const importedProfile = await jiraCapabilityService.importProfile(parsed);
      updateSession({ jiraCapabilityProfile: importedProfile, success: 'Jira capability profile imported.' });
    } catch {
      updateSession({ error: 'Could not import the Jira capability profile JSON.' });
    }
  };

  const clearCapabilityProfile = async () => {
    await jiraCapabilityService.clear();
    updateSession({
      jiraCapabilityProfile: null,
      xrayFieldDefaults: {},
      xrayWarnings: [],
      success: 'Saved Jira capability profile cleared from this browser.'
    });
  };

  const applySuggestedTestType = () => {
    if (!suggestedTestType || !session.testCases.length) return;
    updateWorkWithHistory(`Applied ${suggestedTestType} test type`, {
      testCases: session.testCases.map(testCase => ({ ...testCase, test_type: suggestedTestType }))
    });
  };

  const toggleBulkStory = (storyKey: string) => {
    const selected = new Set(session.bulkSelectedStoryKeys);
    if (selected.has(storyKey)) {
      selected.delete(storyKey);
    } else {
      selected.add(storyKey);
    }
    updateSession({ bulkSelectedStoryKeys: Array.from(selected) });
  };

  const setAllBulkStoriesSelected = (selected: boolean) => {
    updateSession({ bulkSelectedStoryKeys: selected ? session.bulkStories.map(story => story.key) : [] });
  };

  const handleBrdFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 600_000) {
      updateSession({ error: 'BRD files must be 600 KB or smaller for browser-side extraction.' });
      event.target.value = '';
      return;
    }
    const acceptedExtensions = /\.(txt|md|csv|json|xml|yaml|yml)$/i;
    if (!file.type.startsWith('text/') && !acceptedExtensions.test(file.name)) {
      updateSession({ error: 'Upload a text-based BRD file here, or paste DOCX/PDF text into the BRD field.' });
      event.target.value = '';
      return;
    }
    const text = (await file.text()).trim();
    updateSession({ bulkBrdText: text, success: `Loaded BRD text from ${file.name}.` });
    event.target.value = '';
  };

  const addTestCase = () => {
    updateWorkWithHistory('Added test case', {
      testCases: [
        ...session.testCases,
        {
          title: 'New test case',
          steps: [''],
          expected_result: '',
          priority: 'Medium',
          selected: true,
          test_type: 'Manual',
          preconditions: '',
          acceptance_criteria_refs: [],
          labels: [],
          components: []
        }
      ]
    });
  };

  const removeTestCase = (index: number) => {
    updateWorkWithHistory(`Deleted test case ${index + 1}`, { testCases: session.testCases.filter((_, idx) => idx !== index) });
  };

  const duplicateTestCase = (index: number) => {
    const source = session.testCases[index];
    if (!source) return;
    const next = [...session.testCases];
    next.splice(index + 1, 0, { ...source, title: `${source.title} (copy)`, steps: [...source.steps] });
    updateWorkWithHistory(`Duplicated test case ${index + 1}`, { testCases: next });
  };

  const moveTestCase = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= session.testCases.length) return;
    const next = [...session.testCases];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateWorkWithHistory(`Moved test case ${index + 1}`, { testCases: next });
  };

  const setAllTestCasesSelected = (selected: boolean) => {
    updateWorkWithHistory(selected ? 'Selected all test cases' : 'Unselected all test cases', { testCases: session.testCases.map(testCase => ({ ...testCase, selected })) });
  };

  const toggleTestGenerationType = (type: string) => {
    const current = session.testGenerationTypes || [];
    const next = current.includes(type)
      ? current.filter(item => item !== type)
      : [...current, type];
    updateSession({ testGenerationTypes: next.length ? next : [type] });
  };

  const updateManualInput = (index: number, value: string) => {
    const nextInputs = [...manualInputs];
    nextInputs[index] = { ...nextInputs[index], text: value };
    updateSession({ manualInputs: nextInputs });
  };

  const addManualInput = () => {
    updateSession({ manualInputs: [...manualInputs, { text: '', supportingContext: '', supportingArtifacts: [] }] });
  };

  const removeManualInput = (index: number) => {
    const nextInputs = manualInputs.filter((_, currentIndex) => currentIndex !== index);
    updateSession({ manualInputs: nextInputs.length ? nextInputs : [{ text: '', supportingContext: '', supportingArtifacts: [] }] });
  };

  const updateManualSupportingContext = (index: number, value: string) => {
    const nextInputs = [...manualInputs];
    nextInputs[index] = { ...nextInputs[index], supportingContext: value };
    updateSession({ manualInputs: nextInputs });
  };

  const removeManualSupportingArtifact = (index: number, artifactId: string) => {
    const nextInputs = [...manualInputs];
    const currentInput = nextInputs[index];
    if (!currentInput) return;
    nextInputs[index] = {
      ...currentInput,
      supportingArtifacts: (currentInput.supportingArtifacts || []).filter((artifact) => artifact.id !== artifactId)
    };
    updateSession({ manualInputs: nextInputs });
  };

  const removeSupportingArtifact = (artifactId: string) => {
    updateSession({
      supportingArtifacts: (session.supportingArtifacts || []).filter((artifact) => artifact.id !== artifactId)
    });
  };

  const handleSupportingFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const acceptedExtensions = /\.(txt|log|md|json|csv|xml|yaml|yml)$/i;
    const nextArtifacts: SupportingArtifact[] = [];
    const rejectedNames: string[] = [];

    for (const file of files) {
      const isTextLike = file.type.startsWith('text/') || file.type === 'application/json' || acceptedExtensions.test(file.name);
      if (!isTextLike || file.size > 300_000) {
        rejectedNames.push(file.name);
        continue;
      }

      const rawContent = await file.text();
      const content = rawContent.trim();
      if (!content) continue;

      nextArtifacts.push({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        name: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        content
      });
    }

    if (nextArtifacts.length > 0) {
      const existing = session.supportingArtifacts || [];
      const merged = [...existing];
      for (const artifact of nextArtifacts) {
        if (!merged.some((item) => item.id === artifact.id)) {
          merged.push(artifact);
        }
      }
      updateSession({
        supportingArtifacts: merged,
        success: rejectedNames.length ? `Skipped unsupported files: ${rejectedNames.join(', ')}` : 'Supporting files added.'
      });
    } else if (rejectedNames.length) {
      updateSession({ error: `Only text-based files up to 300 KB are supported here. Skipped: ${rejectedNames.join(', ')}` });
    }

    event.target.value = '';
  };

  const handleManualSupportingFiles = async (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const acceptedExtensions = /\.(txt|log|md|json|csv|xml|yaml|yml)$/i;
    const nextArtifacts: SupportingArtifact[] = [];
    const rejectedNames: string[] = [];

    for (const file of files) {
      const isTextLike = file.type.startsWith('text/') || file.type === 'application/json' || acceptedExtensions.test(file.name);
      if (!isTextLike || file.size > 300_000) {
        rejectedNames.push(file.name);
        continue;
      }

      const rawContent = await file.text();
      const content = rawContent.trim();
      if (!content) continue;

      nextArtifacts.push({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        name: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        content
      });
    }

    const nextInputs = [...manualInputs];
    const currentInput = nextInputs[index];
    if (currentInput && nextArtifacts.length > 0) {
      const merged = [...(currentInput.supportingArtifacts || [])];
      for (const artifact of nextArtifacts) {
        if (!merged.some((item) => item.id === artifact.id)) {
          merged.push(artifact);
        }
      }
      nextInputs[index] = { ...currentInput, supportingArtifacts: merged };
      updateSession({
        manualInputs: nextInputs,
        success: rejectedNames.length ? `Skipped unsupported files: ${rejectedNames.join(', ')}` : 'Supporting files added.'
      });
    } else if (rejectedNames.length) {
      updateSession({ error: `Only text-based files up to 300 KB are supported here. Skipped: ${rejectedNames.join(', ')}` });
    }

    event.target.value = '';
  };

  const renderSupportingArtifacts = (artifacts: SupportingArtifact[], onRemove: (artifactId: string) => void) => (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="flex items-start justify-between gap-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[var(--text-primary)] truncate">{artifact.name}</div>
            <div className="text-[10px] text-[var(--text-muted)]">{artifact.type || 'text/plain'} • {Math.max(1, Math.round(artifact.size / 1024))} KB</div>
          </div>
          <button
            type="button"
            onClick={() => onRemove(artifact.id)}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label={`Remove ${artifact.name}`}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );

  const supportingContextPanel = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="context-label uppercase tracking-wider block ml-1">Supporting Context</label>
        <AutoResizeTextarea
          value={session.generationSupportingContext}
          onChange={e => updateSession({ generationSupportingContext: e.target.value })}
          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] p-3 text-xs text-[var(--text-secondary)] outline-none min-h-[72px]"
          placeholder="Optional: add logs, constraints, environment notes, or URLs that should influence generation."
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="context-label uppercase tracking-wider block ml-1">Supporting Files</label>
          <button
            type="button"
            onClick={() => artifactInputRef.current?.click()}
            className="flex items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-primary)]"
          >
            <Paperclip size={12} />
            Add Files
          </button>
          <input
            ref={artifactInputRef}
            type="file"
            multiple
            accept=".txt,.log,.md,.json,.csv,.xml,.yaml,.yml,text/*,application/json"
            className="hidden"
            onChange={(event) => { void handleSupportingFiles(event); }}
          />
        </div>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          Upload text logs, JSON, markdown, CSV, or config snippets. These are included as AI support context for bug generation and refinement.
        </p>
        {session.supportingArtifacts.length > 0 && renderSupportingArtifacts(session.supportingArtifacts, removeSupportingArtifact)}
      </div>
    </div>
  );

  const bootstrapJiraConfig = async (issueTypeId?: string, options?: { force?: boolean; loading?: boolean; logTag?: string; errorMessage?: string }) => {
    const profileProject = getProfileProjectParams(session.jiraCapabilityProfile);
    const projectKey = profileProject.projectKey || session.issueData?.key.split('-')[0];
    if (!projectKey || !session.instanceUrl || !session.issueData) return null;

    const force = options?.force ?? true;
    const showLoading = options?.loading ?? false;

    if (showLoading) {
      updateSession({ loading: true }, currentTabId);
    }

    if (options?.logTag) {
      log(options.logTag, `Bootstrapping Jira config for ${projectKey}${issueTypeId ? ` (${issueTypeId})` : ''}`);
    }

    try {
      return await jira.bootstrapContext({
        instanceUrl: session.instanceUrl,
        issueKey: session.issueData.key,
        projectKey,
        projectId: profileProject.projectId || session.jiraMetadata?.project_id || session.issueData.projectId,
        issueTypeId,
        tabId: currentTabId,
        force
      });
    } catch {
      if (options?.errorMessage) {
        updateSession({ error: options.errorMessage }, currentTabId);
      }
      return null;
    } finally {
      if (showLoading) {
        updateSession({ loading: false }, currentTabId);
      }
    }
  };

  useEffect(() => {
    if (!isRecoveringStalePage) {
      staleRecoveryAttemptsRef.current = 0;
      return;
    }

    if (staleRecoveryAttemptsRef.current >= 3) {
      return;
    }

    staleRecoveryAttemptsRef.current += 1;
    const attemptNumber = staleRecoveryAttemptsRef.current;
    const delay = attemptNumber === 1 ? 0 : 2000;

    const timer = window.setTimeout(() => {
      log('STALE-RECOVER', `Automatic Jira recovery attempt ${attemptNumber}/3`);
      refreshIssue(true);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isRecoveringStalePage, log, refreshIssue]);

  // Trigger user search when query changes with 400ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      (session.bugs || []).forEach((bug: BugReport, idx: number) => {
        const q = bug.userSearchQuery || '';
        // Only trigger search if query is 2+ chars, we're not already searching, and it's a NEW query
        if (q.length >= 2 && bug.activeUserSearchField && !bug.isSearchingUsers && q !== bug.lastSearchedQuery) {
          if (session.instanceUrl) {
            const logTag = `SEARCH-${idx}`;
            debug.log(logTag, `Debounce passed. Searching for "${q}"...`);
            searchUsers(q, idx);
          }
        }
      });
    }, TIMEOUTS.USER_SEARCH_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [session.bugs, session.instanceUrl, session.issueData, debug, searchUsers]);

  useEffect(() => {
    const issueKey = session.issueData?.key || '';
    if (!session.testCases.length || !session.jiraConnectionId) return;
    const profile = session.jiraCapabilityProfile;
    if (profile) {
      const selectedProject = resolveProfileTargetProject(profile, session.xrayTargetProjectId);
      const profileFolder = profile.workflow?.defaultFolderByProject?.[selectedProject?.key || ''] || issueKey || '';
      updateSession({
        xrayProjects: profile.projects,
        xrayTargetProjectId: selectedProject?.id || null,
        xrayTargetProjectKey: selectedProject?.key || null,
        xrayFolderPath: session.xrayFolderPath || profileFolder,
        xrayTestIssueTypeName: profile.issueTypes.test?.name || 'Test',
        xrayLinkType: profile.linking.preferredLinkType || 'Tests',
        xrayPublishSupported: profile.readiness.canSyncToXray || profile.readiness.missingRequiredFields.length === 0,
        xrayPublishMode: profile.xray.mode === 'xray-cloud' ? 'xray_cloud' : 'jira_server',
        xrayUnsupportedReason: profile.readiness.missingRequiredFields.length > 0
          ? `Required fields missing: ${profile.readiness.missingRequiredFields.join(', ')}`
          : null
      });
      return;
    }
    if (session.xrayProjects.length > 0 && session.xrayFolderPath === issueKey) return;

    let cancelled = false;
    // Compatibility path for connections that have not completed capability discovery yet.
    jira.fetchXrayDefaults(session.jiraConnectionId, issueKey || undefined).then(defaults => {
      if (cancelled || !defaults) return;
      updateSession({
        xrayProjects: defaults.projects || [],
        xrayTargetProjectId: session.xrayTargetProjectId || defaults.target_project_id || null,
        xrayTargetProjectKey: session.xrayTargetProjectKey || defaults.target_project_key || null,
        xrayFolderPath: defaults.folder_path || issueKey || '',
        xrayTestIssueTypeName: session.xrayTestIssueTypeName || defaults.test_issue_type_name || 'Test',
        xrayLinkType: session.xrayLinkType || defaults.link_type || 'Tests',
        xrayRepositoryPathFieldId: session.xrayRepositoryPathFieldId || defaults.repository_path_field_id || '',
        xrayPublishSupported: defaults.publish_supported ?? true,
        xrayPublishMode: defaults.publish_mode || 'jira_server',
        xrayUnsupportedReason: defaults.unsupported_reason || null
      });
    });

    return () => {
      cancelled = true;
    };
  }, [jira, session.issueData?.key, session.jiraCapabilityProfile, session.jiraConnectionId, session.testCases.length, session.xrayFolderPath, session.xrayLinkType, session.xrayProjects.length, session.xrayRepositoryPathFieldId, session.xrayTargetProjectId, session.xrayTargetProjectKey, session.xrayTestIssueTypeName, updateSession]);

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Issue Context Card */}
      <SurfaceCard className="relative group animate-in slide-in-from-top-4 duration-700">
        {session.issueData ? (
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[var(--text-muted)] text-[11px] font-bold pt-1">{session.issueData.key}</span>
              <div className="flex items-center gap-2">
                <span className="connected-badge">
                  <div className="w-1 h-1 rounded-full bg-[var(--success)] animate-pulse" />
                  Connected
                </span>
                <button 
                  onClick={() => refreshIssue()} 
                  title="Refresh Context"
                  className={`p-1.5 text-[var(--text-muted)] hover:text-[var(--primary-blue)] transition-colors ${session.loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <RefreshCw size={14} className={session.loading ? 'animate-spin' : ''} /> 
                </button>
              </div>
            </div>
            <h2 className="text-[13px] font-bold text-[var(--text-primary)] leading-tight pr-7">
              {session.issueData.summary}
            </h2>
            <div className="context-row pt-2.5 mt-1 border-t border-[var(--border-soft)]">
              <div className="col-span-2">
                <div className="context-label uppercase tracking-wider mb-0.5">Project</div>
                <div className="context-value">{session.issueData.key.split('-')[0]}</div>
              </div>
              <div className="col-span-2">
                <div className="context-label uppercase tracking-wider mb-0.5">Issue Type</div>
                <div className="context-value">{session.issueData.typeName || 'Story'}</div>
              </div>
            </div>
          </div>
        ) : session.error === 'STALE_PAGE' ? (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2 text-[var(--primary-blue)] font-bold text-[12px]">
              <Loader2 size={16} className="animate-spin" />
              Reconnecting to Jira...
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
              BugMind is re-scanning the open Jira tab. This will update as soon as the issue context is available.
            </p>
            <div className="flex gap-2">
              <ActionButton 
                onClick={() => refreshIssue(true)}
                variant="secondary"
                className="flex-1 h-9 text-xs"
              >
                Retry Now
              </ActionButton>
              <ActionButton 
                onClick={() => handleTabReload()} 
                variant="secondary"
                className="flex-1 h-9 text-xs"
              >
                Reload Tab
              </ActionButton>
            </div>
          </div>
        ) : session.error === 'NOT_A_JIRA_PAGE' ? (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] flex items-center justify-center text-[var(--primary-blue)]">
                <Compass size={18} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[var(--text-primary)]">Awaiting Context</h4>
                <p className="text-xs text-[var(--text-secondary)]">Open a Jira ticket to begin analysis.</p>
              </div>
            </div>
            
            <ActionButton 
              onClick={() => window.open('https://atlassian.net', '_blank')}
              variant="primary"
              className="h-10 text-xs"
            >
              Open Jira 
              <ArrowRight size={14} />
            </ActionButton>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <Loader2 className="animate-spin text-[var(--primary-blue)]/40" size={24} />
            <span className="text-xs font-medium text-[var(--text-muted)]">Hunting for context...</span>
          </div>
        )}
        </SurfaceCard>


      {/* Action/List Section */}
      {session.error === 'NOT_A_JIRA_PAGE' ? null : (
        <div className="relative overflow-y-auto flex-1 pt-1 pb-2">
          <SurfaceCard className="mb-3 flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <History size={14} className="text-[var(--primary-blue)]" />
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">{t('history.title')}</div>
                <div className="truncate text-[11px] text-[var(--text-secondary)]">
                  {(session.revisions || [])[0]?.title || t('history.empty')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={undoWork} disabled={!session.undoStack?.length} className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)] disabled:opacity-30" aria-label={t('history.undo')} title={t('history.undo')}>
                <RotateCcw size={13} />
              </button>
              <button type="button" onClick={redoWork} disabled={!session.redoStack?.length} className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)] disabled:opacity-30" aria-label={t('history.redo')} title={t('history.redo')}>
                <RotateCw size={13} />
              </button>
              <button type="button" onClick={() => updateSession({ success: (session.revisions || []).slice(0, 5).map((rev) => `${new Date(rev.createdAt).toLocaleTimeString()} - ${rev.title}`).join('\n') || t('history.empty') })} className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--primary-blue)]" aria-label={t('history.revisions')} title={t('history.revisions')}>
                <HelpCircle size={13} />
              </button>
            </div>
          </SurfaceCard>
          {/* Locked State Overlay */}
          {session.error === 'UNSUPPORTED_ISSUE_TYPE' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-8 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <StatusPanel
                icon={AlertCircle}
                tone="warning"
                title="Requirement Focus"
                description={
                  <span>
                    BugMind is designed for <strong>User Stories</strong>.<br />
                    This issue is identified as a <span className="text-[var(--status-warning)] font-black">{session.issueData?.typeName || 'Other'}</span>.
                  </span>
                }
                action={
                  <ActionButton 
                    onClick={() => refreshIssue(true)}
                    variant="primary"
                    className="w-full text-[10px] uppercase tracking-widest"
                  >
                    <RefreshCw size={12} className="mr-2" />
                    Re-Scan Issue
                  </ActionButton>
                }
                className="shadow-[var(--shadow-card)] w-full"
              />
            </div>
          )}

          {session.error === 'NO_ISSUE_TYPES_FOUND' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-12 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <StatusPanel
                icon={AlertCircle}
                tone="danger"
                title="Permission Restriction"
                description="Jira returned 0 accessible issue types for this instance. This usually means the API Token used does not have permissions to view projects."
                action={
                  <ActionButton 
                    onClick={() => updateSession({ view: 'setup' })}
                    variant="primary"
                    className="w-full text-[10px] uppercase tracking-widest bg-[var(--primary-gradient)] border-0"
                  >
                    <RefreshCw size={12} className="mr-2" />
                    Check Jira Connection
                  </ActionButton>
                }
                className="shadow-[var(--shadow-card)] w-full"
              />
            </div>
          )}

          <div className={`transition-all duration-700 ${['UNSUPPORTED_ISSUE_TYPE', 'NO_ISSUE_TYPES_FOUND'].includes(session.error || '') ? 'blur-md grayscale opacity-30 pointer-events-none pt-4' : ''}`}>
            {(!session.bugs || session.bugs.length === 0) && (!session.testCases || session.testCases.length === 0) ? (
              <div className="space-y-4">
                <ProductivityPanel />
                {session.mainWorkflow === 'home' ? (
                  <SurfaceCard className="space-y-0 cursor-default hover:border-[var(--card-border)] animate-in fade-in slide-in-from-bottom-4 duration-700 overflow-hidden">
                    <div className="space-y-3 pb-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Choose Workflow</div>
                        <StatusBadge tone="info" className="opacity-80">
                          {session.issueData ? `${issueTypeLabel} Detected` : 'Context Needed'}
                        </StatusBadge>
                      </div>
                      <div>
                        <h3 className="workflow-card-title">Start from the next best action</h3>
                        <p className="workflow-card-subtitle">The recommendation changes with the Jira issue context.</p>
                      </div>
                      <div className={`rounded-[8px] border px-3.5 py-3 text-[11px] font-medium leading-relaxed ${
                        session.issueData
                          ? 'border-[var(--border-soft)] bg-[var(--surface-soft)] text-[var(--text-secondary)]'
                          : 'border-[var(--status-warning)]/20 bg-[var(--warning-bg)] text-[var(--text-secondary)]'
                      }`}>
                        <span className="font-bold text-[var(--text-primary)]">{recommendationLabel}</span>
                        {session.issueData && (
                          <span className="block mt-1">
                            {recommendedWorkflow === 'tests'
                              ? 'Create Xray-ready coverage from the current acceptance criteria.'
                              : recommendedWorkflow === 'analysis'
                                ? 'Get a report of missing requirements, edge cases, and functional risks.'
                                : 'Generate structured Jira-ready bugs instantly from your notes.'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-[var(--border-soft)] pt-3">
                      {workflowOptions.map((option) => {
                        const Icon = option.icon;
                        const isRecommended = recommendedWorkflow === option.id;
                        const badgeTone = option.id === 'tests' ? 'success' : option.id === 'bulk' ? 'info' : 'neutral';
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setWorkflow(option.id)}
                            className={`workflow-choice workflow-choice-${option.tone} ${isRecommended ? 'workflow-choice-recommended' : ''}`}
                          >
                            <span className="workflow-choice-icon">
                              <Icon size={18} />
                            </span>
                            <span className="min-w-0 flex-1 text-left">
                              <span className="flex items-center gap-2">
                                <span className="workflow-card-title text-[13px]">{option.title}</span>
                                {(isRecommended || option.badge) && (
                                  <StatusBadge tone={isRecommended ? badgeTone : 'info'}>
                                    {isRecommended ? 'Recommended' : option.badge}
                                  </StatusBadge>
                                )}
                              </span>
                              <span className="workflow-card-subtitle block">{option.description}</span>
                              <span className="mt-1 block text-[10px] leading-relaxed text-[var(--text-muted)]">{option.detail}</span>
                            </span>
                            <span className="workflow-choice-cta">
                              Start
                              <ArrowRight size={14} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </SurfaceCard>
                ) : (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
                    <SurfaceCard className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setWorkflow('home')} className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--card-border)] bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            <ArrowRight size={14} className="rotate-180" />
                          </button>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Workflow</div>
                            <h3 className="workflow-card-title">
                              {session.mainWorkflow === 'manual'
                                ? 'I Found a Bug'
                                : session.mainWorkflow === 'analysis'
                                  ? 'AI Gap Analysis'
                                  : session.mainWorkflow === 'bulk'
                                    ? 'Bulk Epic Workflows'
                                    : 'Generate Test Cases'}
                            </h3>
                          </div>
                        </div>
                        <div className="step-badge">
                          {session.mainWorkflow === 'manual' ? 'BUG' : session.mainWorkflow === 'analysis' ? 'AI' : session.mainWorkflow === 'bulk' ? 'BULK' : 'QA'}
                        </div>
                      </div>

                      {session.mainWorkflow !== 'manual' && (
                        <div className="space-y-2">
                          <label className="context-label uppercase tracking-wider mb-1.5 block ml-1">Analysis Context</label>
                          <LuxurySearchableSelect
                            options={session.issueTypes.map(t => ({ id: t.id, name: t.name, avatar: t.icon_url }))}
                            value={session.selectedIssueType}
                            placeholder="Select issue type..."
                            onChange={(type) => {
                              if (type && !Array.isArray(type) && session.jiraConnectionId && session.issueData) {
                                const selectedType = session.issueTypes.find((issueType) => issueType.id === (isSelectOption(type) ? type.id : type));
                                if (!selectedType) return;
                                updateSession({ selectedIssueType: selectedType, jiraMetadata: null });
                                void bootstrapJiraConfig(selectedType.id, { force: true, loading: true, logTag: 'MAIN-TYPE-SWITCH' });
                              }
                            }}
                          />
                        </div>
                      )}

                      {session.mainWorkflow === 'manual' ? (
                        <div className="space-y-3">
                          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                            Add one or more bug descriptions. Each input will be structured as a separate Jira-ready bug report.
                          </p>
                          <div className="space-y-3">
                            {manualInputs.map((manualInput: ManualBugInput, index) => (
                              <div key={`manual-input-${index}`} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <label className="context-label uppercase tracking-wider block ml-1">Bug Input {index + 1}</label>
                                  {manualInputs.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeManualInput(index)}
                                      className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--error)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                                <AutoResizeTextarea
                                  className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] p-3 text-sm outline-none focus:border-[var(--border-active)] min-h-[96px]"
                                  placeholder="Describe the issue in plain English. This input becomes one bug."
                                  value={manualInput.text}
                                  onChange={e => updateManualInput(index, e.target.value)}
                                />
                                <div className="space-y-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)]/65 p-3">
                                  <div className="space-y-1.5">
                                    <label className="context-label uppercase tracking-wider block ml-1">Bug-Specific Logs / Notes</label>
                                    <AutoResizeTextarea
                                      value={manualInput.supportingContext}
                                      onChange={e => updateManualSupportingContext(index, e.target.value)}
                                      className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] p-3 text-xs text-[var(--text-secondary)] outline-none min-h-[72px]"
                                      placeholder="Stack traces, log excerpts, environment details, or anything specific to this bug."
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <label className="context-label uppercase tracking-wider block ml-1">Bug-Specific Files</label>
                                      <label
                                        htmlFor={`manual-artifacts-${index}`}
                                        className="flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-primary)]"
                                      >
                                        <Paperclip size={12} />
                                        Add Files
                                      </label>
                                      <input
                                        id={`manual-artifacts-${index}`}
                                        type="file"
                                        multiple
                                        accept=".txt,.log,.md,.json,.csv,.xml,.yaml,.yml,text/*,application/json"
                                        className="hidden"
                                        onChange={(event) => { void handleManualSupportingFiles(index, event); }}
                                      />
                                    </div>
                                    {(manualInput.supportingArtifacts || []).length > 0 && renderSupportingArtifacts(
                                      manualInput.supportingArtifacts || [],
                                      (artifactId) => removeManualSupportingArtifact(index, artifactId)
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <ActionButton onClick={addManualInput} variant="secondary" className="h-10 w-full text-[12px]">
                            <Plus size={15} />
                            Add Another Bug
                          </ActionButton>
                          <ActionButton
                            onClick={() => handleManualGenerate()}
                            variant="primary"
                            disabled={session.loading || manualInputs.every(input => !input.text.trim()) || !canGenerateFromProfile}
                            className="h-11"
                          >
                            <Zap size={16} />
                            Generate Structured Bugs
                          </ActionButton>
                        </div>
                      ) : session.mainWorkflow === 'analysis' ? (
                        <div className="space-y-3">
                          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                            Analyze the story and acceptance criteria to surface hidden requirements, edge cases, and functional risk.
                          </p>
                          <div className="space-y-2">
                            <label className="context-label uppercase tracking-wider mb-1.5 block ml-1">Finding Count</label>
                            <div className="grid grid-cols-3 gap-2">
                              {[3, 5, 7].map((count) => (
                                <button
                                  key={count}
                                  type="button"
                                  onClick={() => updateSession({ bugGenerationCount: count })}
                                  disabled={session.loading}
                                  className={`rounded-[0.95rem] border px-3 py-2 text-[11px] font-bold ${
                                    session.bugGenerationCount === count
                                      ? 'border-[var(--border-active)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                                      : 'border-[var(--border-soft)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {count} Bugs
                                </button>
                              ))}
                            </div>
                          </div>
                          {supportingContextPanel}
                          <ActionButton 
                            onClick={generateBugs}
                            variant="primary"
                            className="h-11 text-[13px]"
                            disabled={requiresIssueType || session.loading || !canGenerateFromProfile}
                          >
                            <Zap size={16} />
                            Run Gap Analysis
                          </ActionButton>
                        </div>
                      ) : session.mainWorkflow === 'bulk' ? (
                        <div className="space-y-4">
                          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                            Start from an Epic, choose the stories to process, then run bulk test generation, cross-story audit, or BRD comparison.
                          </p>

                          <div className="grid grid-cols-4 gap-1 rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-1">
                            {bulkSteps.map((step, index) => (
                              <div
                                key={step}
                                className={`rounded-[8px] px-2 py-2 text-center text-[9px] font-black uppercase tracking-[0.12em] ${
                                  index <= bulkStepIndex
                                    ? 'bg-[var(--bg-elevated)] text-[var(--primary-blue)]'
                                    : 'text-[var(--text-muted)]'
                                }`}
                              >
                                {index + 1}. {step}
                              </div>
                            ))}
                          </div>

                          <div className="space-y-2">
                            <label className="context-label uppercase tracking-wider mb-1.5 block ml-1">Epic Key</label>
                            <div className="flex gap-2">
                              <input
                                value={session.bulkEpicKey}
                                onChange={e => updateSession({ bulkEpicKey: e.target.value.toUpperCase() })}
                                className="min-w-0 flex-1 bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] px-3 py-2.5 text-xs font-bold text-[var(--text-primary)] outline-none"
                                placeholder={session.issueData?.key || 'PROJ-100'}
                              />
                              <ActionButton
                                onClick={bulkFetchEpic}
                                variant="secondary"
                                disabled={session.loading || !session.jiraConnectionId || !session.bulkEpicKey.trim()}
                                className="h-10 px-4 text-[11px]"
                              >
                                <RefreshCw size={14} className={session.loading ? 'animate-spin' : ''} />
                                Fetch
                              </ActionButton>
                            </div>
                          </div>

                          {session.bulkProgressMessage && (
                            <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-3">
                              <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-[var(--text-primary)]">
                                <span>{session.bulkProgressMessage}</span>
                                <span>{session.bulkProgressPercent}%</span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]">
                                <div
                                  className="h-full rounded-full bg-[var(--primary-blue)] transition-all"
                                  style={{ width: `${session.bulkProgressPercent}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {highRiskBulkStories.length > 0 && (
                            <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Bulk Risk Priority</div>
                                  <div className="text-[11px] text-[var(--text-secondary)]">Auto-ranked from risk score, missing detail, attachments, and sensitive workflow terms.</div>
                                </div>
                                <StatusBadge tone="warning">{highRiskBulkStories.length} Focus</StatusBadge>
                              </div>
                              <div className="grid grid-cols-1 gap-2">
                                {highRiskBulkStories.map(story => (
                                  <button
                                    key={story.key}
                                    type="button"
                                    onClick={() => {
                                      if (!session.bulkSelectedStoryKeys.includes(story.key)) {
                                        updateSession({ bulkSelectedStoryKeys: [...session.bulkSelectedStoryKeys, story.key] });
                                      }
                                    }}
                                    className="flex items-start justify-between gap-3 rounded-[0.9rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2 text-left"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-black text-[var(--text-primary)]">{story.key}</div>
                                      <div className="text-[10px] text-[var(--text-muted)] truncate">{story.summary}</div>
                                    </div>
                                    <StatusBadge tone={story.qaRisk >= 70 ? 'danger' : story.qaRisk >= 45 ? 'warning' : 'info'}>
                                      {story.qaRisk}
                                    </StatusBadge>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {session.bulkStories.length > 0 && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="context-label uppercase tracking-wider mb-0.5">Stories</div>
                                  <div className="text-[12px] font-bold text-[var(--text-primary)]">{selectedBulkStoryCount}/{session.bulkStories.length} selected</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setAllBulkStoriesSelected(!allBulkStoriesSelected)}
                                  className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--primary-blue)]"
                                >
                                  {allBulkStoriesSelected ? 'Clear' : 'Select All'}
                                </button>
                              </div>

                              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                                {session.bulkStories.map((story) => {
                                  const selected = session.bulkSelectedStoryKeys.includes(story.key);
                                  const riskTone = story.risk_score >= 60 ? 'danger' : story.risk_score >= 35 ? 'warning' : 'success';
                                  return (
                                    <button
                                      key={story.key}
                                      type="button"
                                      onClick={() => toggleBulkStory(story.key)}
                                      className={`w-full rounded-[1rem] border px-3 py-3 text-left transition-colors ${
                                        selected
                                          ? 'border-[var(--border-active)] bg-[var(--surface-accent)]'
                                          : 'border-[var(--border-soft)] bg-[var(--bg-input)] hover:bg-[var(--surface-soft)]'
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2">
                                            {selected ? <CheckSquare size={14} className="text-[var(--primary-blue)]" /> : <Square size={14} className="text-[var(--text-muted)]" />}
                                            <span className="text-[11px] font-black text-[var(--text-primary)]">{story.key}</span>
                                            {story.status && <span className="text-[10px] text-[var(--text-muted)]">{story.status}</span>}
                                          </div>
                                          <div className="mt-1 line-clamp-2 text-[12px] font-bold text-[var(--text-primary)]">{story.summary}</div>
                                          {story.risk_reasons.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                              {story.risk_reasons.slice(0, 3).map((reason) => (
                                                <span key={`${story.key}-${reason}`} className="rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                                                  {reason.replace(/_/g, ' ')}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <StatusBadge tone={riskTone}>{story.risk_score}</StatusBadge>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>

                              {session.bulkEpicAttachments.length > 0 && (
                                <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-3">
                                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                    <Paperclip size={12} />
                                    Epic Attachments
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {session.bulkEpicAttachments.map((attachment) => (
                                      <button
                                        key={attachment.id}
                                        type="button"
                                        onClick={() => { void bulkLoadAttachmentAsBrd(attachment.id); }}
                                        disabled={session.loading}
                                        className="rounded-full border border-[var(--border-soft)] bg-[var(--bg-input)] px-2.5 py-1 text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                                        title="Load attachment as BRD text"
                                      >
                                        {attachment.filename}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-1 gap-2">
                                {selectedBulkStoriesOutsideProfile.length > 0 && (
                                  <StatusPanel
                                    tone="warning"
                                    title="Project Profile Mismatch"
                                    description={`Selected stories outside ${session.jiraCapabilityProfile?.selectedProject?.key}: ${selectedBulkStoriesOutsideProfile.join(', ')}`}
                                    icon={AlertTriangle}
                                  />
                                )}
                                <ActionButton
                                  onClick={bulkGenerateTests}
                                  variant="primary"
                                  disabled={session.loading || selectedBulkStoryCount === 0 || requiresIssueType || !canGenerateFromProfile || selectedBulkStoriesOutsideProfile.length > 0}
                                  className="h-10 text-[12px]"
                                >
                                  <Check size={15} />
                                  Generate Tests for Selected
                                </ActionButton>
                                <ActionButton
                                  onClick={bulkAnalyzeStories}
                                  variant="secondary"
                                  disabled={session.loading || selectedBulkStoryCount === 0 || requiresIssueType || !canGenerateFromProfile || selectedBulkStoriesOutsideProfile.length > 0}
                                  className="h-10 text-[12px]"
                                >
                                  <BrainCircuit size={15} />
                                  Run Cross-Story Audit
                                </ActionButton>
                              </div>
                            </div>
                          )}

                          <div className="space-y-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)]/65 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="context-label uppercase tracking-wider mb-0.5">BRD Compare</div>
                                <div className="text-[11px] text-[var(--text-muted)]">Paste BRD text or load a text document.</div>
                              </div>
                              <label className="flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-primary)]">
                                <FileText size={12} />
                                Load
                                <input
                                  type="file"
                                  accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,text/*,application/json"
                                  className="hidden"
                                  onChange={(event) => { void handleBrdFile(event); }}
                                />
                              </label>
                            </div>
                            <AutoResizeTextarea
                              value={session.bulkBrdText}
                              onChange={e => updateSession({ bulkBrdText: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] p-3 text-xs text-[var(--text-secondary)] outline-none min-h-[92px]"
                              placeholder="Paste BRD requirements here."
                            />
                            <ActionButton
                              onClick={bulkCompareBrd}
                              variant="secondary"
                              disabled={session.loading || selectedBulkStoryCount === 0 || requiresIssueType || !session.bulkBrdText.trim() || !canGenerateFromProfile || selectedBulkStoriesOutsideProfile.length > 0}
                              className="h-10 text-[12px]"
                            >
                              <ClipboardList size={15} />
                              Compare BRD to Selected Stories
                            </ActionButton>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                            Generate comprehensive QA-ready test cases from the current story and prepare them for direct Jira Xray publishing.
                          </p>
                          <div className="space-y-2">
                            <label className="context-label uppercase tracking-wider mb-1.5 block ml-1">Test Coverage Types</label>
                            <div className="grid grid-cols-2 gap-2">
                              {(TEST_CATEGORIES as readonly string[]).map((type) => (
                                <button
                                  key={type}
                                  type="button"
                                  onClick={() => toggleTestGenerationType(type)}
                                  disabled={session.loading}
                                  className={`rounded-[0.95rem] border px-3 py-2 text-[10px] font-bold ${
                                    (session.testGenerationTypes || []).includes(type)
                                      ? 'border-[var(--border-active)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                                      : 'border-[var(--border-soft)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {type}
                                </button>
                              ))}
                            </div>
                          </div>
                          {supportingContextPanel}
                          <ActionButton 
                            onClick={generateTestCases}
                            variant="primary"
                            className="h-11 text-[13px]"
                            disabled={requiresIssueType || session.loading || !canGenerateFromProfile}
                          >
                            <Check size={16} />
                            Generate Test Cases
                          </ActionButton>
                        </div>
                      )}

                      {requiresIssueType && session.mainWorkflow !== 'manual' && (
                        <div className="flex items-center justify-center gap-2 pt-1 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider">
                          <Loader2 size={10} className="animate-spin" />
                          Fetching project metadata...
                        </div>
                      )}
                    </SurfaceCard>
                  </div>
                )}
              </div>
                  ) : session.testCases && session.testCases.length > 0 ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">{session.testCases.length} Test Assets</h3>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setAllTestCasesSelected(selectedTestCaseCount !== session.testCases.length)}
                      className="text-xs font-bold text-[var(--text-muted)]"
                    >
                      {selectedTestCaseCount === session.testCases.length ? 'Unselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={addTestCase}
                      className="text-xs font-bold text-[var(--primary-blue)]"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => exportDryRunReport()}
                      className="text-xs font-bold text-[var(--primary-blue)]"
                    >
                      Export
                    </button>
                    <button 
                      onClick={() => updateWorkWithHistory('Cleared test cases', { testCases: [], coverageScore: null, gapAnalysisSummary: null, error: null, createdIssues: [], xrayWarnings: [], mainWorkflow: 'home' })} 
                      className="text-xs font-bold text-[var(--error)]"
                    >
                      Clear
                    </button>
                    <button 
                      onClick={generateTestCases} 
                      disabled={session.loading || requiresIssueType || !canGenerateFromProfile}
                      className="text-xs font-bold text-[var(--primary-blue)]"
                    >
                      Retry
                    </button>
                  </div>
                </div>

                <SurfaceCard className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">QA Control Center</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Pre-publish checks from the discovered Jira/Xray profile and the current story.</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <StatusBadge tone={storyQuality.status === 'ready' ? 'success' : storyQuality.status === 'usable' ? 'warning' : 'danger'}>
                        Story {storyQuality.score}%
                      </StatusBadge>
                      <StatusBadge tone={payloadDryRun.valid ? 'success' : 'danger'}>
                        {payloadDryRun.valid ? 'Payload Ready' : 'Payload Needs Fix'}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Story Quality</div>
                        <StatusBadge tone={storyQuality.status === 'ready' ? 'success' : storyQuality.status === 'usable' ? 'warning' : 'danger'}>
                          {storyQuality.status}
                        </StatusBadge>
                      </div>
                      {storyQuality.items.map(item => (
                        <div key={item.key} className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
                          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${item.ok ? 'bg-[var(--success)]' : item.severity === 'danger' ? 'bg-[var(--error)]' : 'bg-[var(--warning)]'}`} />
                          <div>
                            <div className="font-bold text-[var(--text-primary)]">{item.label}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">{item.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Dry Run</div>
                        <StatusBadge tone={payloadDryRun.valid ? 'success' : 'danger'}>
                          {payloadDryRun.issues.length} signal{payloadDryRun.issues.length === 1 ? '' : 's'}
                        </StatusBadge>
                      </div>
                      {payloadDryRun.issues.length === 0 ? (
                        <div className="text-[11px] text-[var(--text-secondary)]">Jira create payload has the required project, issue type, fields, and selected tests.</div>
                      ) : (
                        payloadDryRun.issues.slice(0, 5).map(item => (
                          <div key={item.key} className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
                            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${item.severity === 'danger' ? 'bg-[var(--error)]' : 'bg-[var(--warning)]'}`} />
                            <div>
                              <div className="font-bold text-[var(--text-primary)]">{item.label}</div>
                              <div className="text-[10px] text-[var(--text-muted)]">{item.detail}</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <input
                    ref={profileImportInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={importCapabilityProfile}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <ActionButton type="button" variant="secondary" onClick={applySuggestedTestType} disabled={!session.testCases.length}>
                      <Check size={14} />
                      Use {suggestedTestType}
                    </ActionButton>
                    <ActionButton type="button" variant="secondary" onClick={() => updateSession({ view: 'setup' })}>
                      <RefreshCw size={14} />
                      Reconnect & Discover
                    </ActionButton>
                    <ActionButton type="button" variant="secondary" onClick={copySanitizedProfile} disabled={!session.jiraCapabilityProfile}>
                      <Copy size={14} />
                      Copy Profile
                    </ActionButton>
                    <ActionButton type="button" variant="secondary" onClick={exportSanitizedProfile} disabled={!session.jiraCapabilityProfile}>
                      <Download size={14} />
                      Export Profile
                    </ActionButton>
                    <ActionButton type="button" variant="secondary" onClick={exportAdminDiagnosticReport} disabled={!session.jiraCapabilityProfile}>
                      <FileText size={14} />
                      Admin Report
                    </ActionButton>
                    <ActionButton type="button" variant="secondary" onClick={exportDryRunReport} disabled={!session.issueData}>
                      <ClipboardList size={14} />
                      Dry-Run Report
                    </ActionButton>
                    <ActionButton type="button" variant="secondary" onClick={() => profileImportInputRef.current?.click()}>
                      <Upload size={14} />
                      Import Profile
                    </ActionButton>
                    <ActionButton type="button" variant="secondary" onClick={clearCapabilityProfile} disabled={!session.jiraCapabilityProfile}>
                      <Trash2 size={14} />
                      Clear Profile
                    </ActionButton>
                  </div>

                  {session.jiraCapabilityProfile?.featureGroups && (
                    <SurfaceCard className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Full Capability Matrix</div>
                          <div className="text-[11px] text-[var(--text-secondary)]">Every requested feature area is tracked as supported, partial, blocked, or planned.</div>
                        </div>
                        <StatusBadge tone="info">
                          {session.jiraCapabilityProfile.featureGroups.filter(group => group.status === 'supported').length}/{session.jiraCapabilityProfile.featureGroups.length} Complete
                        </StatusBadge>
                      </div>
                      {session.jiraCapabilityProfile.projectDetails && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Components</div>
                            <div className="text-[11px] text-[var(--text-secondary)] truncate">
                              {session.jiraCapabilityProfile.projectDetails.components.slice(0, 4).map(item => item.name).join(', ') || 'None detected'}
                            </div>
                          </div>
                          <div className="rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Versions</div>
                            <div className="text-[11px] text-[var(--text-secondary)] truncate">
                              {session.jiraCapabilityProfile.projectDetails.versions.slice(0, 4).map(item => item.name).join(', ') || 'None detected'}
                            </div>
                          </div>
                          <div className="rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Workflow Statuses</div>
                            <div className="text-[11px] text-[var(--text-secondary)] truncate">
                              {session.jiraCapabilityProfile.projectDetails.statuses.slice(0, 4).map(item => item.name).join(', ') || 'None detected'}
                            </div>
                          </div>
                          <div className="rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Link Types</div>
                            <div className="text-[11px] text-[var(--text-secondary)] truncate">
                              {session.jiraCapabilityProfile.projectDetails.issueLinkTypes.slice(0, 4).map(item => item.name).join(', ') || 'None detected'}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-2">
                        {session.jiraCapabilityProfile.featureGroups.map(group => (
                          <details key={group.key} className="rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2">
                            <summary className="cursor-pointer list-none">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-[11px] font-bold text-[var(--text-primary)]">{group.label}</div>
                                  <div className="text-[10px] text-[var(--text-muted)]">{group.features.filter(feature => feature.status === 'supported').length}/{group.features.length} supported</div>
                                </div>
                                <StatusBadge tone={group.status === 'supported' ? 'success' : group.status === 'blocked' ? 'danger' : group.status === 'partial' ? 'warning' : 'info'}>
                                  {group.status}
                                </StatusBadge>
                              </div>
                            </summary>
                            <div className="mt-3 space-y-2">
                              {group.features.map(feature => (
                                <div key={feature.key} className="flex items-start justify-between gap-3 border-t border-[var(--border-soft)] pt-2">
                                  <div>
                                    <div className="text-[11px] font-semibold text-[var(--text-primary)]">{feature.label}</div>
                                    <div className="text-[10px] text-[var(--text-muted)]">{feature.detail}</div>
                                  </div>
                                  <StatusBadge tone={feature.status === 'supported' ? 'success' : feature.status === 'blocked' ? 'danger' : feature.status === 'partial' ? 'warning' : 'info'}>
                                    {feature.status}
                                  </StatusBadge>
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    </SurfaceCard>
                  )}

                  {session.issueData?.linkedTestKeys && session.issueData.linkedTestKeys.length > 0 && (
                    <StatusPanel
                      tone="warning"
                      icon={AlertTriangle}
                      title="Existing Linked Tests Detected"
                      description={`Review existing Tests before creating duplicates: ${session.issueData.linkedTestKeys.join(', ')}`}
                    />
                  )}

                  {repairSuggestions.length > 0 && (
                    <div className="rounded-[1rem] border border-[var(--warning)]/30 bg-[var(--warning)]/5 p-3 space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[var(--warning)]">Auto Repair Suggestions</div>
                      {repairSuggestions.map(item => (
                        <div key={item.key} className="text-[11px] text-[var(--text-secondary)]">
                          <span className="font-bold text-[var(--text-primary)]">{item.label}:</span> {item.detail}
                        </div>
                      ))}
                    </div>
                  )}

                  {coverageMatrix.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Coverage Matrix</div>
                        <StatusBadge tone={missingCoverageCount === 0 ? 'success' : 'warning'}>
                          {missingCoverageCount} Missing
                        </StatusBadge>
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {coverageMatrix.slice(0, 8).map(item => (
                          <div key={item.reference} className="flex items-start justify-between gap-3 rounded-[0.9rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-[var(--text-primary)] truncate">{item.reference}</div>
                              <div className="text-[10px] text-[var(--text-muted)] truncate">
                                {item.testTitles.length ? item.testTitles.join(', ') : 'No matching generated tests'}
                              </div>
                            </div>
                            <StatusBadge tone={item.status === 'covered' ? 'success' : item.status === 'partial' ? 'warning' : 'danger'}>
                              {item.status}
                            </StatusBadge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </SurfaceCard>

                <div className="space-y-3">
                  {session.testCases.map((testCase: TestCase, idx: number) => (
                    <SurfaceCard key={`${testCase.title}-${idx}`} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleUpdateTestCase(idx, { selected: testCase.selected === false })}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)]"
                            aria-label={testCase.selected === false ? 'Select test case' : 'Unselect test case'}
                          >
                            {testCase.selected === false ? <Square size={14} /> : <CheckSquare size={14} />}
                          </button>
                          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Test Case {idx + 1}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => moveTestCase(idx, -1)} disabled={idx === 0} className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)] disabled:opacity-30" aria-label="Move test case up">
                            <ArrowUp size={12} />
                          </button>
                          <button type="button" onClick={() => moveTestCase(idx, 1)} disabled={idx === session.testCases.length - 1} className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)] disabled:opacity-30" aria-label="Move test case down">
                            <ArrowDown size={12} />
                          </button>
                          <button type="button" onClick={() => duplicateTestCase(idx)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)]" aria-label="Duplicate test case">
                            <Copy size={12} />
                          </button>
                          <button type="button" onClick={() => removeTestCase(idx)} className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--error)]" aria-label="Delete test case">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <input
                          value={testCase.priority}
                          onChange={e => handleUpdateTestCase(idx, { priority: e.target.value })}
                          className="w-20 bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-full px-3 py-1.5 text-[10px] font-bold text-[var(--primary-blue)] text-center transition-all focus:border-[var(--primary-blue)]/50 focus:ring-2 focus:ring-[var(--primary-blue)]/10 outline-none"
                        />
                        <input
                          value={testCase.test_type || 'Manual'}
                          onChange={e => handleUpdateTestCase(idx, { test_type: e.target.value })}
                          className="w-28 bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-full px-3 py-1.5 text-[10px] font-bold text-[var(--text-secondary)] text-center transition-all focus:border-[var(--primary-blue)]/50 focus:ring-2 focus:ring-[var(--primary-blue)]/10 outline-none"
                          placeholder="Test type"
                        />
                      </div>
                      <AutoResizeTextarea
                        value={testCase.title}
                        onChange={e => handleUpdateTestCase(idx, { title: e.target.value })}
                        className="w-full bg-transparent border-none p-0 text-sm font-bold text-[var(--text-primary)] outline-none"
                      />
                      {testCase.objective && (
                        <div className="text-[11px] text-[var(--text-secondary)] italic">
                          {testCase.objective}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-widest block">Steps</label>
                        <AutoResizeTextarea
                          value={testCase.steps.join('\n')}
                          onChange={e => handleUpdateTestCase(idx, {
                            steps: e.target.value
                              .split('\n')
                              .map(step => step.trim())
                              .filter(Boolean)
                          })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-widest block">Preconditions</label>
                        <AutoResizeTextarea
                          value={testCase.preconditions || ''}
                          onChange={e => handleUpdateTestCase(idx, { preconditions: e.target.value })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-widest block">Expected Result</label>
                        <AutoResizeTextarea
                          value={testCase.expected_result}
                          onChange={e => handleUpdateTestCase(idx, { expected_result: e.target.value })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          value={testCase.existing_issue_key || ''}
                          onChange={e => handleUpdateTestCase(idx, { existing_issue_key: e.target.value.trim().toUpperCase() || undefined })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] px-2.5 py-2 text-xs text-[var(--text-secondary)] outline-none"
                          placeholder="Existing Xray key"
                        />
                        <input
                          value={(testCase.acceptance_criteria_refs || []).join(', ')}
                          onChange={e => handleUpdateTestCase(idx, { acceptance_criteria_refs: splitListInput(e.target.value) })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] px-2.5 py-2 text-xs text-[var(--text-secondary)] outline-none"
                          placeholder="AC refs"
                        />
                        <input
                          value={(testCase.labels || []).join(', ')}
                          onChange={e => handleUpdateTestCase(idx, { labels: splitListInput(e.target.value) })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] px-2.5 py-2 text-xs text-[var(--text-secondary)] outline-none"
                          placeholder="Labels"
                        />
                        <input
                          value={(testCase.components || []).join(', ')}
                          onChange={e => handleUpdateTestCase(idx, { components: splitListInput(e.target.value) })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] px-2.5 py-2 text-xs text-[var(--text-secondary)] outline-none"
                          placeholder="Components"
                        />
                      </div>
                      {testCase.test_data && (
                        <div className="space-y-1.5">
                          <label className="context-label uppercase tracking-widest block">Test Data</label>
                          <AutoResizeTextarea
                            value={testCase.test_data || ''}
                            onChange={e => handleUpdateTestCase(idx, { test_data: e.target.value })}
                            className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] font-mono outline-none"
                          />
                        </div>
                      )}
                      {testCase.review_notes && (
                        <div className="rounded-[0.9rem] border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--warning)] mb-1">Review Note</div>
                          <div className="text-[11px] text-[var(--text-secondary)]">{testCase.review_notes}</div>
                        </div>
                      )}
                    </SurfaceCard>
                  ))}
                </div>

                <div className="flow-screen space-y-4 mt-8">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-[0.9rem] bg-[var(--bg-input)] flex items-center justify-center text-[var(--primary-blue)] border border-[var(--border-soft)]">
                      <Send size={16} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold">Publish to Xray</h4>
                      <p className="text-[11px] text-[var(--text-muted)]">Link to {session.issueData?.key} and repository folder.</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {session.jiraCapabilityProfile && (
                      <SurfaceCard className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Jira Readiness</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">
                              {session.jiraCapabilityProfile.selectedProject?.key || 'Project'} · {session.jiraCapabilityProfile.xray.mode}
                            </div>
                          </div>
                          <StatusBadge tone={readinessScore === 100 ? 'success' : readinessScore && readinessScore >= 70 ? 'warning' : 'danger'}>
                            {readinessScore}% Ready
                          </StatusBadge>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {readinessChecks.map(check => (
                            <div key={check.key} className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]" title={check.detail}>
                              <span className={`h-1.5 w-1.5 rounded-full ${check.ok ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
                              <span>{check.label}</span>
                            </div>
                          ))}
                        </div>
                      </SurfaceCard>
                    )}

                    {session.jiraCapabilityProfile && (
                      <SurfaceCard className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Capability Automation</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Detected Jira/Xray capabilities now drive extraction, payloads, linking, and fallbacks.</div>
                          </div>
                          <StatusBadge tone={capabilityFeatures.every(feature => feature.enabled) ? 'success' : 'warning'}>
                            {capabilityFeatures.filter(feature => feature.enabled).length}/{capabilityFeatures.length} Active
                          </StatusBadge>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                          {capabilityFeatures.map(feature => (
                            <div key={feature.key} className="flex items-start justify-between gap-3 rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2">
                              <div>
                                <div className="text-[11px] font-bold text-[var(--text-primary)]">{feature.label}</div>
                                <div className="text-[10px] text-[var(--text-muted)]">{feature.detail}</div>
                              </div>
                              <StatusBadge tone={feature.enabled ? 'success' : 'warning'}>
                                {feature.enabled ? 'On' : 'Needs Setup'}
                              </StatusBadge>
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center gap-2 rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={session.jiraCapabilityProfile.syncStrategy.inheritLabels}
                              onChange={event => saveSyncStrategy({ inheritLabels: event.target.checked })}
                            />
                            Inherit labels
                          </label>
                          <label className="flex items-center gap-2 rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={session.jiraCapabilityProfile.syncStrategy.inheritComponents}
                              onChange={event => saveSyncStrategy({ inheritComponents: event.target.checked })}
                            />
                            Inherit components
                          </label>
                          <label className="flex items-center gap-2 rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={session.jiraCapabilityProfile.syncStrategy.inheritVersions}
                              onChange={event => saveSyncStrategy({ inheritVersions: event.target.checked })}
                            />
                            Inherit versions
                          </label>
                          <label className="flex items-center gap-2 rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              disabled={!session.jiraCapabilityProfile.permissions.canTransitionIssues}
                              checked={session.jiraCapabilityProfile.syncStrategy.transitionAfterCreate}
                              onChange={event => saveSyncStrategy({ transitionAfterCreate: event.target.checked })}
                            />
                            Transition after create
                          </label>
                          <label className="flex items-center gap-2 rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              disabled={!session.jiraCapabilityProfile.permissions.canAddComments}
                              checked={Boolean(session.jiraCapabilityProfile.workflow?.addCommentAfterSync)}
                              onChange={event => saveWorkflowSettings({ addCommentAfterSync: event.target.checked })}
                            />
                            Comment on story
                          </label>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                          <div className="space-y-1.5">
                            <label className="context-label uppercase tracking-wider block ml-1">Native Steps Fallback</label>
                            <select
                              value={session.jiraCapabilityProfile.syncStrategy.fallbackWhenNativeStepsFail}
                              onChange={event => saveSyncStrategy({ fallbackWhenNativeStepsFail: event.target.value as 'manualStepsField' | 'description' })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] px-3 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                            >
                              <option value="manualStepsField" disabled={!session.jiraCapabilityProfile.xray.supportsManualStepsField}>Manual steps field</option>
                              <option value="description">Description fallback</option>
                            </select>
                          </div>
                        </div>

                        {mappedSourceStoryFields.length > 0 && (
                          <div className="grid grid-cols-2 gap-2">
                            {mappedSourceStoryFields.map(field => (
                              <div key={field.key} className="rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{field.label}</div>
                                <div className="text-[11px] text-[var(--text-secondary)] truncate">{field.fieldId || 'Not detected'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </SurfaceCard>
                    )}

                    <div className="space-y-1.5">
                      <label className="context-label uppercase tracking-wider block ml-1">Xray Project</label>
                      <LuxurySearchableSelect
                        options={session.xrayProjects.map(p => ({ id: p.id, name: `${p.key} · ${p.name}` }))}
                        value={session.xrayTargetProjectId ? { id: session.xrayTargetProjectId } : null}
                        placeholder="Select target project..."
                        onChange={(next) => {
                          const selectedProjectId = isSelectOption(next) ? String(next.id ?? '') : Array.isArray(next) ? '' : String(next ?? '');
                          const project = session.xrayProjects.find(item => item.id === selectedProjectId);
                          updateSession({
                            xrayTargetProjectId: project?.id || null,
                            xrayTargetProjectKey: project?.key || null
                          });
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-wider block ml-1">Repository Folder</label>
                        <input
                          value={session.xrayFolderPath}
                          onChange={e => updateSession({ xrayFolderPath: e.target.value })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] px-3 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                          placeholder={session.issueData?.key || 'STORY-123'}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-wider block ml-1">Issue Type</label>
                        <LuxurySearchableSelect
                          options={(session.issueTypes.length ? session.issueTypes : session.jiraCapabilityProfile?.issueTypes.all || [])
                            .filter(issueType => !issueType.subtask)
                            .map(issueType => ({ id: issueType.id, name: issueType.name, avatar: issueType.icon_url || issueType.iconUrl }))}
                          value={
                            session.xrayTestIssueTypeName
                              ? { id: session.xrayTestIssueTypeName, name: session.xrayTestIssueTypeName }
                              : session.jiraCapabilityProfile?.issueTypes.test
                                ? { id: session.jiraCapabilityProfile.issueTypes.test.id, name: session.jiraCapabilityProfile.issueTypes.test.name }
                                : null
                          }
                          placeholder="Select Test issue type..."
                          onChange={(next) => {
                            if (!isSelectOption(next)) return;
                            const issueType = session.issueTypes.find(item => item.id === String(next.id ?? ''));
                            updateSession({ xrayTestIssueTypeName: issueType?.name || String(next.name || next.id || 'Test') });
                            if (session.jiraCapabilityProfile && issueType) {
                              void jiraCapabilityService.saveTestIssueType(session.jiraCapabilityProfile, issueType).then((profile) => {
                                updateSession({ jiraCapabilityProfile: profile });
                              });
                            }
                          }}
                        />
                      </div>
                    </div>

                    {session.jiraCapabilityProfile && (() => {
                      if (targetTestFieldEntries.length === 0) return null;

                      return (
                        <div className="space-y-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Detected Test Fields</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Required fields are enforced before publish. Optional fields are sent when populated.</div>
                          </div>
                          {targetTestFieldEntries.map(({ key, schema, required }) => {
                            const currentValue = session.xrayFieldDefaults[key];
                            const isMulti = schema.type === 'array';
                            const hasOptions = (schema.allowedValues || []).length > 0;

                            return (
                              <div key={key} className="space-y-1.5">
                                <label className="context-label uppercase tracking-wider block ml-1">
                                  {schema.name} {required && <span className="text-[var(--error)]">*</span>}
                                </label>
                                {hasOptions ? (
                                  <LuxurySearchableSelect
                                    isMulti={isMulti}
                                    options={(schema.allowedValues || []).map(toAllowedValueOption)}
                                    value={currentValue as SelectValue | SelectValue[]}
                                    placeholder={`Select ${schema.name}...`}
                                    required
                                    onChange={(next) => {
                                      const nextValue = isMulti
                                        ? (Array.isArray(next) ? next : []).map(toStoredSelectValue)
                                        : toStoredSelectValue(Array.isArray(next) ? next[0] : next);
                                      saveXrayDefault(key, nextValue);
                                    }}
                                  />
                                ) : (
                                  <AutoResizeTextarea
                                    value={typeof currentValue === 'string' ? currentValue : ''}
                                    onChange={e => saveXrayDefault(key, e.target.value)}
                                    className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                                    placeholder={`Enter ${schema.name}...`}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {xrayPayloadPreview && (
                      <div className="space-y-2 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--bg-input)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Payload Preview</div>
                          <StatusBadge tone="info">{xrayPayloadPreview.xrayMode}</StatusBadge>
                        </div>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-[var(--text-secondary)]">
                          {JSON.stringify(xrayPayloadPreview, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>

                  {session.createdIssues.length > 0 && (
                    <div className="rounded-xl bg-[var(--success-bg)] p-3 border border-[var(--success)]/20 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--success)]">Published Tests</div>
                      <div className="flex flex-wrap gap-2">
                        {session.createdIssues.map(issue => (
                          <span key={issue.key} className="px-2 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-soft)] text-[11px] font-bold text-[var(--text-primary)]">
                            {issue.key}{issue.updated ? ' updated' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {session.xraySyncHistory.length > 0 && (
                    <SurfaceCard className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Sync History</div>
                          <div className="text-[11px] text-[var(--text-secondary)]">Recent Xray publish attempts for this Jira connection.</div>
                        </div>
                        <StatusBadge tone="info">{session.xraySyncHistory.length}</StatusBadge>
                      </div>
                      <div className="space-y-2">
                        {session.xraySyncHistory.slice(0, 5).map(item => (
                          <div key={item.id} className="rounded-[0.85rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] font-bold text-[var(--text-primary)]">{item.story_issue_key}</div>
                              <StatusBadge tone={item.status === 'success' ? 'success' : 'danger'}>{item.status}</StatusBadge>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)]">
                              Created: {item.created_test_keys.join(', ') || 'none'} · Updated: {item.updated_test_keys.join(', ') || 'none'}
                            </div>
                            {item.warnings.length > 0 && (
                              <div className="text-[10px] text-[var(--warning)]">{item.warnings.slice(0, 2).join(' ')}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </SurfaceCard>
                  )}

                  {session.xrayWarnings.length > 0 && (
                    <StatusPanel 
                      tone="warning" 
                      title="Publish Warnings"
                      icon={AlertTriangle}
                    >
                      <div className="text-[11px]">
                        {session.xrayWarnings.map((warning, idx) => (
                          <div key={`${warning}-${idx}`}>{warning}</div>
                        ))}
                      </div>
                    </StatusPanel>
                  )}

                  {!session.xrayPublishSupported && session.xrayUnsupportedReason && (
                    <StatusPanel 
                      tone="danger" 
                      title="Export Unavailable"
                      description={session.xrayUnsupportedReason}
                      icon={AlertCircle}
                    />
                  )}

                  {missingXrayRequiredDefaults.length > 0 && (
                    <StatusPanel
                      tone="warning"
                      title="Required Fields Needed"
                      description={missingXrayRequiredDefaults
                        .map(fieldKey => session.jiraCapabilityProfile?.targetTestCreateFields.fieldSchemas[fieldKey]?.name || fieldKey)
                        .join(', ')}
                      icon={AlertTriangle}
                    />
                  )}

                  <ActionButton
                    onClick={publishTestCasesToXray}
                    disabled={!session.xrayTargetProjectId || selectedTestCaseCount === 0 || session.loading || !session.xrayPublishSupported || !canCreateFromProfile || missingXrayRequiredDefaults.length > 0 || !payloadDryRun.valid}
                    variant="primary"
                  >
                    <Send size={16} />
                    Publish {selectedTestCaseCount} Selected to Xray
                  </ActionButton>
                  <ActionButton
                    onClick={() => downloadJson(session.testCases.filter(testCase => testCase.selected !== false), `bugmind-selected-tests-${session.issueData?.key || 'export'}.json`)}
                    variant="secondary"
                    className="h-10 text-[12px]"
                  >
                    <Download size={15} />
                    Export Selected Tests
                  </ActionButton>
                </div>
              </div>            ) : (
              <div className="space-y-4">
                {session.gapAnalysisSummary && (
                  <SurfaceCard className="space-y-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-[0.9rem] bg-[var(--surface-accent-strong)] flex items-center justify-center text-[var(--primary-blue)] border border-[var(--border-soft)]">
                            <ClipboardList size={16} />
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Gap Analysis Summary</div>
                            <h3 className="workflow-card-title text-[16px]">{session.gapAnalysisSummary.summary_headline || 'Structured risk summary'}</h3>
                          </div>
                        </div>
                        {session.gapAnalysisSummary.issue_type_mode && (
                          <StatusBadge tone="info">{session.gapAnalysisSummary.issue_type_mode}</StatusBadge>
                        )}
                      </div>
                      {session.coverageScore !== null && (
                        <div className="rounded-[1rem] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2 text-right">
                          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">AC Coverage</div>
                          <div className="text-lg font-black text-[var(--text-primary)]">{Math.round(session.coverageScore)}%</div>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {session.gapAnalysisSummary.highest_risk_area && (
                        <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-3">
                          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Highest Risk Area</div>
                          <div className="mt-1 text-[12px] font-bold text-[var(--text-primary)]">{session.gapAnalysisSummary.highest_risk_area}</div>
                        </div>
                      )}
                      {session.gapAnalysisSummary.recommended_next_action && (
                        <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-3">
                          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Recommended Next Action</div>
                          <div className="mt-1 text-[12px] font-bold text-[var(--text-primary)]">{session.gapAnalysisSummary.recommended_next_action}</div>
                        </div>
                      )}
                    </div>
                    {session.gapAnalysisSummary.grouped_risks.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Grouped Risks</div>
                        <div className="grid grid-cols-1 gap-3">
                          {session.gapAnalysisSummary.grouped_risks.map((risk) => (
                            <div key={`${risk.group}-${risk.title}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[12px] font-bold text-[var(--text-primary)]">{risk.title}</div>
                                <StatusBadge tone="warning">{risk.count} finding{risk.count === 1 ? '' : 's'}</StatusBadge>
                              </div>
                              <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{risk.description}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {session.gapAnalysisSummary.missing_ac_recommendations.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Missing AC Recommendations</div>
                        <div className="space-y-2">
                          {session.gapAnalysisSummary.missing_ac_recommendations.map((item, idx) => (
                            <div key={`${item}-${idx}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {session.gapAnalysisSummary.ac_coverage_map.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">AC Coverage Map</div>
                        <div className="space-y-2">
                          {session.gapAnalysisSummary.ac_coverage_map.map((item: AnalysisCoverageItem, idx: number) => (
                            <div key={`${item.reference}-${idx}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-[12px] font-bold text-[var(--text-primary)]">{item.reference}</div>
                                <StatusBadge tone={coverageTone(item.status)}>{item.status}</StatusBadge>
                              </div>
                              <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{item.rationale}</div>
                              {item.related_bug_indexes.length > 0 && (
                                <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                  Related findings: {item.related_bug_indexes.join(', ')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </SurfaceCard>
                )}
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">{(session.bugs || []).length} Analysis Findings</h3>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => updateWorkWithHistory('Cleared findings', { bugs: [], testCases: [], coverageScore: null, gapAnalysisSummary: null, error: null, mainWorkflow: 'home' })} 
                      className="text-xs font-bold text-[var(--error)]"
                    >
                      Clear
                    </button>
                    <button 
                      onClick={generateBugs} 
                      disabled={requiresIssueType || session.loading || !canGenerateFromProfile}
                      className="text-xs font-bold text-[var(--primary-blue)]"
                    >
                      Retry
                    </button>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {(session.bugs || []).map((bug: BugReport, idx: number) => (
                    <SurfaceCard key={idx}>
                      <div 
                        onClick={() => updateSession({ expandedBug: session.expandedBug === idx ? null : idx })}
                        className="flex items-start gap-3 cursor-pointer"
                      >
                        <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          bug.severity === 'Critical' ? 'bg-[var(--error)] shadow-[0_0_8px_var(--error)]' : 
                          bug.severity === 'High' ? 'bg-[var(--warning)]' : 'bg-[var(--primary-blue)]'
                        }`} />
                        <div className="flex-1 min-w-0">
                        <div className="workflow-card-title text-sm">{bug.summary}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <div className="workflow-card-subtitle text-[11px] font-bold uppercase tracking-wider">{bug.severity} Risk</div>
                            {bug.category && (
                              <StatusBadge tone="info" className="text-[9px]">
                                {bug.category}
                              </StatusBadge>
                            )}
                            {typeof bug.confidence === 'number' && (
                              <StatusBadge tone={bug.confidence >= 80 ? 'success' : bug.confidence >= 60 ? 'info' : 'warning'} className="text-[9px]">
                                {bug.confidence}% confidence
                              </StatusBadge>
                            )}
                            {bug.duplicate_group && (
                              <StatusBadge tone="warning" className="text-[9px]">
                                Overlap {bug.duplicate_group}
                              </StatusBadge>
                            )}
                            {bug.review_required && (
                              <StatusBadge tone="danger" className="text-[9px]">
                                Needs Review
                              </StatusBadge>
                            )}
                          </div>
                        </div>
                        <ChevronDown 
                          size={16} 
                          className={`text-[var(--text-muted)] transition-transform duration-300 ${session.expandedBug === idx ? 'rotate-180' : ''}`} 
                        />
                      </div>
                      
                      {session.expandedBug === idx && (
                        <div className="mt-4 pt-4 border-t border-[var(--border-soft)] space-y-4 animate-in slide-in-from-top-2">
                          <div className="space-y-1.5">
                            <label className="context-label uppercase tracking-widest block">Core Summary</label>
                            <AutoResizeTextarea 
                              value={bug.summary}
                              onChange={e => handleUpdateBug(idx, { summary: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-primary)] font-bold outline-none"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="context-label uppercase tracking-widest block">Summary</label>
                            <AutoResizeTextarea 
                              value={bug.description}
                              onChange={e => handleUpdateBug(idx, { description: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="context-label uppercase tracking-widest block">Steps to Reproduce</label>
                            <AutoResizeTextarea 
                              value={bug.steps_to_reproduce}
                              onChange={e => handleUpdateBug(idx, { steps_to_reproduce: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] font-mono outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Severity</label>
                              <LuxurySearchableSelect
                                options={['Critical', 'High', 'Medium', 'Low'].map((value) => ({ id: value, name: value }))}
                                value={bug.severity ? { id: bug.severity, name: bug.severity } : null}
                                onChange={(next) => {
                                  const nextValue = isSelectOption(next) ? String(next.id) : '';
                                  handleUpdateBug(idx, { severity: nextValue || 'Medium' });
                                }}
                                placeholder="Select severity..."
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Category</label>
                              <LuxurySearchableSelect
                                options={['Functional Gap', 'Validation', 'Workflow', 'Edge Case', 'Permissions', 'Data Integrity', 'Regression Risk', 'UX'].map((value) => ({ id: value, name: value }))}
                                value={bug.category ? { id: bug.category, name: bug.category } : null}
                                onChange={(next) => {
                                  const nextValue = isSelectOption(next) ? String(next.id) : '';
                                  handleUpdateBug(idx, { category: nextValue || 'Functional Gap' });
                                }}
                                placeholder="Select category..."
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Expected</label>
                              <AutoResizeTextarea 
                                value={bug.expected_result}
                                onChange={e => handleUpdateBug(idx, { expected_result: e.target.value })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Actual</label>
                              <AutoResizeTextarea 
                                value={bug.actual_result}
                                onChange={e => handleUpdateBug(idx, { actual_result: e.target.value })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Priority</label>
                              <LuxurySearchableSelect
                                options={['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((value) => ({ id: value, name: value }))}
                                value={bug.priority ? { id: bug.priority, name: bug.priority } : null}
                                onChange={(next) => {
                                  const nextValue = isSelectOption(next) ? String(next.id) : '';
                                  handleUpdateBug(idx, { priority: nextValue || 'Medium' });
                                }}
                                placeholder="Select priority..."
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Environment</label>
                              <AutoResizeTextarea
                                value={bug.environment || ''}
                                onChange={e => handleUpdateBug(idx, { environment: e.target.value })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                                placeholder="e.g. Chrome / macOS / Production"
                              />
                            </div>
                          </div>
                          {bug.root_cause && (
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Possible Root Cause</label>
                              <AutoResizeTextarea
                                value={bug.root_cause || ''}
                                onChange={e => handleUpdateBug(idx, { root_cause: e.target.value })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">AC References</label>
                              <AutoResizeTextarea
                                value={(bug.acceptance_criteria_refs || []).join('\n')}
                                onChange={e => handleUpdateBug(idx, {
                                  acceptance_criteria_refs: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean)
                                })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Evidence</label>
                              <AutoResizeTextarea
                                value={(bug.evidence || []).join('\n')}
                                onChange={e => handleUpdateBug(idx, {
                                  evidence: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean)
                                })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                          </div>
                          {(bug.suggested_evidence || []).length > 0 && (
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Suggested Evidence to Collect</label>
                              <div className="flex flex-wrap gap-1.5">
                                {(bug.suggested_evidence || []).map((item, evidenceIdx) => (
                                  <StatusBadge key={`evidence-${evidenceIdx}`} tone="info" className="text-[9px]">
                                    {item}
                                  </StatusBadge>
                                ))}
                              </div>
                            </div>
                          )}
                          {(bug.labels || []).length > 0 && (
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Labels</label>
                              <div className="flex flex-wrap gap-1.5">
                                {(bug.labels || []).map((label, labelIdx) => (
                                  <StatusBadge key={`label-${labelIdx}`} tone="info" className="text-[9px]">
                                    {label}
                                  </StatusBadge>
                                ))}
                              </div>
                            </div>
                          )}
                          {bug.overlap_warning && (
                            <StatusPanel
                              tone="warning"
                              title="Potential Overlap"
                              description={bug.overlap_warning}
                              icon={AlertTriangle}
                            />
                          )}

                          {/* Dynamic Jira Fields */}
                          {(() => {
                            const metadataFields = (session.jiraMetadata?.fields || []).filter((field: JiraField) => !isSystemManagedField(field));
                            const visibleKeys = session.visibleFields || [];
                            const requiredKeys = metadataFields.filter(f => f.required).map(f => f.key);
                            const allVisibleKeys = Array.from(new Set([...visibleKeys, ...requiredKeys]));
                            
                            if (allVisibleKeys.length === 0) return null;

                            return (
                              <div className="pt-2 space-y-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 bg-[var(--primary-blue)] rounded-full" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Issue Metadata</span>
                                </div>
                                <div className="space-y-3">
                                  {allVisibleKeys.map((fieldKey: string) => {
                                    const field = metadataFields.find((f: JiraField) => f.key === fieldKey);
                                    if (!field) return null;

                                    const isMulti = field.type === 'array' || field.type === 'multi-select' || field.type === 'multi-user';
                                    const currentVal = mergeDisplayValue(
                                      bug.extra_fields?.[fieldKey],
                                      session.fieldDefaults?.[fieldKey]
                                    );

                                    return (
                                      <div key={fieldKey} className="space-y-1">
                                        <label className="context-label lowercase font-bold ml-1">
                                          {field.name} {field.required && <span className="text-[var(--error)]">*</span>}
                                        </label>
                                        <LuxurySearchableSelect 
                                          isMulti={isMulti}
                                          options={(field.allowed_values || []).map(toAllowedValueOption)}
                                          value={currentVal as SelectValue | SelectValue[]}
                                          placeholder={field.type.includes('user') ? "Search users..." : (isMulti ? `Add ${field.name}...` : `Select ${field.name}...`)}
                                          required={field.required}
                                          allowCustomValues={field.type === 'labels' || field.type === 'array'}
                                          onSearchAsync={field.type.includes('user') ? async (q) => {
                                            const results = await searchUsers(q, undefined, field.key);
                                            return (results || []).map(toUserOption);
                                          } : undefined}
                                          onChange={(next) => {
                                            let finalVal: ExtraFieldValue = (next ?? null) as ExtraFieldValue;
                                            if (field.type === 'option' || field.type === 'multi-select' || field.type === 'priority' || field.type === 'user' || field.type === 'multi-user') {
                                              if (isMulti) {
                                                finalVal = (Array.isArray(next) ? next : []).map(toStoredSelectValue);
                                              } else {
                                                finalVal = toStoredSelectValue(Array.isArray(next) ? next[0] : next);
                                              }
                                            }
                                            handleUpdateBug(idx, {
                                              extra_fields: { [fieldKey]: finalVal }
                                            });
                                          }}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                          <div className="flex items-center justify-between pt-2">
                            <div className="flex items-center gap-1.5 text-[var(--success)]">
                              <Check size={12} />
                              <span className="text-[10px] font-bold uppercase tracking-tighter">Synced to context</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => void regenerateBug(idx)}
                                className="flex items-center gap-1 text-[10px] font-bold text-[var(--primary-blue)] hover:opacity-80"
                              >
                                <BrainCircuit size={12} />
                                Refine Finding
                              </button>
                              <button onClick={() => updateSession({ expandedBug: null })} className="text-[10px] font-bold text-[var(--primary-blue)] hover:opacity-80">
                                Close Editor
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </SurfaceCard>
                  ))}
                </div>

                <div className="pt-4">
                  <ActionButton 
                    onClick={() => {
                      if ((session.bugs || []).length > 0) {
                        preparePreviewBug(0);
                      }
                    }}
                    variant="primary"
                    className="h-11"
                  >
                    <Layout size={18} />
                    Review & Publish Findings
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MainView;
