/**
 * Share Redactor — replaces credentials and personal filesystem paths in
 * strings before they leave the user's machine via an exported share bundle.
 *
 * Scope: credential-shaped tokens and home-directory absolute paths. Not a
 * general-purpose DLP — the goal is to stop obvious accidental leaks, not to
 * defend against motivated exfiltration (the user already controls the
 * bundle and could just copy-paste anything).
 *
 * Patterns are intentionally narrow: we prefer under-matching (false
 * negatives) to over-matching (false positives that corrupt the dialogue).
 */

export type RedactionKind =
  | 'anthropic-key'
  | 'openai-key'
  | 'google-api-key'
  | 'aws-access-key'
  | 'github-token'
  | 'slack-token'
  | 'jwt'
  | 'private-key-block'
  | 'bearer-header'
  | 'home-path-posix'
  | 'home-path-windows';

export interface RedactionSample {
  kind: RedactionKind;
  /** First 20 chars of the original match, for the preview dialog. */
  preview: string;
}

export interface RedactionResult {
  text: string;
  count: number;
  samples: RedactionSample[];
}

interface Rule {
  kind: RedactionKind;
  regex: RegExp;
  /** Replacement. May be a literal string or a function of the match. */
  replace: string | ((match: string, ...groups: string[]) => string);
}

// Anthropic key must come before the generic OpenAI rule so it wins.
const RULES: Rule[] = [
  {
    kind: 'anthropic-key',
    regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    replace: '[REDACTED:anthropic-key]',
  },
  {
    kind: 'openai-key',
    // Matches sk-... but excludes sk-ant- (handled above) via negative lookahead.
    regex: /sk-(?!ant-)[A-Za-z0-9_-]{20,}/g,
    replace: '[REDACTED:openai-key]',
  },
  {
    kind: 'google-api-key',
    regex: /AIza[0-9A-Za-z_-]{35}/g,
    replace: '[REDACTED:google-api-key]',
  },
  {
    kind: 'aws-access-key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replace: '[REDACTED:aws-access-key]',
  },
  {
    kind: 'github-token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    replace: '[REDACTED:github-token]',
  },
  {
    kind: 'slack-token',
    regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    replace: '[REDACTED:slack-token]',
  },
  {
    kind: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replace: '[REDACTED:jwt]',
  },
  {
    kind: 'private-key-block',
    regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
    replace: '[REDACTED:private-key-block]',
  },
  {
    kind: 'bearer-header',
    // "Authorization: Bearer <token>" — replace only the token portion.
    regex: /(Authorization:\s*Bearer\s+)([A-Za-z0-9._-]{16,})/gi,
    replace: (_m, prefix: string) => `${prefix}[REDACTED:bearer]`,
  },
  {
    kind: 'home-path-posix',
    // /Users/<name>/ on macOS and /home/<name>/ on Linux.
    regex: /\/(?:Users|home)\/[A-Za-z0-9._-]+(?=\/)/g,
    replace: '~',
  },
  {
    kind: 'home-path-windows',
    // C:\Users\<name>\ — keep the trailing slash so paths continue to parse.
    regex: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?=\\)/g,
    replace: '~',
  },
];

/** Redact a single string. Safe on empty input. */
export function redactText(input: string): RedactionResult {
  if (!input) return { text: input, count: 0, samples: [] };

  let text = input;
  let count = 0;
  const samples: RedactionSample[] = [];

  for (const rule of RULES) {
    // Collect samples before replacing so we preserve the original form.
    const matches = text.match(rule.regex);
    if (matches && matches.length > 0) {
      count += matches.length;
      // Keep the first original match per rule for the preview.
      samples.push({
        kind: rule.kind,
        preview: matches[0].slice(0, 20),
      });
      text = typeof rule.replace === 'string'
        ? text.replace(rule.regex, rule.replace)
        : text.replace(rule.regex, rule.replace);
    }
  }

  return { text, count, samples };
}

/**
 * Recursively redact every string inside a structured value. Used for tool
 * inputs / results whose shape we don't control. Image base64 blobs are
 * skipped by length — we only touch strings shorter than a threshold that
 * could plausibly contain credentials.
 */
const MAX_STRING_LEN_FOR_REDACTION = 100_000;

export function redactDeep(value: unknown): { value: unknown; count: number; samples: RedactionSample[] } {
  let count = 0;
  const samples: RedactionSample[] = [];

  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.length > MAX_STRING_LEN_FOR_REDACTION) return v;
      const r = redactText(v);
      count += r.count;
      samples.push(...r.samples);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(vv);
      }
      return out;
    }
    return v;
  };

  return { value: walk(value), count, samples };
}
