import { useContext } from 'react';
import { JiraContext } from '../context/jira-context';

export const useJiraContext = () => {
  const context = useContext(JiraContext);
  if (!context) throw new Error('useJiraContext must be used within JiraProvider');
  return context;
};
