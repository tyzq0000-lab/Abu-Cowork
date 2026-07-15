import { useCallback } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import { useToastStore } from '@/stores/toastStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { installFromDeepLink } from '@/core/deeplink/installer';
import { useI18n, format } from '@/i18n';
import { useEmployeeDeploymentStore } from '@/stores/employeeDeploymentStore';
import { completeEmployeeDeployment } from '@/core/employee/deploymentFlow';
import { exchangeDeploymentEnrollment } from '@/core/employee/deploymentEnrollment';

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

    void (async () => {
      try {
        const installed = await installFromDeepLink(req);
        const displayName = req.name ?? installed.name;
        if (installed.kind === 'employee' && installed.integrity) {
          useEmployeeDeploymentStore.getState().saveIntegrity(installed.name, installed.integrity);
        }
        await useDiscoveryStore.getState().refresh();
        if (installed.kind === 'employee') {
          const discovered = useDiscoveryStore
            .getState()
            .agents
            .some((agent) => agent.name === installed.name);
          if (!discovered) {
            throw new Error(`Employee "${installed.name}" was installed but could not be loaded.`);
          }
          const packageId = req.packageId ?? installed.packageId ?? installed.name;
          const deployments = useEmployeeDeploymentStore.getState().deployments;
          const existing = req.hireId
            ? Object.values(deployments).find((record) => record.hireId === req.hireId)
            : deployments[packageId];
          if (existing && existing.agentName === installed.name) {
            const platformBinding = req.enrollmentCode && req.enrollmentUrl && req.employeeId && req.hireId
              ? await exchangeDeploymentEnrollment({
                  employeeId: req.employeeId,
                  hireId: req.hireId,
                  enrollmentCode: req.enrollmentCode,
                  enrollmentUrl: req.enrollmentUrl,
                })
              : undefined;
            await completeEmployeeDeployment({
              packageId,
              packageVersion: req.packageVersion ?? installed.packageVersion,
              employeeId: req.employeeId,
              agentName: installed.name,
              workspacePath: existing.workspacePath,
              defaultInitPrompt: installed.defaultInitPrompt,
              platformBinding,
            });
          } else if (installed.runtimeProfile) {
            useDeepLinkStore.getState().setRuntimeSetup({
              name: installed.name,
              packageId,
              packageVersion: req.packageVersion ?? installed.packageVersion,
              employeeId: req.employeeId,
              hireId: req.hireId,
              enrollmentCode: req.enrollmentCode,
              enrollmentUrl: req.enrollmentUrl,
              defaultInitPrompt: installed.defaultInitPrompt,
              level: installed.audit?.level ?? 'L1',
              profile: installed.runtimeProfile,
            });
          } else {
            const platformBinding = req.enrollmentCode && req.enrollmentUrl && req.employeeId && req.hireId
              ? await exchangeDeploymentEnrollment({
                  employeeId: req.employeeId,
                  hireId: req.hireId,
                  enrollmentCode: req.enrollmentCode,
                  enrollmentUrl: req.enrollmentUrl,
                })
              : undefined;
            await completeEmployeeDeployment({
              packageId,
              packageVersion: req.packageVersion ?? installed.packageVersion,
              employeeId: req.employeeId,
              agentName: installed.name,
              workspacePath: null,
              defaultInitPrompt: installed.defaultInitPrompt,
              platformBinding,
            });
          }
        }
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
      } catch (err: unknown) {
        addToast({
          type: 'error',
          title: i18n.deepLink.installFailedTitle,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        useDeepLinkStore.getState().setInstalling(false);
      }
    })();
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
