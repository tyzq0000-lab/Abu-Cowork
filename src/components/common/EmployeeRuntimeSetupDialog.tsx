import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { Toggle } from '@/components/ui/toggle';
import { useDeepLinkStore } from '@/stores/deepLinkStore';
import { useToastStore } from '@/stores/toastStore';
import { installRuntimeTemplates } from '@/core/employee/runtimeTemplates';

export default function EmployeeRuntimeSetupDialog() {
  const runtimeSetup = useDeepLinkStore((state) => state.runtimeSetup);
  // Per-template selection. Recommended templates start checked, the rest
  // unchecked — the user opts in to anything beyond the maker's defaults.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const workflows = runtimeSetup?.profile.workflows ?? [];
    setSelectedIds(new Set(workflows.filter((w) => w.recommended).map((w) => w.id)));
  }, [runtimeSetup]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const request = useDeepLinkStore.getState().runtimeSetup;
    if (!request) return;
    const result = installRuntimeTemplates(request.name, request.profile, {
      templateIds: Array.from(selectedIds),
    });
    useDeepLinkStore.getState().clearRuntimeSetup();
    useToastStore.getState().addToast({
      type: 'success',
      title: '员工自动化已创建',
      message: result.created.length > 0
        ? `已创建 ${result.created.length} 个工作模板，可在定时任务或触发器中继续调整。`
        : '未选择任何模板，或所选模板已存在，没有创建。',
    });
  }, [selectedIds]);

  const handleCancel = useCallback(() => {
    useDeepLinkStore.getState().clearRuntimeSetup();
  }, []);

  if (!runtimeSetup) return null;
  const workflows = runtimeSetup.profile.workflows ?? [];

  return (
    <ConfirmDialog
      open
      title={`配置数字员工自动化 · ${runtimeSetup.level}`}
      message={(
        <div className="space-y-3">
          <p>
            员工包提供了以下工作模板。勾选你想启用的项，确认后扶摇会创建对应的定时任务或事件触发器，
            之后仍可修改、暂停或删除。
          </p>
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl bg-[var(--abu-bg-muted)] p-3">
            {workflows.map((workflow) => (
              <div key={workflow.id} className="rounded-lg bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[var(--abu-text-primary)]">
                    {workflow.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px]">
                      {workflow.kind === 'schedule' ? '定时任务' : '事件触发'}
                    </span>
                    <Toggle
                      size="sm"
                      checked={selectedIds.has(workflow.id)}
                      onChange={() => toggle(workflow.id)}
                    />
                  </div>
                </div>
                {workflow.description && (
                  <p className="mt-1 text-[12px]">{workflow.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      confirmText="创建并启用"
      cancelText="暂不创建"
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
