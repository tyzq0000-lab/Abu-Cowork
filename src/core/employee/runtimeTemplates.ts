import { useScheduleStore } from '@/stores/scheduleStore';
import { useTriggerStore } from '@/stores/triggerStore';
import type { EmployeeRuntimeProfile } from './contract';

export interface RuntimeTemplateInstallResult {
  created: string[];
  skipped: string[];
}

export function installRuntimeTemplates(
  employeeName: string,
  profile: EmployeeRuntimeProfile,
): RuntimeTemplateInstallResult {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const template of profile.workflows ?? []) {
    if (template.kind === 'schedule') {
      const store = useScheduleStore.getState();
      const duplicate = Object.values(store.tasks).some(
        (task) =>
          task.source?.kind === 'employee-template'
          && task.source.employeeName === employeeName
          && task.source.templateId === template.id,
      );
      if (duplicate) {
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
    const duplicate = Object.values(store.triggers).some(
      (trigger) =>
        trigger.sourceTemplate?.kind === 'employee-template'
        && trigger.sourceTemplate.employeeName === employeeName
        && trigger.sourceTemplate.templateId === template.id,
    );
    if (duplicate) {
      skipped.push(template.id);
      continue;
    }
    store.createTrigger({
      name: template.name,
      description: template.description,
      source: template.source,
      filter: template.filter,
      action: {
        agentName: employeeName,
        prompt: template.prompt,
        skillName: template.skillName,
        capability: template.capability,
        permissions: template.permissions,
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
