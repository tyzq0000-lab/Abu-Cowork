/**
 * Eval Report Generator
 *
 * Generates CLI summary + JSON report from eval results.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { CaseResult, EvalReport, EvalTarget, CategoryStats, TargetSummary } from './types';

const RESULTS_DIR = join(process.cwd(), 'eval-results');

/**
 * Build aggregated report from raw results.
 */
export function buildReport(
  results: CaseResult[],
  dataset: string,
  targets: EvalTarget[],
): EvalReport {
  const byTarget: Record<string, TargetSummary> = {};
  const byCategory: Record<string, Record<string, CategoryStats>> = {};
  const byDifficulty: Record<string, Record<string, CategoryStats>> = {};

  for (const target of targets) {
    const targetResults = results.filter(r => r.target.label === target.label);
    const passCount = targetResults.filter(r => r.passed).length;
    const failCount = targetResults.length - passCount;

    byTarget[target.label] = {
      passRate: targetResults.length > 0 ? passCount / targetResults.length : 0,
      passCount,
      failCount,
      avgLatencyMs: targetResults.length > 0
        ? targetResults.reduce((sum, r) => sum + r.latencyMs, 0) / targetResults.length
        : 0,
      totalTokens: {
        input: targetResults.reduce((sum, r) => sum + r.tokenUsage.input, 0),
        output: targetResults.reduce((sum, r) => sum + r.tokenUsage.output, 0),
      },
    };
  }

  // Category/difficulty grouping is done by enrichReportWithCaseData() after construction

  return {
    metadata: {
      timestamp: new Date().toISOString(),
      targets,
      dataset,
      totalCases: results.length,
    },
    summary: { byTarget, byCategory, byDifficulty },
    results,
  };
}

/**
 * Build category/difficulty stats from results + original cases.
 */
export function enrichReportWithCaseData(
  report: EvalReport,
  cases: Array<{ id: string; category: string; difficulty: string }>,
): void {
  const caseMap = new Map(cases.map(c => [c.id, c]));

  for (const target of report.metadata.targets) {
    const targetResults = report.results.filter(r => r.target.label === target.label);

    // By category
    if (!report.summary.byCategory[target.label]) {
      report.summary.byCategory[target.label] = {};
    }
    if (!report.summary.byDifficulty[target.label]) {
      report.summary.byDifficulty[target.label] = {};
    }

    for (const result of targetResults) {
      const caseInfo = caseMap.get(result.caseId);
      if (!caseInfo) continue;

      // Category
      const catStats = report.summary.byCategory[target.label];
      if (!catStats[caseInfo.category]) catStats[caseInfo.category] = { pass: 0, total: 0 };
      catStats[caseInfo.category].total++;
      if (result.passed) catStats[caseInfo.category].pass++;

      // Difficulty
      const diffStats = report.summary.byDifficulty[target.label];
      if (!diffStats[caseInfo.difficulty]) diffStats[caseInfo.difficulty] = { pass: 0, total: 0 };
      diffStats[caseInfo.difficulty].total++;
      if (result.passed) diffStats[caseInfo.difficulty].pass++;
    }
  }
}

/**
 * Save report as JSON.
 */
export function saveReport(report: EvalReport): string {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const date = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const targetNames = report.metadata.targets.map(t => t.label.replace(/\s+/g, '-')).join('_vs_');
  const filename = `${date}_${report.metadata.dataset}_${targetNames}.json`;
  const filepath = join(RESULTS_DIR, filename);

  writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');
  return filepath;
}

/**
 * Print CLI report.
 */
export function printReport(report: EvalReport): void {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  Abu Agent Eval Report`);
  console.log(`  Dataset: ${report.metadata.dataset} (${report.metadata.totalCases} cases)`);
  console.log(`  Time: ${report.metadata.timestamp}`);
  console.log(line);

  for (const target of report.metadata.targets) {
    const summary = report.summary.byTarget[target.label];
    if (!summary) continue;

    const pct = (summary.passRate * 100).toFixed(1);
    console.log(`\n  📊 ${target.label}`);
    console.log(`     Pass Rate: ${summary.passCount}/${summary.passCount + summary.failCount} (${pct}%)`);
    console.log(`     Avg Latency: ${summary.avgLatencyMs.toFixed(0)}ms`);
    console.log(`     Tokens: ${summary.totalTokens.input} in / ${summary.totalTokens.output} out`);

    // Category breakdown
    const catStats = report.summary.byCategory[target.label];
    if (catStats && Object.keys(catStats).length > 0) {
      console.log(`\n     By Category:`);
      for (const [cat, stats] of Object.entries(catStats)) {
        const catPct = stats.total > 0 ? ((stats.pass / stats.total) * 100).toFixed(0) : '0';
        const bar = '█'.repeat(Math.round(stats.pass / Math.max(stats.total, 1) * 10));
        console.log(`       ${cat.padEnd(12)} ${stats.pass}/${stats.total} (${catPct.padStart(3)}%) ${bar}`);
      }
    }

    // Difficulty breakdown
    const diffStats = report.summary.byDifficulty[target.label];
    if (diffStats && Object.keys(diffStats).length > 0) {
      console.log(`\n     By Difficulty:`);
      for (const diff of ['easy', 'medium', 'hard']) {
        const stats = diffStats[diff];
        if (!stats) continue;
        const diffPct = stats.total > 0 ? ((stats.pass / stats.total) * 100).toFixed(0) : '0';
        console.log(`       ${diff.padEnd(12)} ${stats.pass}/${stats.total} (${diffPct.padStart(3)}%)`);
      }
    }
  }

  // Failed cases
  const failures = report.results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`\n  ❌ Failed Cases:`);
    for (const f of failures) {
      const reasons = [
        ...f.details.missingTools.map(t => `missing: ${t}`),
        ...f.details.forbiddenToolsCalled.map(t => `forbidden: ${t}`),
        ...f.details.paramMismatches,
      ];
      console.log(`     ${f.caseId} [${f.target.label}]`);
      console.log(`       tools called: [${f.toolsCalled.join(', ')}]`);
      for (const reason of reasons) {
        console.log(`       → ${reason}`);
      }
      if (f.error) {
        console.log(`       → error: ${f.error}`);
      }
    }
  }

  console.log(`\n${line}\n`);
}

/**
 * Diff two reports.
 */
export function diffReports(before: EvalReport, after: EvalReport): void {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  A/B Comparison`);
  console.log(`  Before: ${before.metadata.timestamp}`);
  console.log(`  After:  ${after.metadata.timestamp}`);
  console.log(line);

  // Match results by caseId
  const beforeMap = new Map(before.results.map(r => [`${r.caseId}:${r.target.label}`, r]));
  const afterMap = new Map(after.results.map(r => [`${r.caseId}:${r.target.label}`, r]));

  const improved: string[] = [];
  const regressed: string[] = [];
  const unchanged = { pass: 0, fail: 0 };

  for (const [key, afterResult] of afterMap) {
    const beforeResult = beforeMap.get(key);
    if (!beforeResult) continue;

    if (!beforeResult.passed && afterResult.passed) {
      improved.push(afterResult.caseId);
    } else if (beforeResult.passed && !afterResult.passed) {
      regressed.push(afterResult.caseId);
    } else if (afterResult.passed) {
      unchanged.pass++;
    } else {
      unchanged.fail++;
    }
  }

  // Pass rate comparison per target
  for (const target of after.metadata.targets) {
    const beforeSummary = before.summary.byTarget[target.label];
    const afterSummary = after.summary.byTarget[target.label];
    if (!beforeSummary || !afterSummary) continue;

    const beforePct = (beforeSummary.passRate * 100).toFixed(1);
    const afterPct = (afterSummary.passRate * 100).toFixed(1);
    const delta = (afterSummary.passRate - beforeSummary.passRate) * 100;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    console.log(`\n  ${target.label}: ${beforePct}% → ${afterPct}% (${delta > 0 ? '+' : ''}${delta.toFixed(1)}%) ${arrow}`);
  }

  if (improved.length > 0) {
    console.log(`\n  ✅ Improved (${improved.length}):`);
    for (const id of improved) console.log(`     ${id}: fail → pass`);
  }

  if (regressed.length > 0) {
    console.log(`\n  ❌ Regressed (${regressed.length}):`);
    for (const id of regressed) console.log(`     ${id}: pass → fail`);
  }

  console.log(`\n  Unchanged: ${unchanged.pass} pass, ${unchanged.fail} fail`);
  console.log(`\n${line}\n`);
}

/**
 * Load a report from eval-results/ by partial filename match.
 */
export function loadReport(nameHint: string): EvalReport | null {
  if (!existsSync(RESULTS_DIR)) return null;

  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && f.includes(nameHint));
  if (files.length === 0) return null;

  // Take the most recent
  files.sort().reverse();
  const content = readFileSync(join(RESULTS_DIR, files[0]), 'utf-8');
  return JSON.parse(content);
}
