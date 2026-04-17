import React, { useState } from 'react';
import { useBugMind } from '../../context/BugMindContext';
import { ChevronRight, X, Info, ShieldCheck, Zap } from 'lucide-react';

const OnboardingTour: React.FC = () => {
  const { session, completeOnboarding } = useBugMind();
  const [step, setStep] = useState(0);

  if (session.onboardingCompleted) return null;

  const steps = [
    {
      title: "Welcome to BugMind!",
      content: "Let's get you set up. BugMind analyzes Jira tickets using AI to help you identify functional gaps and edge cases instantly.",
      icon: <Zap className="w-8 h-8 text-[var(--status-info)]" />
    },
    {
      title: "Secure Connection",
      content: "First, connect your Jira instance. We use industry-standard encryption and never store your Jira credentials on our servers. They stay safely in your browser.",
      icon: <ShieldCheck className="w-8 h-8 text-[var(--status-success)]" />
    },
    {
      title: "Ready to Analyze",
      content: "Once connected, navigate to any Jira Issue and click 'Analyze with AI'. BugMind will scan the description and AC to generate detailed bug reports.",
      icon: <Info className="w-8 h-8 text-[var(--status-info)]" />
    }
  ];

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md animate-in fade-in duration-500">
      <div className="w-full max-w-sm bg-[var(--bg-card)] rounded-[2.5rem] shadow-[var(--shadow-xl)] border border-[var(--border-main)] overflow-hidden relative group">
        <div className="absolute top-0 left-0 w-full h-1 bg-[var(--bg-app)]">
          <div 
            className="h-full bg-[var(--accent)] transition-all duration-500 ease-out" 
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
        
        <button 
          onClick={completeOnboarding}
          className="absolute top-6 right-6 p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
        >
          <X size={20} />
        </button>

        <div className="p-10 space-y-8">
          <div className="bg-[var(--bg-input)] w-20 h-20 rounded-3xl flex items-center justify-center shadow-inner border border-[var(--border-main)]">
            {currentStep.icon}
          </div>

          <div className="space-y-4">
            <h3 className="text-2xl font-black text-[var(--text-main)] tracking-tight leading-tight">
              {currentStep.title}
            </h3>
            <p className="text-[var(--text-muted)] text-sm leading-relaxed opacity-90">
              {currentStep.content}
            </p>
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-[var(--accent)]' : 'w-1.5 bg-[var(--border-main)]'}`} 
                />
              ))}
            </div>

            <button 
              onClick={() => {
                if (step < steps.length - 1) setStep(step + 1);
                else completeOnboarding();
              }}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold px-6 py-3 rounded-2xl flex items-center gap-2 transition-all shadow-xl shadow-[var(--accent)]/20 active:scale-95"
            >
              {step < steps.length - 1 ? 'Next' : 'Get Started'}
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTour;
