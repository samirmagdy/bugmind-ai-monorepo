import { createContext } from 'react';
import { JiraBootstrapContext, JiraProject, XrayDefaultsResponse } from '../types';

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
  createConnection: (config: JiraConnectionConfig) => Promise<boolean>;
  fetchConnections: () => Promise<void>;
  deleteConnection: (id: number, tabId?: number | null) => Promise<void>;
  setActiveConnection: (id: number, hostUrl: string) => Promise<void>;
  updateConnection: (id: number, updates: Record<string, unknown>) => Promise<boolean>;
  fetchProjects: (id: number) => Promise<JiraProject[]>;
  fetchXrayDefaults: (id: number, storyIssueKey?: string) => Promise<XrayDefaultsResponse | null>;
  saveFieldSettings: (params: {
    jiraConnectionId: number;
    projectKey: string;
    projectId?: string;
    issueTypeId: string;
    visibleFields?: string[];
    aiMapping?: Record<string, string>;
  }) => Promise<boolean>;
  bootstrapContext: (params: {
    instanceUrl: string;
    projectKey?: string;
    projectId?: string;
    issueTypeId?: string;
    tabId?: number | null;
    force?: boolean;
    tokenOverride?: string;
  }) => Promise<JiraBootstrapContext | null>;
  applyBootstrapContext: (data: JiraBootstrapContext, tabId?: number | null, hasProjectContext?: boolean) => void;
  verifySsl: boolean;
  setVerifySsl: (v: boolean) => Promise<void>;
}

export const JiraContext = createContext<JiraContextType | undefined>(undefined);
