import React, { useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ChevronRight, X, Info, ShieldCheck, Zap } from 'lucide-react';

const OnboardingTour: React.FC = () => {
  const { session, completeOnboarding } = useBugMind();
  const [step, setStep] = useState(0);

  if (session.onboardingCompleted) return null;

  const steps = [
    {
      title: "Welcome to BugMind AI",
      content: "Experience the next generation of quality assurance. BugMind synthesizes Jira requirements to reveal functional edge cases and hidden logic gaps with mathematical precision.",
      icon: <Zap className="w-10 h-10 text-[var(--status-info)]" fill="currentColor" />
    },
    {
      title: "Zero-Trust Integration",
      content: "Your data's integrity is our priority. We employ end-to-end encryption for Jira handshakes. Credentials remain in your local vault, ensuring absolute sovereign control.",
      icon: <ShieldCheck className="w-10 h-10 text-[var(--status-success)]" />
    },
    {
      title: "Intelligent Synthesis",
      content: "Deploy analysis across any Jira environment. Our engine audits descriptions and criteria to generate structured, production-ready bug reports and test assets.",
      icon: <Info className="w-10 h-10 text-[var(--status-info)]" />
    }
  ];

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-8 bg-[var(--bg-overlay)] backdrop-blur-[15px] animate-bp-flicker">
      <div className="w-full max-w-md bp-panel rounded-[3rem] shadow-2xl relative group overflow-hidden border border-[var(--border-main)]">
        {/* Animated Progress Track */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-[var(--bg-input)]">
          <div 
            className="h-full bg-gradient-to-r from-[var(--status-info)] to-[var(--accent)] transition-all duration-700 ease-in-out shadow-[0_0_15px_var(--status-info)]" 
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
        
        <button 
          onClick={completeOnboarding}
          className="absolute top-8 right-8 p-2.5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all bg-[var(--bg-input)] hover:bg-[var(--bg-card)] rounded-none border border-[var(--border-main)] shadow-sm"
        >
          <X size={20} />
        </button>

        <div className="p-12 space-y-10">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-[var(--status-info)]/20 blur-2xl rounded-full animate-pulse"></div>
            <div className="relative bg-[var(--bg-input)] w-24 h-24 rounded-none flex items-center justify-center shadow-inner border border-[var(--border-main)] group-hover:scale-105 transition-transform duration-700">
              {currentStep.icon}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-black text-[var(--text-main)] tracking-tight leading-tight bp-heading">
              {currentStep.title}
            </h3>
            <p className="bp-subheading text-base leading-relaxed opacity-60">
              {currentStep.content}
            </p>
          </div>

          <div className="flex items-center justify-between pt-6">
            <div className="flex gap-2">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1.5 rounded-full transition-all duration-500 ${i === step ? 'w-10 bg-[var(--status-info)] shadow-[0_0_8px_var(--status-info)]' : 'w-2 bg-[var(--border-main)] opacity-40'}`} 
                />
              ))}
            </div>

            <button 
              onClick={() => {
                if (step < steps.length - 1) setStep(step + 1);
                else completeOnboarding();
              }}
              className="group relative overflow-hidden bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-white font-black px-10 py-5 rounded-[1.8rem] flex items-center gap-3 transition-all shadow-2xl shadow-[var(--accent)]/30 enabled:hover:scale-[1.05] active:scale-95"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
              <span className="relative text-xs uppercase tracking-[0.2em]">
                {step < steps.length - 1 ? 'Continue' : 'Initialize'}
              </span>
              <ChevronRight size={18} className="relative group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTour;
