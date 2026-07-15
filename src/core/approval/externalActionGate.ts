import { TOOL_NAMES } from '../tools/toolNames';

export type ExternalActionKind = 'publish' | 'send' | 'payment';

export interface ExternalActionApproval {
  kind: ExternalActionKind;
  detail: string;
  toolName: string;
  reviewPayload?: string;
}

const READ_ONLY_MCP_PREFIXES = [
  'get_',
  'list_',
  'read_',
  'search_',
  'find_',
  'query_',
  'fetch_',
  'retrieve_',
  'lookup_',
  'inspect_',
  'describe_',
  'view_',
  'check_',
  'status_',
  'snapshot',
  'screenshot',
  'take_screenshot',
  'wait',
  'hover',
  'scroll',
  'navigate',
  'tab_',
  'tabs',
  'calculate',
  'convert',
  'parse',
  'format',
  'validate',
  'preview',
  'analyze',
  'summarize',
];

const PAYMENT_PATTERN = /(?:^|_)(?:pay|payment|charge|checkout|purchase|buy|transfer|payout|withdraw|refund|subscribe|donate)(?:_|$)|支付|付款|转账|退款|购买|下单|充值/i;
const PUBLISH_PATTERN = /(?:^|_)(?:publish|post|tweet|release|deploy|push|upload|share|comment|reply|merge)(?:_|$)|发布|发表|上线|推送|上传|评论|回复/i;
const SEND_PATTERN = /(?:^|_)(?:send|email|mail|message|notify|invite|submit|dispatch|forward|schedule|book)(?:_|$)|发送|发信|邮件|消息|通知|邀请|提交/i;
const MUTATING_MCP_PATTERN = /(?:^|_)(?:create|update|delete|remove|archive|write|edit|set|add|send|publish|post|tweet|charge|pay|transfer|refund|submit|invite|notify|upload|deploy|push|merge|execute|run|start|stop|approve|reject|cancel|book|schedule)(?:_|$)/i;

function normalizeName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}

function leafToolName(toolName: string): string {
  const parts = toolName.split('__');
  return normalizeName(parts[parts.length - 1] || toolName);
}

function classifyWords(value: string): ExternalActionKind | null {
  const normalized = normalizeName(value);
  if (PAYMENT_PATTERN.test(normalized)) return 'payment';
  if (PUBLISH_PATTERN.test(normalized)) return 'publish';
  if (SEND_PATTERN.test(normalized)) return 'send';
  return null;
}

function stringifyForClassification(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return '';
  }
}

function attachReviewPayload(
  approval: ExternalActionApproval | null,
  input: Record<string, unknown>,
): ExternalActionApproval | null {
  if (!approval) return null;
  const payload = approval.toolName === TOOL_NAMES.RUN_COMMAND && typeof input.command === 'string'
    ? input.command
    : stringifyForClassification(input);
  return payload
    ? { ...approval, reviewPayload: payload.slice(0, 8_000) }
    : approval;
}

function safeUrlDetail(method: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return method;
  try {
    const url = new URL(value);
    return `${method} ${url.origin}${url.pathname}`;
  } catch {
    return `${method} ${value.slice(0, 240)}`;
  }
}

function classifyHttp(input: Record<string, unknown>, toolName: string): ExternalActionApproval | null {
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null;
  if (typeof input.url !== 'string' || input.url.length === 0) return null;

  const kind = classifyWords(`${input.url} ${typeof input.body === 'string' ? input.body : ''}`) ?? 'send';
  return { kind, detail: safeUrlDetail(method, input.url), toolName };
}

function classifyCommand(input: Record<string, unknown>, toolName: string): ExternalActionApproval | null {
  if (typeof input.command !== 'string' || input.command.trim().length === 0) return null;
  const command = input.command.trim();

  const remoteWrite = /\bcurl\b[\s\S]*(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b|\bcurl\b[\s\S]*(?:-d|--data(?:-raw|-binary|-urlencode)?|--json|-F|--form|-T|--upload-file)\b|\bwget\b[\s\S]*--post-(?:data|file)\b|\bInvoke-(?:RestMethod|WebRequest)\b[\s\S]*(?:-Method\s+(?:POST|PUT|PATCH|DELETE)\b|-Body\b)/i;
  const payment = /\b(?:stripe|paypal)\b[\s\S]*\b(?:create|confirm|capture|pay|refund|transfer)\b|\b(?:pay|payment|charge|checkout|purchase|transfer|payout|refund)\b[\s\S]*\b(?:create|confirm|execute|send|submit)\b/i;
  const publish = /\bgit\s+push\b|\b(?:npm|pnpm|yarn|cargo)\s+publish\b|\b(?:docker|podman)\s+push\b|\btwine\s+upload\b|\bgh\s+(?:release|pr|issue)\s+(?:create|merge)\b|\b(?:vercel|netlify|firebase)\b[\s\S]*\b(?:deploy|--prod)\b/i;
  const send = /\b(?:sendmail|msmtp|mailx?)\b|\b(?:slack|discord|teams)\b[\s\S]*\b(?:send|post|message)\b/i;

  let kind: ExternalActionKind | null = null;
  if (payment.test(command)) kind = 'payment';
  else if (publish.test(command)) kind = 'publish';
  else if (send.test(command) || remoteWrite.test(command)) kind = classifyWords(command) ?? 'send';

  return kind ? { kind, detail: command, toolName } : null;
}

function browserTarget(input: Record<string, unknown>): string {
  const target = input.locator ?? input.selector ?? input.ref ?? input.element_id;
  if (target === undefined || target === null) return '';
  const text = typeof target === 'string' ? target : stringifyForClassification({ target });
  return text ? `: ${text.slice(0, 240)}` : '';
}

function classifyBrowser(toolName: string, input: Record<string, unknown>): ExternalActionApproval | null {
  const leaf = leafToolName(toolName).replace(/^browser_/, '');
  const inputText = stringifyForClassification(input);

  if (leaf.includes('file_upload')) {
    return { kind: 'publish', detail: `${toolName}${browserTarget(input)}`, toolName };
  }
  if (leaf.includes('run_code') || leaf.includes('execute_js') || leaf.includes('handle_dialog') || leaf.includes('drag')) {
    return { kind: classifyWords(inputText) ?? 'send', detail: `${toolName}${browserTarget(input)}`, toolName };
  }
  if (leaf === 'click' || leaf.endsWith('_click')) {
    return { kind: classifyWords(inputText) ?? 'send', detail: `${toolName}${browserTarget(input)}`, toolName };
  }
  if (leaf.includes('press_key') || leaf === 'keyboard' || leaf === 'key') {
    const key = String(input.key ?? input.keys ?? input.text ?? '').toLowerCase();
    if (key === 'enter' || key === 'return') {
      return { kind: classifyWords(inputText) ?? 'send', detail: `${toolName}: ${key}`, toolName };
    }
  }
  return null;
}

function classifyComputer(input: Record<string, unknown>, toolName: string): ExternalActionApproval | null {
  const action = String(input.action ?? '').toLowerCase();
  const inputText = stringifyForClassification(input);
  const commits = action === 'click' || action === 'ax_click' || action === 'perform_action';
  const submits = action === 'key' && ['enter', 'return'].includes(String(input.key ?? '').toLowerCase());
  if (!commits && !submits) return null;

  const target = input.element_id != null
    ? ` element #${String(input.element_id)}`
    : input.x != null && input.y != null
      ? ` at (${String(input.x)}, ${String(input.y)})`
      : '';
  return {
    kind: classifyWords(inputText) ?? 'send',
    detail: `computer: ${action}${target}`,
    toolName,
  };
}

function isBrowserTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized.startsWith('abu-browser-bridge__')
    || normalized.startsWith('playwright__browser_')
    || normalized.includes('browser_bridge__');
}

/**
 * Classifies calls that can create externally visible side effects. Unknown MCP
 * mutations fail closed; obvious read-only MCP calls remain unattended.
 */
export function classifyExternalAction(
  toolName: string,
  input: Record<string, unknown>,
): ExternalActionApproval | null {
  if (toolName === TOOL_NAMES.HTTP_FETCH) return attachReviewPayload(classifyHttp(input, toolName), input);
  if (toolName === TOOL_NAMES.RUN_COMMAND) return attachReviewPayload(classifyCommand(input, toolName), input);
  if (toolName === TOOL_NAMES.COMPUTER) return attachReviewPayload(classifyComputer(input, toolName), input);
  if (isBrowserTool(toolName)) return attachReviewPayload(classifyBrowser(toolName, input), input);

  if (!toolName.includes('__')) return null;

  const leaf = leafToolName(toolName);
  const hasReadOnlyPrefix = READ_ONLY_MCP_PREFIXES.some((prefix) => leaf === prefix || leaf.startsWith(prefix));
  if (hasReadOnlyPrefix && !MUTATING_MCP_PATTERN.test(leaf)) {
    return null;
  }

  return attachReviewPayload({
    kind: classifyWords(leaf) ?? 'send',
    detail: toolName,
    toolName,
  }, input);
}
