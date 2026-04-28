/**
 * Pattern-based secret redaction.
 *
 * The default set covers common API key shapes that show up by accident in
 * ChatGPT conversations (the user pastes a snippet, asks for help). It is
 * not exhaustive — callers should add project-specific patterns when the
 * generic shapes don't catch everything.
 */

const REDACTED_MARKER = '<redacted>';

export const DEFAULT_REDACTION_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic-style keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /gh[pousr]_[A-Za-z0-9]{36,}/g, // GitHub personal/oauth/refresh tokens
  /AKIA[0-9A-Z]{16}/g, // AWS access key ID
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT (header.payload.signature)
];

export interface RedactOptions {
  /** Extra patterns merged with the defaults. Default: []. */
  extra?: RegExp[];
  /** When true, ignore the defaults and only use `extra`. Default: false. */
  replaceDefaults?: boolean;
}

export function redact(content: string, options: RedactOptions = {}): string {
  const patterns = options.replaceDefaults
    ? (options.extra ?? [])
    : [...DEFAULT_REDACTION_PATTERNS, ...(options.extra ?? [])];

  let result = content;
  for (const pattern of patterns) {
    result = result.replace(ensureGlobal(pattern), REDACTED_MARKER);
  }
  return result;
}

function ensureGlobal(pattern: RegExp): RegExp {
  return pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}
