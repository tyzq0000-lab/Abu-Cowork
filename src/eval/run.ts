#!/usr/bin/env tsx
/**
 * Abu Agent Eval — CLI Entry Point
 *
 * Usage:
 *   tsx src/eval/run.ts tool-selection --provider anthropic --model claude-sonnet-4-20250514
 *   tsx src/eval/run.ts tool-selection --category file-ops
 *   tsx src/eval/run.ts tool-selection --filter file-read-01,file-write-01
 *   tsx src/eval/run.ts report --diff <hint1> <hint2>
 */

// Must be first — shims Tauri APIs for Node.js environment
import './shimTauri';

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolSelectionCase } from './types';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    provider:  { type: 'string', default: 'anthropic' },
    model:     { type: 'string', default: 'claude-sonnet-4-20250514' },
    'api-key': { type: 'string' },
    'base-url': { type: 'string' },
    filter:    { type: 'string' },
    category:  { type: 'string' },
    thinking:  { type: 'boolean', default: false },
    diff:      { type: 'string', multiple: true },
    label:     { type: 'string' },
  },
});

const command = positionals[0];

async function main() {
  if (!command) {
    console.log(`
Abu Agent Eval Framework

Commands:
  tool-selection    Run L2 tool selection eval
  report            Show or diff eval reports

Options:
  --provider <id>   Provider ID (default: anthropic)
  --model <id>      Model ID (default: claude-sonnet-4-20250514)
  --api-key <key>   API key (or set ANTHROPIC_API_KEY / OPENAI_API_KEY env var)
  --base-url <url>  API base URL override
  --filter <ids>    Comma-separated case IDs to run
  --category <cat>  Only run cases in this category
  --thinking        Enable extended thinking
  --label <name>    Custom label for this target
  --diff <a> <b>    Diff two reports by filename hint

Examples:
  tsx src/eval/run.ts tool-selection
  tsx src/eval/run.ts tool-selection --provider deepseek --model deepseek-chat --api-key sk-xxx
  tsx src/eval/run.ts tool-selection --category file-ops
  tsx src/eval/run.ts report --diff 2026-04-06 2026-04-07
    `);
    process.exit(0);
  }

  if (command === 'tool-selection') {
    await runToolSelection();
  } else if (command === 'report') {
    await runReport();
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

async function runToolSelection() {
  const { runToolSelectionEval } = await import('./toolSelectionRunner');
  const { buildReport, enrichReportWithCaseData, saveReport, printReport } = await import('./report');

  // Load dataset
  const datasetPath = join(process.cwd(), 'src/eval/datasets/tool-selection.json');
  const cases: ToolSelectionCase[] = JSON.parse(readFileSync(datasetPath, 'utf-8'));

  // Resolve API key
  const apiKey = values['api-key']
    ?? process.env.ANTHROPIC_API_KEY
    ?? process.env.OPENAI_API_KEY
    ?? '';

  if (!apiKey) {
    console.error('Error: No API key provided. Use --api-key or set ANTHROPIC_API_KEY env var.');
    process.exit(1);
  }

  const providerId = values.provider ?? 'anthropic';
  const modelId = values.model ?? 'claude-sonnet-4-20250514';
  const target = {
    providerId,
    modelId,
    label: values.label ?? `${providerId}:${modelId}`,
  };

  console.log(`\n🔍 Running tool selection eval`);
  console.log(`   Target: ${target.label}`);
  console.log(`   Cases: ${cases.length}`);
  console.log(`   Thinking: ${values.thinking ? 'on' : 'off'}\n`);

  const results = await runToolSelectionEval(cases, target, {
    apiKey,
    baseUrl: values['base-url'],
    temperature: 0,
    enableThinking: values.thinking,
    filter: values.filter?.split(','),
    category: values.category,
  });

  // Build and print report
  const report = buildReport(results, 'tool-selection', [target]);
  enrichReportWithCaseData(report, cases);
  printReport(report);

  // Save
  const filepath = saveReport(report);
  console.log(`📄 Report saved: ${filepath}\n`);
}

async function runReport() {
  const { loadReport, diffReports, printReport } = await import('./report');

  const diffHints = values.diff;
  if (diffHints && diffHints.length >= 2) {
    const before = loadReport(diffHints[0]);
    const after = loadReport(diffHints[1]);

    if (!before) {
      console.error(`Cannot find report matching "${diffHints[0]}"`);
      process.exit(1);
    }
    if (!after) {
      console.error(`Cannot find report matching "${diffHints[1]}"`);
      process.exit(1);
    }

    diffReports(before, after);
  } else {
    // Show latest report
    const latest = loadReport('');
    if (latest) {
      printReport(latest);
    } else {
      console.log('No eval reports found. Run an eval first.');
    }
  }
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
