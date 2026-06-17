import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import FolderSelector from './FolderSelector';
import { Toggle } from '@/components/ui/toggle';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import { useToastStore } from '@/stores/toastStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useChatStore } from '@/stores/chatStore';
import { installRuntimeTemplates } from '@/core/employee/runtimeTemplates';
import {
  checkEmployeeDependencies,
  completeEmployeeDeployment,
  type EmployeeDependencyHealth,
} from '@/core/employee/deploymentFlow';

export default function EmployeeRuntimeSetupDialog() {
  const runtimeSetup = useDeepLinkStore((state) => state.runtimeSetup);
  const recentPaths = useWorkspaceStore((state) => state.recentPaths);
  const currentPath = useWorkspaceStore((state) => state.currentPath);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dependencyHealth, setDependencyHealth] = useState<EmployeeDependencyHealth[]>([]);
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
    void checkEmployeeDependencies(runtimeSetup.profile.dependencies ?? [], workspacePath)
      .then((health) => {
        if (!cancelled) setDependencyHealth(health);
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
        await completeEmployeeDeployment({
          packageId: request.packageId ?? request.name,
          packageVersion: request.packageVersion,
          employeeId: request.employeeId,
          agentName: request.name,
          workspacePath,
          defaultInitPrompt: request.defaultInitPrompt,
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

  return (
    <ConfirmDialog
      open
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
                    <span>{dependency.state}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {workflows.length > 0 && (
            <section className="space-y-2">
              <div className="font-medium text-[var(--abu-text-primary)]">推荐工作模板</div>
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl bg-[var(--abu-bg-muted)] p-3">
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
              <div className="max-h-36 space-y-2 overflow-y-auto">
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
      confirmDisabled={checking || completing || (workspaceRequired && !workspacePath)}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
