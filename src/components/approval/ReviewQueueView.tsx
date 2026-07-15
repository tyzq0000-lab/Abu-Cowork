import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock3,
  Megaphone,
  Send,
  ShieldAlert,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { resolveReviewProposal } from '@/core/agent/permissionBridge';
import {
  getReviewQueueSnapshot,
  initializeReviewQueue,
  subscribeToReviewQueue,
  type ReviewProposal,
  type ReviewProposalStatus,
} from '@/core/approval/reviewQueue';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

const STATUSES: ReviewProposalStatus[] = ['draft', 'accepted', 'rejected'];

export default function ReviewQueueView() {
  const { t, locale } = useI18n();
  const queue = useSyncExternalStore(
    subscribeToReviewQueue,
    getReviewQueueSnapshot,
    getReviewQueueSnapshot,
  );
  const [status, setStatus] = useState<ReviewProposalStatus>('draft');
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    void initializeReviewQueue().catch((error) => {
      console.error('[ReviewQueue] Initialization failed:', error);
    });
  }, []);

  const counts = useMemo(() => ({
    draft: queue.proposals.filter((proposal) => proposal.status === 'draft').length,
    accepted: queue.proposals.filter((proposal) => proposal.status === 'accepted').length,
    rejected: queue.proposals.filter((proposal) => proposal.status === 'rejected').length,
  }), [queue.proposals]);
  const proposals = queue.proposals.filter((proposal) => proposal.status === status);

  const decide = async (proposal: ReviewProposal, accepted: boolean) => {
    if (decidingId) return;
    setDecidingId(proposal.id);
    try {
      await resolveReviewProposal(proposal.id, accepted);
    } finally {
      setDecidingId(null);
    }
  };

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }), [locale]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--abu-bg-base)]">
      <header className="shrink-0 border-b border-[var(--abu-border)] px-6 py-5">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--abu-text-primary)]">
              {t.reviewQueue.title}
            </h1>
          </div>
          {counts.draft > 0 && (
            <div className="flex h-8 min-w-8 items-center justify-center rounded-full bg-amber-100 px-2 text-sm font-semibold text-amber-800">
              {counts.draft}
            </div>
          )}
        </div>
      </header>

      <div className="shrink-0 border-b border-[var(--abu-border)] px-6 py-3">
        <div className="mx-auto flex w-full max-w-5xl gap-1 rounded-lg bg-[var(--abu-bg-muted)] p-1">
          {STATUSES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              className={cn(
                'flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
                status === item
                  ? 'bg-white text-[var(--abu-text-primary)] shadow-sm'
                  : 'text-[var(--abu-text-tertiary)] hover:text-[var(--abu-text-primary)]',
              )}
            >
              {item === 'draft' && <Clock3 className="h-4 w-4 shrink-0" />}
              {item === 'accepted' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
              {item === 'rejected' && <XCircle className="h-4 w-4 shrink-0" />}
              <span className="truncate">{t.reviewQueue[item]}</span>
              <span className="tabular-nums text-xs text-[var(--abu-text-muted)]">{counts[item]}</span>
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 py-5">
          {queue.error && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t.reviewQueue.storageError}</span>
            </div>
          )}

          {!queue.error && proposals.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center text-center text-[var(--abu-text-muted)]">
              {status === 'draft' ? (
                <Clock3 className="mb-3 h-8 w-8" strokeWidth={1.5} />
              ) : status === 'accepted' ? (
                <CheckCircle2 className="mb-3 h-8 w-8" strokeWidth={1.5} />
              ) : (
                <XCircle className="mb-3 h-8 w-8" strokeWidth={1.5} />
              )}
              <p className="text-sm">{t.reviewQueue.empty[status]}</p>
            </div>
          )}

          <div className="grid gap-3">
            {proposals.map((proposal) => (
              <ReviewProposalCard
                key={proposal.id}
                proposal={proposal}
                dateFormatter={dateFormatter}
                deciding={decidingId === proposal.id}
                onAccept={() => void decide(proposal, true)}
                onReject={() => void decide(proposal, false)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function ReviewProposalCard({
  proposal,
  dateFormatter,
  deciding,
  onAccept,
  onReject,
}: {
  proposal: ReviewProposal;
  dateFormatter: Intl.DateTimeFormat;
  deciding: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { t } = useI18n();
  const kind = {
    publish: { icon: Megaphone, label: t.reviewQueue.kind.publish },
    send: { icon: Send, label: t.reviewQueue.kind.send },
    payment: { icon: WalletCards, label: t.reviewQueue.kind.payment },
    memory: { icon: BrainCircuit, label: t.reviewQueue.kind.memory },
  }[proposal.kind];
  const risk = {
    medium: 'border-amber-200 bg-amber-50 text-amber-800',
    high: 'border-orange-200 bg-orange-50 text-orange-800',
    critical: 'border-red-200 bg-red-50 text-red-800',
  }[proposal.risk];
  const KindIcon = kind.icon;

  return (
    <article className="rounded-lg border border-[var(--abu-border)] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--abu-bg-muted)] text-[var(--abu-text-secondary)]">
            <KindIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--abu-text-primary)]">{kind.label}</h2>
              <span className={cn('rounded-md border px-1.5 py-0.5 text-xs font-medium', risk)}>
                {t.reviewQueue.risk[proposal.risk]}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--abu-text-muted)]">
              {proposal.agentName || t.reviewQueue.unknownEmployee} · {dateFormatter.format(proposal.createdAt)}
            </p>
          </div>
        </div>
        {proposal.status !== 'draft' && (
          <span className={cn(
            'rounded-md px-2 py-1 text-xs font-medium',
            proposal.status === 'accepted'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-neutral-100 text-neutral-600',
          )}>
            {t.reviewQueue[proposal.status]}
          </span>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-2.5">
        <code className="block max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-[#e0e0e0]">
          {proposal.preview ?? proposal.detail}
        </code>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--abu-text-muted)]">
          {proposal.status === 'rejected' && proposal.decisionReason !== 'user' && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{t.reviewQueue.reason[proposal.decisionReason ?? 'aborted']}</span>
            </>
          )}
          {proposal.decidedAt && <span>{dateFormatter.format(proposal.decidedAt)}</span>}
        </div>

        {proposal.status === 'draft' && (
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deciding}
              onClick={onReject}
              title={t.reviewQueue.reject}
            >
              <X className="h-4 w-4" />
              {t.reviewQueue.reject}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={deciding}
              onClick={onAccept}
              title={t.reviewQueue.accept}
              className="bg-[var(--abu-text-primary)] text-white hover:bg-[var(--abu-text-secondary)]"
            >
              <Check className="h-4 w-4" />
              {t.reviewQueue.accept}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
