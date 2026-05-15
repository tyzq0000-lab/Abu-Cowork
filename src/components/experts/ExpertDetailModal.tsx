import { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronUp, Check, MessageCircle } from 'lucide-react';
import { useI18n } from '@/i18n';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { parseAgentFile, agentRegistry } from '@/core/agent/registry';
import { useSettingsStore, resolveAgentModel, getEffectiveModel } from '@/stores/settingsStore';
import { expertCategories } from '@/data/experts/categories';
import type { MarketplaceItem } from '@/types/marketplace';
import type { TranslationDict } from '@/i18n/types';

interface ExpertDetailModalProps {
  expert: MarketplaceItem | null;
  onClose: () => void;
  onStartChat: (expertId: string, promptText?: string) => void;
}

function getCategoryLabel(
  categoryId: string,
  t: TranslationDict
): string {
  const cat = expertCategories.find((c) => c.id === categoryId);
  if (!cat) return categoryId;
  return t.experts[cat.labelKey as keyof TranslationDict['experts']] as string;
}

function getAvatarFromContent(content?: string): string {
  if (!content) return '🤖';
  const match = content.match(/^---[\s\S]*?avatar:\s*(.+?)\s*\n/m);
  return match?.[1] ?? '🤖';
}

function resolveAvatar(expert: MarketplaceItem): string {
  return expert.avatar ?? getAvatarFromContent(expert.content);
}

export default function ExpertDetailModal({
  expert,
  onClose,
  onStartChat,
}: ExpertDetailModalProps) {
  const { t } = useI18n();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const settingsState = useSettingsStore();
  const globalModel = getEffectiveModel(settingsState);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!expert) return null;

  // Prefer parsing from inline content (marketplace template); fall back to registry (builtin)
  const parsed = expert.content
    ? parseAgentFile(expert.content, '__preview__')
    : agentRegistry.getAgent(expert.name) ?? null;
  const avatar = resolveAvatar(expert);
  const categoryLabel = getCategoryLabel(expert.category, t);
  const resolvedModel = parsed?.model
    ? resolveAgentModel(parsed.model, settingsState)
    : globalModel;
  const isInherit = !parsed?.model || parsed.model === 'inherit';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative bg-[var(--abu-bg-base)] rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden border border-[var(--abu-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--abu-text-muted)] hover:text-[var(--abu-text-primary)] hover:bg-[var(--abu-bg-active)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {/* Header: avatar + name + category */}
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--abu-bg-active)] text-3xl shrink-0 select-none">
              {avatar}
            </div>
            <div className="pt-1">
              <h2 className="text-lg font-semibold text-[var(--abu-text-primary)] leading-snug">
                {expert.name}
              </h2>
              {expert.category && (
                <p className="mt-0.5 text-sm text-[var(--abu-text-tertiary)]">
                  {categoryLabel}
                  {expert.tags?.[0] && (
                    <span> · {expert.tags[0]}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-[var(--abu-text-secondary)] leading-relaxed">
            {expert.description}
          </p>

          {/* Expertise */}
          {expert.expertise && expert.expertise.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--abu-text-tertiary)] uppercase tracking-wide">
                {t.experts.expertise}
              </p>
              <ul className="space-y-1.5">
                {expert.expertise.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-[var(--abu-text-secondary)]">
                    <Check className="h-3.5 w-3.5 text-[var(--abu-clay)] shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sample Prompts */}
          {expert.samplePrompts && expert.samplePrompts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--abu-text-tertiary)] uppercase tracking-wide">
                {t.experts.samplePrompts}
              </p>
              <ul className="space-y-1.5">
                {expert.samplePrompts.map((prompt) => (
                  <li key={prompt}>
                    <button
                      onClick={() => onStartChat(expert.id, prompt)}
                      className="w-full text-left flex items-center gap-2 text-sm text-[var(--abu-text-secondary)] bg-[var(--abu-bg-subtle)] hover:bg-[var(--abu-bg-active)] hover:text-[var(--abu-text-primary)] border border-[var(--abu-border)] rounded-lg px-3 py-2 transition-colors group cursor-pointer"
                    >
                      <span className="text-[var(--abu-clay)] shrink-0">›</span>
                      <span className="italic">"{prompt}"</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advanced Settings (collapsible) */}
          {parsed && (
            <div className="border-t border-[var(--abu-border)] pt-4">
              <button
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center justify-between w-full text-sm text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-secondary)] transition-colors"
              >
                <span className="font-medium">{t.experts.advancedSettings}</span>
                {advancedOpen
                  ? <ChevronUp className="h-4 w-4" />
                  : <ChevronDown className="h-4 w-4" />
                }
              </button>

              {advancedOpen && (
                <div className="mt-3 space-y-3">
                  {/* Model */}
                  <div>
                    <p className="text-[11px] text-[var(--abu-text-muted)] mb-0.5">{t.experts.modelLabel}</p>
                    <p className="text-xs text-[var(--abu-text-secondary)] font-mono">
                      {isInherit ? `${t.experts.modelInherit}（${globalModel}）` : resolvedModel}
                    </p>
                  </div>

                  {/* Tools */}
                  {parsed.tools && parsed.tools.length > 0 && (
                    <div>
                      <p className="text-[11px] text-[var(--abu-text-muted)] mb-1">{t.experts.toolsLabel}</p>
                      <div className="flex flex-wrap gap-1">
                        {parsed.tools.map((tool) => (
                          <span key={tool} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-mono">
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* System Prompt */}
                  {parsed.systemPrompt && (
                    <div>
                      <p className="text-[11px] text-[var(--abu-text-muted)] mb-1">{t.experts.systemPromptLabel}</p>
                      <div className="border border-[var(--abu-border)] rounded-lg p-3 bg-[var(--abu-bg-subtle)] max-h-40 overflow-y-auto">
                        <MarkdownRenderer content={parsed.systemPrompt} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Start Chat CTA — sticky footer */}
        <div className="px-6 pb-6 pt-3 border-t border-[var(--abu-border)]">
          <button
            onClick={() => onStartChat(expert.id)}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[var(--abu-clay)] text-white text-sm font-medium hover:bg-[var(--abu-clay-hover)] transition-colors"
          >
            <MessageCircle className="h-4 w-4" />
            {t.experts.startChat}
          </button>
        </div>
      </div>
    </div>
  );
}
