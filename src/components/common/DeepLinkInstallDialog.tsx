import { useCallback } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import { useToastStore } from '@/stores/toastStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { installFromDeepLink } from '@/core/deeplink/installer';
import { useI18n, format } from '@/i18n';

/**
 * Confirm dialog for fuyao://install deep links. Renders when the deep-link
 * handler stages a pending request; on confirm it downloads + unpacks the
 * package, refreshes discovery so the new employee/skill shows up, and
 * reports the outcome via toasts.
 */
export default function DeepLinkInstallDialog() {
  const pending = useDeepLinkStore((s) => s.pending);
  const installing = useDeepLinkStore((s) => s.installing);
  const { t } = useI18n();

  const handleConfirm = useCallback(() => {
    const req = useDeepLinkStore.getState().pending;
    if (!req || useDeepLinkStore.getState().installing) return;

    const { clearPending, setInstalling } = useDeepLinkStore.getState();
    const { addToast } = useToastStore.getState();
    const i18n = t;

    clearPending();
    setInstalling(true);
    addToast({ type: 'info', title: i18n.deepLink.installingTitle, duration: 5000 });

    void installFromDeepLink(req)
      .then((installed) => {
        const displayName = req.name ?? installed.name;
        addToast({
          type: 'success',
          title: i18n.deepLink.installSuccessTitle,
          message: format(
            installed.kind === 'employee'
              ? i18n.deepLink.installSuccessEmployee
              : i18n.deepLink.installSuccessSkill,
            { name: displayName },
          ),
        });
        return useDiscoveryStore.getState().refresh();
      })
      .catch((err: unknown) => {
        addToast({
          type: 'error',
          title: i18n.deepLink.installFailedTitle,
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        useDeepLinkStore.getState().setInstalling(false);
      });
  }, [t]);

  const handleCancel = useCallback(() => {
    useDeepLinkStore.getState().clearPending();
  }, []);

  if (!pending || installing) return null;

  const name = pending.name ?? t.deepLink.unnamedPackage;
  let host = '';
  try {
    host = new URL(pending.url).hostname;
  } catch {
    // parser guarantees a valid URL; defensive fallback only
  }

  return (
    <ConfirmDialog
      open
      title={t.deepLink.installTitle}
      message={format(
        pending.pkgType === 'employee'
          ? t.deepLink.installEmployeeMessage
          : t.deepLink.installSkillMessage,
        { name, host },
      )}
      confirmText={t.deepLink.installConfirm}
      cancelText={t.common.cancel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
