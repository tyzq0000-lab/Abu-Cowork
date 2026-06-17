import { useScheduleStore } from '@/stores/scheduleStore';
import { useTriggerStore } from '@/stores/triggerStore';
import type { TriggerSource } from '@/types/trigger';
import { resolveWorkspaceRelativePath } from '@/utils/pathUtils';
import type { EmployeeRuntimeProfile } from './contract';

export interface RuntimeTemplateInstallResult {
  created: string[];
  skipped: string[];
}

function resolveTemplateSource(source: TriggerSource, workspacePath?: string | null): TriggerSource {
  if (source.type !== 'file') return source;
  if (!workspacePath) return source;
  return {
    ...source,
    path: resolveWorkspaceRelativePath(source.path, workspacePath),
  };
}

export function installRuntimeTemplates(
  employeeName: string,
  profile: EmployeeRuntimeProfile,
  opts?: { templateIds?: string[]; workspacePath?: string | null },
): RuntimeTemplateInstallResult {
  const created: string[] = [];
  const skipped: string[] = [];
  // When an explicit selection is passed, install only those templates. No
  // selection = install all (preserves existing call sites and test semantics).
  const selected = opts?.templateIds ? new Set(opts.templateIds) : null;

  for (const template of profile.workflows ?? []) {
    if (selected && !selected.has(template.id)) continue;
    if (template.kind === 'schedule') {
      const store = useScheduleStore.getState();
      const duplicate = Object.values(store.tasks).find(
        (task) =>
          task.source?.kind === 'employee-template'
          && task.source.employeeName === employeeName
          && task.source.templateId === template.id,
      );
      if (duplicate) {
        if (opts?.workspacePath && duplicate.workspacePath !== opts.workspacePath) {
          store.updateTask(duplicate.id, { workspacePath: opts.workspacePath });
        }
        skipped.push(template.id);
        continue;
      }
      store.createTask({
        name: template.name,
        description: template.description,
        prompt: template.prompt,
        schedule: template.schedule,
        skillName: template.skillName,
        agentName: employeeName,
        workspacePath: opts?.workspacePath ?? undefined,
        source: {
          kind: 'employee-template',
          employeeName,
          templateId: template.id,
        },
      });
      created.push(template.id);
      continue;
    }

    const store = useTriggerStore.getState();
    const duplicate = Object.values(store.triggers).find(
      (trigger) =>
        trigger.sourceTemplate?.kind === 'employee-template'
        && trigger.sourceTemplate.employeeName === employeeName
        && trigger.sourceTemplate.templateId === template.id,
    );
    if (duplicate) {
      if (opts?.workspacePath) {
        store.updateTrigger(duplicate.id, {
          source: resolveTemplateSource(template.source, opts.workspacePath),
          action: {
            ...duplicate.action,
            workspacePath: opts.workspacePath,
          },
        });
      }
      skipped.push(template.id);
      continue;
    }
    store.createTrigger({
      name: template.name,
      description: template.description,
      source: resolveTemplateSource(template.source, opts?.workspacePath),
      filter: template.filter,
      action: {
        agentName: employeeName,
        prompt: template.prompt,
        skillName: template.skillName,
        capability: template.capability,
        permissions: template.permissions,
        workspacePath: opts?.workspacePath ?? undefined,
      },
      debounce: { enabled: true, windowSeconds: 30 },
      sourceTemplate: {
        kind: 'employee-template',
        employeeName,
        templateId: template.id,
      },
    });
    created.push(template.id);
  }

  return { created, skipped };
}
