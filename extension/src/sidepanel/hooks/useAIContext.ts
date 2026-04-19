import { useContext } from 'react';
import { AIContext } from '../context/ai-context';

export const useAIContext = () => {
  const context = useContext(AIContext);
  if (!context) throw new Error('useAIContext must be used within AIProvider');
  return context;
};
