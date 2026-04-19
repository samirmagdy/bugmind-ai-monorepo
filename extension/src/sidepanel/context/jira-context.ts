import { createContext } from 'react';
import { JiraProject } from '../types';

export interface JiraConnectionConfig {
  base_url: string;
  username: string;
  token: string;
  auth_type: 'cloud' | 'server';
  verify_ssl: boolean;
}

export interface JiraContextType {
  jiraPlatform: 'cloud' | 'server';
  setJiraPlatform: (p: 'cloud' | 'server') => void;
  jiraConnected: boolean;
  setJiraConnected: (val: boolean) => void;
  createConnection: (config: JiraConnectionConfig) => Promise<boolean>;
  fetchConnections: () => Promise<void>;
  deleteConnection: (id: number, tabId?: number | null) => Promise<void>;
  setActiveConnection: (id: number, hostUrl: string) => Promise<void>;
  updateConnection: (id: number, updates: Record<string, unknown>) => Promise<boolean>;
  fetchProjects: (id: number) => Promise<JiraProject[]>;
  fetchIssueTypes: (connectionId: number, projectKey: string, tabId?: number | null, projectId?: string, force?: boolean) => Promise<void>;
  fetchJiraMetadata: (connectionId: number, projectKey: string, issueTypeId: string, tabId?: number | null, projectId?: string, force?: boolean) => Promise<void>;
  fetchFieldSettings: (connectionId: number, projectKey: string, tabId?: number | null, issueTypeId?: string, projectId?: string, force?: boolean) => Promise<void>;
  checkJiraStatus: (isInit?: boolean, signal?: AbortSignal, tokenOverride?: string, urlOverride?: string, tabId?: number | null) => Promise<boolean>;
  isInitializing: boolean;
  cloudUrl: string;
  setCloudUrl: (v: string) => void;
  cloudUsername: string;
  setCloudUsername: (v: string) => void;
  cloudToken: string;
  setCloudToken: (v: string) => void;
  serverUrl: string;
  setServerUrl: (v: string) => void;
  serverUsername: string;
  setServerUsername: (v: string) => void;
  serverToken: string;
  setServerToken: (v: string) => void;
  verifySsl: boolean;
  setVerifySsl: (v: boolean) => Promise<void>;
  saveJiraConfig: (updates: Record<string, string | boolean | undefined>) => void;
}

export const JiraContext = createContext<JiraContextType | undefined>(undefined);
