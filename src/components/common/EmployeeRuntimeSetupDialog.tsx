import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import FolderSelector from './FolderSelector';
import { Toggle } from '@/components/ui/toggle';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import type { EmployeeRuntimeSetupRequest } from '@/stores/deepLinkStore';
import { useToastStore } from '@/stores/toastStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useChatStore } from '@/stores/chatStore';
import { installRuntimeTemplates } from '@/core/employee/runtimeTemplates';
import {
  checkEmployeeDependencies,
  completeEmployeeDeployment,
  hasBlockingEmployeeDependencies,
  unmetEmployeeDependencies,
  type EmployeeDependencyHealth,
} from '@/core/employee/deploymentFlow';
import { exchangeDeploymentEnrollment } from '@/core/employee/deploymentEnrollment';

// 别把 'available-to-configure' 这种裸英文枚举直接甩给用户看。
const DEPENDENCY_STATE_LABEL: Record<EmployeeDependencyHealth['state'], string> = {
  ready: '已就绪',
  unavailable: '未安装 / 未选择',
  'needs-authorization': '开工时需授权',
  'available-to-configure': '可稍后配置',
};

export default function EmployeeRuntimeSetupDialog() {
  const runtimeSetup = useDeepLinkStore((state) => state.runtimeSetup);
  const recentPaths = useWorkspaceStore((state) => state.recentPaths);
  const currentPath = useWorkspaceStore((state) => state.currentPath);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dependencyHealth, setDependencyHealth] = useState<EmployeeDependencyHealth[]>([]);
  const [checkedSetup, setCheckedSetup] = useState<EmployeeRuntimeSetupRequest | null>(null);
  const [checking, setChecking] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    const workflows = runtimeSetup?.profile.workflows ?? [];
    setSelectedIds(new Set(workflows.filter((workflow) => workflow.recommended).map((workflow) => workflow.id)));
    setWorkspacePath(currentPath);
  }, [runtimeSetup, currentPath]);

  useEffect(() => {
    if (!runtimeSetup) return;
    let cancelled = false;
    setChecking(true);
    setCheckedSetup(null);
    void checkEmployeeDependencies(runtimeSetup.profile.dependencies ?? [], workspacePath)
      .then((health) => {
        if (!cancelled) {
          setDependencyHealth(health);
          setCheckedSetup(runtimeSetup);
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeSetup, workspacePath]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const request = useDeepLinkStore.getState().runtimeSetup;
    if (!request || completing) return;
    const workspaceRequired = request.profile.workspace?.required === true;
    if (workspaceRequired && !workspacePath) {
      useToastStore.getState().addToast({
        type: 'error',
        title: '请选择项目工作区',
        message: '该员工包声明工作区为必需项。选择后才能创建持久化会话。',
      });
      return;
    }

    setCompleting(true);
    void (async () => {
      try {
        const templates = installRuntimeTemplates(request.name, request.profile, {
          templateIds: Array.from(selectedIds),
          workspacePath,
        });
        const platformBinding = request.enrollmentCode && request.enrollmentUrl && request.employeeId && request.hireId
          ? await exchangeDeploymentEnrollment({
              employeeId: request.employeeId,
              hireId: request.hireId,
              enrollmentCode: request.enrollmentCode,
              enrollmentUrl: request.enrollmentUrl,
            })
          : undefined;
        await completeEmployeeDeployment({
          packageId: request.packageId ?? request.name,
          packageVersion: request.packageVersion,
          employeeId: request.employeeId,
          agentName: request.name,
          workspacePath,
          defaultInitPrompt: request.defaultInitPrompt,
          platformBinding,
        });
        // Restore the first message the user typed before this dialog interrupted
        // them — now that the employee conversation is open, its ChatInput picks it
        // up from pendingInput instead of the (now-replaced) welcome input.
        if (request.pendingInput) {
          useChatStore.getState().setPendingInput(request.pendingInput);
        }
        useDeepLinkStore.getState().clearRuntimeSetup();
        useToastStore.getState().addToast({
          type: 'success',
          title: '数字员工已就绪',
          message: templates.created.length > 0
            ? `已创建 ${templates.created.length} 个推荐工作模板并打开员工会话。`
            : '已打开员工会话；重复模板未再次创建。',
        });
      } catch (error) {
        useToastStore.getState().addToast({
          type: 'error',
          title: '首次配置未完成',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setCompleting(false);
      }
    })();
  }, [completing, selectedIds, workspacePath]);

  const handleCancel = useCallback(() => {
    useDeepLinkStore.getState().clearRuntimeSetup();
  }, []);

  if (!runtimeSetup) return null;
  const workflows = runtimeSetup.profile.workflows ?? [];
  const workspaceRequired = runtimeSetup.profile.workspace?.required === true;
  const authorizations = runtimeSetup.profile.authorizations ?? [];
  const hasBlockingDependency = hasBlockingEmployeeDependencies(dependencyHealth);
  // 「完成配置并开始工作」曾经是个哑巴禁用态：灰着，但一个字都不说为什么。
  // 这里把每一种 disabled 成因翻成一句能照做的话。
  const blockReasons = [
    ...(checking || checkedSetup !== runtimeSetup ? ['正在检查运行环境…'] : []),
    ...(workspaceRequired && !workspacePath ? ['请先选择项目工作区'] : []),
    ...unmetEmployeeDependencies(dependencyHealth).map((dependency) => (
      dependency.state === 'unavailable'
        ? `请先在本机安装「${dependency.name}」，装好后重开本弹窗即可`
        : `「${dependency.name}」需要在开工时完成授权`
    )),
  ];

  return (
    <ConfirmDialog
      open
      // Workspace picker + dependency table + blocker list + workflow toggles +
      // authorization cards do not fit the 360px default; ConfirmDialog clamps
      // this to the viewport width on small windows.
      width={540}
      title={`配置数字员工 · ${runtimeSetup.level}`}
      message={(
        <div className="space-y-4">
          {runtimeSetup.profile.workspace && (
            <section className="space-y-2">
              <div className="font-medium text-[var(--abu-text-primary)]">
                项目工作区{workspaceRequired ? '（必需）' : '（可选）'}
              </div>
              <FolderSelector
                currentPath={workspacePath}
                recentPaths={recentPaths}
                onSelect={setWorkspacePath}
                onClear={() => setWorkspacePath(null)}
              />
              {workspacePath && (
                <p className="break-all text-[11px] text-[var(--abu-text-muted)]">{workspacePath}</p>
              )}
            </section>
          )}

          {dependencyHealth.length > 0 && (
            <section className="space-y-2">
              <div className="font-medium text-[var(--abu-text-primary)]">运行环境检查</div>
              <div className="space-y-1 rounded-xl bg-[var(--abu-bg-muted)] p-3">
                {dependencyHealth.map((dependency) => (
                  <div key={`${dependency.name}-${dependency.state}`} className="flex justify-between gap-3 text-[12px]">
                    <span>{dependency.name}{dependency.required ? '（必需）' : ''}</span>
                    <span className={dependency.state === 'ready' ? '' : 'text-[var(--abu-text-muted)]'}>
                      {DEPENDENCY_STATE_LABEL[dependency.state]}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {blockReasons.length > 0 && (
            <section className="space-y-1 rounded-xl border border-[var(--abu-border)] p-3">
              <div className="font-medium text-[var(--abu-text-primary)]">还差这些才能开工</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-[var(--abu-text-tertiary)]">
                {blockReasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </section>
          )}

          {workflows.length > 0 && (
            <section className="space-y-2">
              <div className="font-medium text-[var(--abu-text-primary)]">推荐工作模板</div>
              {/* No inner max-h/overflow: the ConfirmDialog body is the one scroll container. */}
              <div className="space-y-2 rounded-xl bg-[var(--abu-bg-muted)] p-3">
                {workflows.map((workflow) => (
                  <div key={workflow.id} className="rounded-lg bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-[var(--abu-text-primary)]">{workflow.name}</span>
                      <Toggle
                        size="sm"
                        checked={selectedIds.has(workflow.id)}
                        onChange={() => toggle(workflow.id)}
                      />
                    </div>
                    {workflow.description && <p className="mt-1 text-[12px]">{workflow.description}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {authorizations.length > 0 && (
            <section className="space-y-2">
              <div className="font-medium text-[var(--abu-text-primary)]">岗位授权与降级</div>
              <div className="space-y-2">
                {authorizations.map((authorization) => (
                  <div key={authorization.type} className="rounded-lg border p-2 text-[12px]">
                    <div className="font-medium">{authorization.type} · {authorization.required}</div>
                    <p>{authorization.description}</p>
                    <p className="text-[var(--abu-text-muted)]">未授权：{authorization.fallback}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      confirmText={completing ? '正在创建会话...' : '完成配置并开始工作'}
      cancelText="稍后配置"
      confirmDisabled={
        checking
        || checkedSetup !== runtimeSetup
        || completing
        || hasBlockingDependency
        || (workspaceRequired && !workspacePath)
      }
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
