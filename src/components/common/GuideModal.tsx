import { useEffect } from 'react';
import { useI18n } from '@/i18n';
import { useSettingsStore, needsUserApiKeySetup } from '@/stores/settingsStore';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';

interface GuideModalProps {
  open: boolean;
  onClose: () => void;
  onNavigateToAIServices?: () => void;
}

export default function GuideModal({ open, onClose, onNavigateToAIServices }: GuideModalProps) {
  const { t } = useI18n();
  const needsKey = useSettingsStore(needsUserApiKeySetup);
  const hasPlatformEmployee = useEmployeeDeploymentStore(
    (s) => Object.values(s.deployments).some((d) => !!d.deploymentId),
  );
  const showApiKeyStep = needsKey && !hasPlatformEmployee;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  // 「配置 API 密钥」这一步只对**需要自己配 key 的用户**显示。企业用户装扶摇是为了跑
  // 平台部署的数字员工，模型由平台中继供给（已锁 Q1/Q2：企业永不见 key/token/模型配置），
  // 对他们摆一条"第一步去配 API Key"是直接打脸这个承诺。个人用户不受影响，照常显示。
  const steps = [
    ...(showApiKeyStep ? [{ title: t.guide.step1Title, desc: t.guide.step1Desc, keyStep: true }] : []),
    { title: t.guide.step2Title, desc: t.guide.step2Desc, keyStep: false },
    { title: t.guide.step3Title, desc: t.guide.step3Desc, keyStep: false },
    { title: t.guide.step4Title, desc: t.guide.step4Desc, keyStep: false },
  ];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-[420px] p-6 animate-in zoom-in-95 duration-150">
        <h3 className="text-[16px] font-semibold text-[var(--abu-text-primary)] mb-5">
          {t.guide.title}
        </h3>

        <div className="space-y-4 mb-6">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full bg-[var(--abu-clay)] text-white text-[13px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div>
                <div className="text-[14px] font-medium text-[var(--abu-text-primary)]">{step.title}</div>
                <div className="text-[13px] text-[var(--abu-text-tertiary)] mt-0.5">
                  {step.desc}
                  {step.keyStep && onNavigateToAIServices && (
                    <>
                      {'，'}
                      <button
                        onClick={() => {
                          onClose();
                          onNavigateToAIServices();
                        }}
                        className="text-[#3b82f6] hover:text-[#2563eb] hover:underline cursor-pointer"
                      >
                        {t.guide.step1Link}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg text-[14px] font-medium bg-[var(--abu-clay)] text-white hover:bg-[var(--abu-clay-hover)] transition-colors"
        >
          {t.guide.dismiss}
        </button>
      </div>
    </div>
  );
}
