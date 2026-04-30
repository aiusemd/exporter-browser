import type { ProviderName } from '../../types.js';

const LAST_PROVIDER_KEY = 'aiuse:lastProvider';

const VALID_PROVIDERS: readonly ProviderName[] = ['chatgpt', 'claude'];

function isProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && (VALID_PROVIDERS as readonly string[]).includes(value);
}

export async function getLastProvider(): Promise<ProviderName | null> {
  const result = await chrome.storage.local.get(LAST_PROVIDER_KEY);
  const value = result[LAST_PROVIDER_KEY];
  return isProviderName(value) ? value : null;
}

export async function setLastProvider(provider: ProviderName): Promise<void> {
  await chrome.storage.local.set({ [LAST_PROVIDER_KEY]: provider });
}
