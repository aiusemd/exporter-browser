const DEFAULT_LIMIT = 4000;
const TRUNCATED_MARKER = '<truncated>';
const FENCE_LINE = /^`{3,}/;

export function truncate(content: string, limit: number = DEFAULT_LIMIT): string {
  if (content.length <= limit) return content;

  const lines = content.split('\n');
  let cumulativeChars = 0;
  let inFence = false;
  let openingFenceLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineEnd = cumulativeChars + line.length;

    if (limit <= lineEnd) {
      const cutPos = inFence ? lineStartOffset(lines, openingFenceLineIndex) : limit;
      const cut = content.slice(0, cutPos).replace(/\s+$/, '');
      return `${cut}${TRUNCATED_MARKER}`;
    }

    if (FENCE_LINE.test(line)) {
      if (inFence) {
        inFence = false;
        openingFenceLineIndex = -1;
      } else {
        inFence = true;
        openingFenceLineIndex = i;
      }
    }

    cumulativeChars = lineEnd + 1; // +1 accounts for the '\n' separator
  }

  return content;
}

function lineStartOffset(lines: string[], lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset;
}
