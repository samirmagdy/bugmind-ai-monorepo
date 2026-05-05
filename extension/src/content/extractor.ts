/**
 * extraction.ts
 * Logic to extract Jira issue data from the DOM.
 */
export {};

interface ExtractedIssue {
  key: string;
  projectId: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  typeName: string;
  theme: 'light' | 'dark';
}

declare global {
  interface Window {
    __BugMindInjected?: string | null;
    __BugMindCleanup?: () => void;
    __BugMindHistoryPatched?: boolean;
  }
}

const VERSION = '1.2.0';
const CONTEXT_NOTIFY_DEBOUNCE_MS = 350;

type BugMindMessage =
  | { type: 'PING' }
  | { type: 'GET_ISSUE_DATA' }
  | { type: 'THEME_CHANGED'; theme: 'light' | 'dark' };

type BugMindResponse =
  | { type: 'PONG'; version: string }
  | { type: 'ISSUE_DATA_SUCCESS'; data: ExtractedIssue | null }
  | { type: 'ISSUE_DATA_ERROR'; error: string };

function buildContextSignature(data: ExtractedIssue | null, url: string = window.location.href): string {
  return JSON.stringify({
    url,
    key: data?.key || null,
    projectId: data?.projectId || null,
    summary: data?.summary || null,
    typeName: data?.typeName || null
  });
}

function detectTheme(): 'light' | 'dark' {
  const mode = document.documentElement.getAttribute('data-color-mode');
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';

  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function extractJiraData(): ExtractedIssue | null {
  const projectId = document.querySelector('meta[name="ajs-project-id"]')?.getAttribute('content') ||
    document.querySelector('#gh-meta-project-id')?.getAttribute('content') ||
    document.querySelector('body')?.getAttribute('data-project-id') ||
    '';

  const issueKey = document.querySelector('a[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]')?.textContent ||
    document.querySelector('#key-val')?.textContent ||
    document.querySelector('a[href*="/browse/"]')?.textContent?.match(/[A-Z]+-\d+/)?.[0] ||
    document.title.match(/[A-Z]+-\d+/)?.[0] ||
    '';

  const summary = document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]')?.textContent ||
    document.querySelector('#summary-val')?.textContent ||
    document.querySelector('h1')?.textContent ||
    '';

  const typeContainer = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.breadcrumb-item-0"]');
  const typeName = typeContainer?.querySelector('img')?.getAttribute('alt') ||
    document.querySelector('img[data-testid*="avatar-image"]')?.getAttribute('alt') ||
    document.querySelector('img[alt="Story"], img[alt="Bug"], img[alt="Task"]')?.getAttribute('alt') ||
    document.querySelector('div[data-testid="issue.views.field.select.issuetype"]')?.textContent ||
    document.querySelector('#type-val')?.textContent?.trim() ||
    'Issue';

  if (!issueKey || !summary) return null;

  const descriptionElement = document.querySelector('div[data-testid="issue.views.field.rich-text.description"]');
  const description = descriptionElement?.textContent || '';

  let ac = '';
  const acKeywords = ['acceptance criteria', 'ac:', 'acceptance criteria:', 'criteria:'];

  const acHeader = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, strong'))
    .find((element) => acKeywords.some((keyword) => element.textContent?.toLowerCase().includes(keyword)));

  if (acHeader) {
    let current = acHeader.nextElementSibling;
    while (current && !['H1', 'H2', 'H3', 'H4'].includes(current.tagName)) {
      ac += `${current.textContent || ''}\n`;
      current = current.nextElementSibling;
    }
  }

  if (!ac.trim()) {
    const lines = document.body.innerText.split('\n');
    const acIndex = lines.findIndex((line) => acKeywords.some((keyword) => line.toLowerCase().includes(keyword)));
    if (acIndex !== -1) {
      ac = lines.slice(acIndex + 1, acIndex + 6).join('\n');
    }
  }

  return {
    key: issueKey.trim(),
    projectId: projectId.trim(),
    summary: summary.trim(),
    description: description.trim(),
    acceptanceCriteria: ac.trim(),
    typeName: typeName.trim(),
    theme: detectTheme()
  };
}

const messageListener = (
  request: BugMindMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: BugMindResponse) => void
) => {
  if (request.type === 'PING') {
    sendResponse({ type: 'PONG', version: VERSION });
    return true;
  }

  if (request.type === 'GET_ISSUE_DATA') {
    try {
      const data = extractJiraData();
      sendResponse({ type: 'ISSUE_DATA_SUCCESS', data });
    } catch (err) {
      console.error('BugMind Extraction Error:', err);
      sendResponse({ type: 'ISSUE_DATA_ERROR', error: String(err) });
    }
  }
  return true;
};

function initialize() {
  if (window.__BugMindInjected === VERSION) {
    return;
  }

  if (window.__BugMindCleanup) {
    window.__BugMindCleanup();
  }

  window.__BugMindInjected = VERSION;
  chrome.runtime.onMessage.addListener(messageListener);

  let lastObservedUrl = window.location.href;
  let lastContextSignature = buildContextSignature(extractJiraData(), lastObservedUrl);
  let contextScanTimer: number | null = null;

  const notifyContextChange = () => {
    if (contextScanTimer !== null) {
      window.clearTimeout(contextScanTimer);
    }

    contextScanTimer = window.setTimeout(() => {
      contextScanTimer = null;
      const currentUrl = window.location.href;
      const data = extractJiraData();
      const nextSignature = buildContextSignature(data, currentUrl);

      if (currentUrl === lastObservedUrl && nextSignature === lastContextSignature) {
        return;
      }

      lastObservedUrl = currentUrl;
      lastContextSignature = nextSignature;

      chrome.runtime.sendMessage({
        type: 'JIRA_CONTEXT_CHANGED',
        url: currentUrl
      }).catch(() => {});
    }, CONTEXT_NOTIFY_DEBOUNCE_MS);
  };

  if (!window.__BugMindHistoryPatched) {
    window.__BugMindHistoryPatched = true;

    const wrapHistoryMethod = (methodName: 'pushState' | 'replaceState') => {
      const original = window.history[methodName];
      window.history[methodName] = function (...args) {
        const result = original.apply(this, args);
        notifyContextChange();
        return result;
      };
    };

    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');
    window.addEventListener('popstate', notifyContextChange);
    window.addEventListener('hashchange', notifyContextChange);
  }

  let lastTheme = detectTheme();
  const themeObserver = new MutationObserver(() => {
    const currentTheme = detectTheme();
    if (currentTheme === lastTheme) return;

    lastTheme = currentTheme;
    try {
      chrome.runtime.sendMessage({ type: 'THEME_CHANGED', theme: currentTheme });
    } catch {
      themeObserver.disconnect();
    }
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-theme']
  });

  const contextObserver = new MutationObserver(() => {
    notifyContextChange();
  });

  const contextTarget = document.body || document.documentElement;
  if (contextTarget) {
    contextObserver.observe(contextTarget, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'content', 'data-testid', 'alt']
    });
  }

  window.__BugMindCleanup = () => {
    chrome.runtime.onMessage.removeListener(messageListener);
    themeObserver.disconnect();
    contextObserver.disconnect();
    if (contextScanTimer !== null) {
      window.clearTimeout(contextScanTimer);
    }
    window.__BugMindInjected = null;
  };

  notifyContextChange();
}

initialize();
