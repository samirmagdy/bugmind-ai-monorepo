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
  }
}

{
  type BugMindMessage = 
    | { type: "PING" }
    | { type: "GET_ISSUE_DATA" }
    | { type: "THEME_CHANGED"; theme: 'light' | 'dark' };

  type BugMindResponse = 
    | { type: "PONG"; version: string }
    | { type: 'ISSUE_DATA_SUCCESS'; data: ExtractedIssue | null }
    | { type: 'ISSUE_DATA_ERROR'; error: string };

  function detectTheme(): 'light' | 'dark' {
    const mode = document.documentElement.getAttribute('data-color-mode');
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    
    // Fallback to media query if data-color-mode is auto or missing
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function extractJiraData(): ExtractedIssue | null {
    // 1. Extract Project ID (Numeric) - Most stable key for isolation
    const projectId = document.querySelector('meta[name="ajs-project-id"]')?.getAttribute('content') || 
                      document.querySelector('#gh-meta-project-id')?.getAttribute('content') ||
                      document.querySelector('body')?.getAttribute('data-project-id') ||
                      "";

    // 2. Extract Issue Key (e.g. PROJ-123)
    const issueKey = document.querySelector('a[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]')?.textContent || 
                     document.querySelector('#key-val')?.textContent || 
                     document.querySelector('a[href*="/browse/"]')?.textContent?.match(/[A-Z]+-\d+/)?.[0] ||
                     document.title.match(/[A-Z]+-\d+/)?.[0] ||
                     "";
    
    const summary = document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]')?.textContent || 
                    document.querySelector('#summary-val')?.textContent || 
                    document.querySelector('h1')?.textContent ||
                    "";

    // 3. Extract Issue Type (e.g. Story, Bug, Task)
    const typeContainer = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.breadcrumb-item-0"]');
    const typeName = typeContainer?.querySelector('img')?.getAttribute('alt') || 
                     document.querySelector('img[data-testid*="avatar-image"]')?.getAttribute('alt') ||
                     document.querySelector('img[alt="Story"], img[alt="Bug"], img[alt="Task"]')?.getAttribute('alt') ||
                     document.querySelector('div[data-testid="issue.views.field.select.issuetype"]')?.textContent ||
                     document.querySelector('#type-val')?.textContent?.trim() ||
                     "Issue";

    if (!issueKey || !summary) return null;

    const descriptionElement = document.querySelector('div[data-testid="issue.views.field.rich-text.description"]');
    const description = descriptionElement?.textContent || "";

    let ac = "";
    const acKeywords = ["acceptance criteria", "ac:", "acceptance criteria:", "criteria:"];
    
    const acHeader = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, strong'))
      .find(el => acKeywords.some(kw => el.textContent?.toLowerCase().includes(kw)));
    
    if (acHeader) {
      let current = acHeader.nextElementSibling;
      while (current && !['H1', 'H2', 'H3', 'H4'].includes(current.tagName)) {
        ac += (current.textContent || "") + "\n";
        current = current.nextElementSibling;
      }
    }

    if (!ac.trim()) {
      const contentBody = document.body.innerText;
      const lines = contentBody.split('\n');
      const acIndex = lines.findIndex(line => acKeywords.some(kw => line.toLowerCase().includes(kw)));
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
    if (request.type === "PING") {
      sendResponse({ type: "PONG", version: "1.2.0" });
      return true;
    }

    if (request.type === "GET_ISSUE_DATA") {
      try {
        const data = extractJiraData();
        sendResponse({ type: 'ISSUE_DATA_SUCCESS', data });
      } catch (err) {
        console.error("BugMind Extraction Error:", err);
        sendResponse({ type: 'ISSUE_DATA_ERROR', error: String(err) });
      }
    }
    return true;
  };

  function initialize() {
    if (window.__BugMindInjected === "1.2.0") {
      console.log("[BugMind] Version 1.2.0 already active.");
      return;
    }

    if (window.__BugMindCleanup) {
      window.__BugMindCleanup();
    }

    window.__BugMindInjected = "1.2.0";
    chrome.runtime.onMessage.addListener(messageListener); 

    let lastTheme = detectTheme();
    const themeObserver = new MutationObserver(() => {
      const currentTheme = detectTheme();
      if (currentTheme === lastTheme) return;
      
      lastTheme = currentTheme;
      try {
        chrome.runtime.sendMessage({ type: "THEME_CHANGED", theme: currentTheme });
      } catch (e) {
        themeObserver.disconnect();
      }
    });

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode', 'data-theme']
    });

    window.__BugMindCleanup = () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      themeObserver.disconnect();
      window.__BugMindInjected = null;
    };

    console.log("[BugMind] AI Content Engine Ready.");
  }

  initialize();
}

