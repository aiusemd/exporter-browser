import slugify from '@sindresorhus/slugify';

const TOPIC_MAX = 40;
const RAND_LENGTH = 4;
const RAND_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const FALLBACK_TOPIC = 'untitled';

export interface AttachmentNameParts {
  stem: string;
  ext: string;
}

export function formatDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthFolder(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function slugifyTopic(title: string): string {
  if (!title) return FALLBACK_TOPIC;
  const slug = slugify(title)
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return FALLBACK_TOPIC;
  const truncated = slug.slice(0, TOPIC_MAX).replace(/-+$/, '');
  return truncated || FALLBACK_TOPIC;
}

export function slugifyAttachmentName(name: string): AttachmentNameParts {
  if (!name) return { stem: FALLBACK_TOPIC, ext: '' };
  const lastDot = name.lastIndexOf('.');
  const hasExt = lastDot > 0 && lastDot < name.length - 1;
  const rawStem = hasExt ? name.slice(0, lastDot) : name;
  const rawExt = hasExt ? name.slice(lastDot + 1) : '';
  return {
    stem: slugifyTopic(rawStem),
    ext: rawExt.toLowerCase().replace(/[^a-z0-9]/g, ''),
  };
}

export function randomSuffix(): string {
  const bytes = new Uint8Array(RAND_LENGTH);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < RAND_LENGTH; i++) {
    const byte = bytes[i] ?? 0;
    result += RAND_ALPHABET[byte % RAND_ALPHABET.length];
  }
  return result;
}

export function makeConversationFilename(date: Date, title: string, rand: string): string {
  return `${formatDate(date)}--${slugifyTopic(title)}--${rand}.md`;
}

export function makeAttachmentFilename(
  date: Date,
  title: string,
  rand: string,
  attachmentName: string,
): string {
  const { stem, ext } = slugifyAttachmentName(attachmentName);
  const base = `${formatDate(date)}--${slugifyTopic(title)}--${rand}--${stem}`;
  return ext ? `${base}.${ext}` : base;
}
