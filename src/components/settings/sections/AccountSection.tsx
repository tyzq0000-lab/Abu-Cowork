import { useEffect } from 'react';
import {
  CircleUserRound,
  Loader2,
  LogIn,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { usePlatformAccountStore } from '@/stores/platformAccountStore';

function maskedPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

export default function AccountSection() {
  const { t, locale } = useI18n();
  const { status, user, devices, error, initialize, signIn, signOut, refreshDevices, revokeDevice } = usePlatformAccountStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const formatDate = (value: number) => new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
  const roleLabel = user?.role === 'enterprise'
    ? t.account.enterpriseRole
    : user?.role === 'admin'
      ? t.account.adminRole
      : t.account.personalRole;

  if (status === 'loading') {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-[var(--abu-text-tertiary)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <header>
        <h1 className="text-lg font-semibold text-[var(--abu-text-primary)]">{t.account.title}</h1>
        <p className="mt-1 text-sm text-[var(--abu-text-tertiary)]">{t.account.subtitle}</p>
      </header>

      {status !== 'signed-in' || !user ? (
        <section className="border-y border-[var(--abu-border)] py-7">
          <div className="flex items-start gap-4">
            <CircleUserRound className="mt-0.5 h-8 w-8 shrink-0 text-[var(--abu-text-muted)]" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[var(--abu-text-primary)]">{t.account.signedOutTitle}</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--abu-text-tertiary)]">{t.account.signedOutDescription}</p>
              <p className="mt-3 text-xs text-[var(--abu-text-muted)]">{t.account.browserHint}</p>
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={() => void (status === 'error' ? initialize() : signIn())}
                disabled={status === 'authorizing'}
                className="btn-claude-primary mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-[var(--abu-clay)] px-4 text-sm font-semibold text-white hover:bg-[var(--abu-clay-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'authorizing' ? <Loader2 className="h-4 w-4 animate-spin" /> : status === 'error' ? <RefreshCw className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                {status === 'authorizing' ? t.account.signingIn : status === 'error' ? t.account.retry : t.account.signIn}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="flex items-start justify-between gap-6 border-y border-[var(--abu-border)] py-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--abu-clay-bg)] text-[var(--abu-clay)]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[var(--abu-text-muted)]">{t.account.signedInAs}</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-[var(--abu-text-primary)]">{user.name || maskedPhone(user.phone)}</p>
                <p className="text-xs text-[var(--abu-text-tertiary)]">{maskedPhone(user.phone)} · {roleLabel}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--abu-border)] px-3 text-xs font-medium text-[var(--abu-text-secondary)] hover:bg-[var(--abu-bg-hover)]"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t.account.signOut}
            </button>
          </section>

          <section>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-[var(--abu-text-primary)]">{t.account.deviceSessions}</h2>
                <p className="mt-1 text-xs text-[var(--abu-text-tertiary)]">{t.account.deviceSessionsDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => void refreshDevices()}
                className="btn-ghost inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs text-[var(--abu-text-tertiary)] hover:bg-[var(--abu-bg-hover)] hover:text-[var(--abu-text-primary)]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t.account.refresh}
              </button>
            </div>

            <div className="mt-4 divide-y divide-[var(--abu-border)] border-y border-[var(--abu-border)]">
              {devices.map((device) => (
                <div key={device.id} className="flex items-center gap-3 py-4">
                  <Monitor className="h-4 w-4 shrink-0 text-[var(--abu-text-muted)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--abu-text-primary)]">{device.deviceName}</p>
                      {device.current && (
                        <span className="rounded bg-[var(--abu-clay-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--abu-clay)]">
                          {t.account.currentDevice}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--abu-text-muted)]">
                      {t.account.lastActive} {formatDate(device.lastSeenAt)} · {t.account.expiresAt} {formatDate(device.expiresAt)}
                    </p>
                  </div>
                  {!device.current && (
                    <button
                      type="button"
                      onClick={() => void revokeDevice(device.id)}
                      className="btn-ghost rounded-md p-2 text-[var(--abu-text-muted)] hover:bg-red-50 hover:text-red-600"
                      title={t.account.revoke}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </section>
        </>
      )}
    </div>
  );
}
