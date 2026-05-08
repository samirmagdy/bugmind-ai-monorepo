import React, { useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ChevronRight, X, Info, ShieldCheck, Zap } from 'lucide-react';
import { ActionButton, SurfaceCard } from './DesignSystem';
import { useI18n } from '../../i18n';

const OnboardingTour: React.FC = () => {
  const { session, completeOnboarding } = useBugMind();
  const { t } = useI18n();
  const [step, setStep] = useState(0);

  if (session.onboardingCompleted) return null;

  const steps = [
    {
      title: "Welcome to BugMind AI",
      titleKey: 'onboarding.title1',
      contentKey: 'onboarding.body1',
      icon: <Zap className="w-8 h-8 text-[var(--status-info)]" fill="currentColor" />
    },
    {
      title: "Map Jira Fields Once",
      titleKey: 'onboarding.title2',
      contentKey: 'onboarding.body2',
      icon: <ShieldCheck className="w-8 h-8 text-[var(--status-success)]" />
    },
    {
      title: "Review, Undo, Publish",
      titleKey: 'onboarding.title3',
      contentKey: 'onboarding.body3',
      icon: <Info className="w-8 h-8 text-[var(--status-info)]" />
    }
  ];

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-[var(--bg-overlay)] backdrop-blur-[12px]">
      <SurfaceCard className="w-full max-w-sm rounded-[8px] relative overflow-hidden border border-[var(--card-border)]">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-[var(--bg-input)]">
          <div 
            className="h-full bg-[var(--status-info)] transition-all duration-500 ease-in-out" 
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
        
        <button 
          onClick={completeOnboarding}
          className="icon-button absolute top-5 right-5"
          aria-label="Dismiss onboarding"
        >
          <X size={16} />
        </button>

        <div className="p-6 pt-8 space-y-6">
          <div className="relative inline-block">
            <div className="relative bg-[var(--bg-input)] w-16 h-16 rounded-[8px] flex items-center justify-center border border-[var(--border-main)]">
              {currentStep.icon}
            </div>
          </div>

          <div className="space-y-3">
            <p className="view-kicker">Getting Started</p>
            <h3 className="text-[18px] font-black text-[var(--text-main)] tracking-normal leading-tight">
              {t(currentStep.titleKey)}
            </h3>
            <p className="text-sm leading-relaxed opacity-90 tracking-normal text-[var(--text-soft)]">
              {t(currentStep.contentKey)}
            </p>
          </div>

          <div className="flex items-center justify-between pt-3">
            <div className="flex gap-2">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-[var(--status-info)]' : 'w-2 bg-[var(--border-main)] opacity-40'}`} 
                />
              ))}
            </div>

            <ActionButton 
              onClick={() => {
                if (step < steps.length - 1) setStep(step + 1);
                else completeOnboarding();
              }}
              variant="primary"
              className="w-auto px-5 py-3 rounded-[8px]"
            >
              <span className="relative text-xs uppercase tracking-[0.2em]">
                {step < steps.length - 1 ? t('common.continue') : t('common.finish')}
              </span>
              <ChevronRight size={18} className="relative group-hover:translate-x-1 transition-transform" />
            </ActionButton>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};

export default OnboardingTour;
