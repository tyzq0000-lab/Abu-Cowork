import type {
  EmployeeArchiveAuditResult,
} from './archiveAudit';
import type { EmployeeGapOwner } from './contract';

const OWNER_LABELS: Record<EmployeeGapOwner, string> = {
  'employee-package': '员工包缺失',
  'fuyao-runtime': '扶摇基座缺失',
  'runtime-config': '运行配置缺失',
  'external-service': '外部服务限制',
};

export function renderEmployeeAuditMarkdown(result: EmployeeArchiveAuditResult): string {
  const lines = [
    `# 数字员工包审计：${result.name}`,
    '',
    `- 成熟度：**${result.report.level}**`,
    `- 目标成熟度：**${result.report.targetLevel}**`,
    `- 基础分：**${result.report.score}/100**`,
    '',
    '## 差距与责任归属',
  ];

  for (const owner of Object.keys(OWNER_LABELS) as EmployeeGapOwner[]) {
    const ownerGaps = result.report.gaps.filter((gap) => gap.owner === owner);
    lines.push('', `### ${OWNER_LABELS[owner]}`);
    if (ownerGaps.length === 0) {
      lines.push('- 无');
      continue;
    }
    for (const gap of ownerGaps) {
      lines.push(`- ${gap.blocking ? '[阻塞]' : '[配置/提示]'} \`${gap.code}\`：${gap.message}`);
    }
  }

  lines.push('', '## 开源能力账本');
  if (result.report.capabilityLedger.length === 0) {
    lines.push('- 未提供能力抽取与裁剪账本。');
  } else {
    for (const item of result.report.capabilityLedger) {
      lines.push(
        '',
        `### ${item.source}`,
        `- 来源：${item.origin}`,
        `- 许可证：${item.license}`,
        `- 集成方式：${item.integration}`,
        `- 已采用：${item.adopted.join('；') || '无'}`,
        `- 未采用：${item.excluded.join('；') || '无'}`,
        `- 未采用原因：${item.exclusionReasons.join('；') || '无'}`,
        `- 恢复成本：${item.recoveryCost}`,
      );
    }
  }

  return lines.join('\n') + '\n';
}
