/**
 * Backtick fence escalation.
 *
 * The AIUSE spec wraps structured/code content in fenced blocks. When the
 * content itself contains backtick runs, the wrapping fence must be longer
 * than the longest interior run — otherwise the inner backticks close the
 * outer fence and the document becomes invalid markdown.
 */

const BACKTICK_RUN = /`+/g;

export function pickFence(content: string): string {
  let longest = 0;
  for (const match of content.matchAll(BACKTICK_RUN)) {
    if (match[0].length > longest) {
      longest = match[0].length;
    }
  }
  const length = Math.max(3, longest + 1);
  return '`'.repeat(length);
}

export function wrap(content: string, lang?: string): string {
  const fence = pickFence(content);
  const body = content.replace(/\n+$/, '');
  const opener = lang ? `${fence}${lang}` : fence;
  return `${opener}\n${body}\n${fence}`;
}
