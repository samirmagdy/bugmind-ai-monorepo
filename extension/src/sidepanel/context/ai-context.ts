import { createContext } from 'react';
import { BugReport, TestCase, Usage } from '../types';

export interface AIContextType {
  usage: Usage | null;
  fetchUsage: () => Promise<void>;
  customModel: string;
  setCustomModel: (m: string) => void;
  customKey: string;
  setCustomKey: (k: string) => void;
  hasCustomKeySaved: boolean;
  setHasCustomKeySaved: (v: boolean) => void;
  fetchAISettings: () => Promise<void>;
  generateBugs: () => Promise<void>;
  generateTestCases: () => Promise<void>;
  handleManualGenerate: () => Promise<void>;
  submitBugs: (index?: number) => Promise<void>;
  regenerateBug: (index: number, refinementPrompt?: string) => Promise<void>;
  searchUsers: (query: string, bugIndex?: number, fieldId?: string) => Promise<import('../types').JiraUser[] | void>;
  handleUpdateBug: (index: number, updates: Partial<BugReport>) => void;
  handleUpdateTestCase: (index: number, updates: Partial<TestCase>) => void;
  publishTestCasesToXray: () => Promise<void>;
  validateBug: (index: number) => Promise<boolean>;
  preparePreviewBug: (index: number) => void;
}

export const AIContext = createContext<AIContextType | undefined>(undefined);
