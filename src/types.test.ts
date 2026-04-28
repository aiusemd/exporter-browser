import { describe, expect, it } from 'vitest';
import type { NormalizedConversation, NormalizedMessage } from './types.js';

describe('types', () => {
  it('NormalizedConversation accepts a minimal valid shape', () => {
    const msg: NormalizedMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    };
    const conv: NormalizedConversation = {
      id: 'abc',
      title: 'Greeting',
      createdAt: new Date('2026-04-28T00:00:00Z'),
      messages: [msg],
    };
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]?.role).toBe('user');
  });
});
