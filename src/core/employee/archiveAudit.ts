import { strFromU8 } from 'fflate';
import {
  auditEmployeePackage,
  parseEmployeePlugin,
  type EmployeeAuditReport,
} from './contract';

export interface EmployeeArchiveAuditResult {
  name: string;
  manifestPath?: string;
  report: EmployeeAuditReport;
}

export function auditEmployeeArchiveEntries(
  rawEntries: Record<string, Uint8Array>,
): EmployeeArchiveAuditResult {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(rawEntries)) {
    entries[path.replace(/\\/g, '/').replace(/^\/+/, '')] = data;
  }

  const manifestPath = Object.keys(entries).find(
    (path) =>
      path === '.codebuddy-plugin/plugin.json'
      || path.endsWith('/.codebuddy-plugin/plugin.json'),
  );
  if (!manifestPath) {
    return {
      name: 'unknown-package',
      report: auditEmployeePackage({
        manifest: null,
        files: Object.keys(entries),
      }),
    };
  }

  const prefix = manifestPath.slice(
    0,
    manifestPath.length - '.codebuddy-plugin/plugin.json'.length,
  );
  const files = Object.keys(entries)
    .filter((path) => !prefix || path.startsWith(prefix))
    .map((path) => prefix ? path.slice(prefix.length) : path)
    .filter(Boolean);
  const manifest = parseEmployeePlugin(strFromU8(entries[manifestPath]));

  return {
    name: manifest?.agentName || manifest?.name || 'unknown-package',
    manifestPath,
    report: auditEmployeePackage({ manifest, files }),
  };
}
