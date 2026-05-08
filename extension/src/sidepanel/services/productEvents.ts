import { ActivityFeedItem, TabSession } from '../types';
import { apiRequest, readJsonResponse, throwApiErrorResponse } from './api';

const MAX_EVENT_TEXT_LENGTH = 1000;

function sanitizeEventText(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const redacted = value
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]+/gi, '$1=[redacted]');
  return redacted.length > MAX_EVENT_TEXT_LENGTH ? `${redacted.slice(0, MAX_EVENT_TEXT_LENGTH)}...` : redacted;
}

export interface ProductEventPayload {
  event_type: string;
  source?: string;
  workspace_id?: number | null;
  issue_key?: string | null;
  title?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface ProductEventResponse {
  id: number;
  user_id: number;
  workspace_id?: number | null;
  event_type: string;
  source: string;
  issue_key?: string | null;
  title?: string | null;
  detail?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface EventRequestContext {
  apiBase: string;
  authToken: string | null;
  refreshSession?: () => Promise<string | null>;
}

export async function sendProductEvent(
  context: EventRequestContext,
  payload: ProductEventPayload,
  channel: 'activity' | 'analytics'
): Promise<ProductEventResponse | null> {
  if (!context.authToken) return null;
  const res = await apiRequest(`${context.apiBase}/events/${channel}`, {
    method: 'POST',
    token: context.authToken,
    onUnauthorized: context.refreshSession,
    body: JSON.stringify(payload),
  });
  if (!res.ok) await throwApiErrorResponse(res, 'Failed to record product event');
  return readJsonResponse<ProductEventResponse>(res);
}

export async function fetchActivityEvents(context: EventRequestContext, limit = 50): Promise<ActivityFeedItem[]> {
  if (!context.authToken) return [];
  const res = await apiRequest(`${context.apiBase}/events/activity?limit=${limit}`, {
    token: context.authToken,
    onUnauthorized: context.refreshSession,
  });
  if (!res.ok) await throwApiErrorResponse(res, 'Failed to fetch activity history');
  const rows = await readJsonResponse<ProductEventResponse[]>(res);
  return rows.map(eventToActivityItem);
}

export function eventToActivityItem(event: ProductEventResponse): ActivityFeedItem {
  const metadata = event.metadata || {};
  return {
    id: `server-${event.id}`,
    kind: event.event_type.includes('error')
      ? 'error'
      : event.event_type.includes('publish')
        ? 'publish'
        : event.event_type.includes('job')
          ? 'job'
          : event.event_type.includes('settings')
            ? 'settings'
            : 'generation',
    title: event.title || event.event_type.replace(/^activity\./, '').replace(/_/g, ' '),
    detail: event.detail || undefined,
    issueKey: event.issue_key || undefined,
    createdAt: new Date(event.created_at).getTime(),
    actionView: typeof metadata.actionView === 'string' ? metadata.actionView as ActivityFeedItem['actionView'] : undefined,
    actionWorkflow: typeof metadata.actionWorkflow === 'string' ? metadata.actionWorkflow as ActivityFeedItem['actionWorkflow'] : undefined,
  };
}

export function buildActivityEvent(session: TabSession, item: ActivityFeedItem): ProductEventPayload {
  return {
    event_type: `activity.${item.kind}`,
    workspace_id: session.activeWorkspaceId,
    issue_key: item.issueKey || session.issueData?.key || null,
    title: sanitizeEventText(item.title),
    detail: sanitizeEventText(item.detail),
    metadata: {
      actionView: item.actionView,
      actionWorkflow: item.actionWorkflow,
      workflow: session.mainWorkflow,
    },
  };
}

export function buildAnalyticsEvent(
  session: TabSession,
  eventName: string,
  metadata: Record<string, unknown> = {}
): ProductEventPayload {
  return {
    event_type: `analytics.${eventName}`,
    workspace_id: session.activeWorkspaceId,
    issue_key: session.issueData?.key || null,
    title: eventName.replace(/_/g, ' '),
    metadata: {
      view: session.view,
      workflow: session.mainWorkflow,
      hasIssueContext: Boolean(session.issueData?.key),
      ...metadata,
    },
  };
}
