import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { auditEmployeeArchiveEntries } from '../src/core/employee/archiveAudit';
import { renderEmployeeAuditMarkdown } from '../src/core/employee/report';

function readDirectoryEntries(root: string): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  const visit = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        visit(fullPath);
      } else if (item.isFile()) {
        entries[relative(root, fullPath).replace(/\\/g, '/')] = readFileSync(fullPath);
      }
    }
  };
  visit(root);
  return entries;
}

function findInputs(input: string): string[] {
  if (!statSync(input).isDirectory()) return [input];
  const found = new Set<string>();
  const visit = (dir: string) => {
    if (existsSync(join(dir, '.codebuddy-plugin', 'plugin.json'))) {
      found.add(dir);
      return;
    }
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) visit(fullPath);
      if (item.isFile() && item.name.toLowerCase().endsWith('.zip')) found.add(fullPath);
    }
  };
  visit(input);
  return [...found].sort();
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const pathArg = args.find((arg) => arg !== '--json');
if (!pathArg) {
  console.error('Usage: npm run audit:employees -- <directory-or-zip> [--json]');
  process.exitCode = 1;
} else {
  const input = resolve(pathArg);
  if (!existsSync(input)) {
    console.error(`Path not found: ${input}`);
    process.exitCode = 1;
  } else {
    const results = findInputs(input).map((item) => {
      const entries = statSync(item).isDirectory()
        ? readDirectoryEntries(item)
        : unzipSync(readFileSync(item));
      return {
        source: item,
        audit: auditEmployeeArchiveEntries(entries),
      };
    });

    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      console.log(`No employee packages found under ${input}`);
    } else {
      for (const [index, item] of results.entries()) {
        if (index > 0) console.log('\n---\n');
        console.log(`来源：${basename(item.source)}\n`);
        console.log(renderEmployeeAuditMarkdown(item.audit));
      }
    }
  }
}
