import { CenteredHeroPage } from '../components/CenteredHeroPage.js';

export function EmptyConversationsPage() {
  return (
    <CenteredHeroPage>
      <h1 class="text-base font-semibold text-gh-fg-default">No conversations yet</h1>
      <p class="text-sm text-gh-fg-muted">Start a chat at chatgpt.com to see it here.</p>
    </CenteredHeroPage>
  );
}
