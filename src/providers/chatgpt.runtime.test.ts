import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTProvider } from './chatgpt.js';

const FIXTURES_DIR = join(__dirname, '../../test/fixtures');

function loadFixtureText(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

interface SessionBody {
  accessToken?: string;
  expires?: string;
  user?: { name?: string; email?: string };
}

function sessionBody(overrides: Partial<SessionBody> = {}): SessionBody {
  return {
    accessToken: 'tok-abc',
    expires: '2030-01-01T00:00:00.000Z',
    user: { name: 'Sam', email: 'sam@example.com' },
    ...overrides,
  };
}

function listPage(items: { id: string; title: string }[], total: number, offset: number) {
  return {
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      create_time: 1700000000,
      update_time: 1700000100,
    })),
    total,
    limit: 100,
    offset,
  };
}

function makeItems(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${start + i}`,
    title: `Conv ${start + i}`,
  }));
}

function spyOnFetch() {
  return vi.spyOn(globalThis, 'fetch');
}

describe('ChatGPTProvider.getSession', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns authenticated info for a populated response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(sessionBody()));
    const provider = new ChatGPTProvider();
    const info = await provider.getSession();
    expect(info.authenticated).toBe(true);
    expect(info.user).toEqual({ name: 'Sam', email: 'sam@example.com' });
    expect(info.expiresAt?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://chatgpt.com/api/auth/session',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns unauthenticated for an empty body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));
    const info = await new ChatGPTProvider().getSession();
    expect(info).toEqual({ authenticated: false });
  });

  it('returns unauthenticated for a null body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
    const info = await new ChatGPTProvider().getSession();
    expect(info).toEqual({ authenticated: false });
  });

  it('returns unauthenticated when accessToken is missing', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ user: { name: 'x' } }));
    const info = await new ChatGPTProvider().getSession();
    expect(info).toEqual({ authenticated: false });
  });

  it('returns unauthenticated on 401', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 401 }));
    const info = await new ChatGPTProvider().getSession();
    expect(info).toEqual({ authenticated: false });
  });
});

describe('ChatGPTProvider.listConversations', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('paginates across pages and yields items in order', async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(jsonResponse(listPage(makeItems(0, 100), 150, 0)))
      .mockResolvedValueOnce(jsonResponse(listPage(makeItems(100, 50), 150, 100)));

    const provider = new ChatGPTProvider();
    const collected: string[] = [];
    const iter = (async () => {
      for await (const summary of provider.listConversations()) {
        collected.push(summary.id);
      }
    })();

    // Advance past the 250ms throttle between pages.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    await iter;

    expect(collected).toHaveLength(150);
    expect(collected[0]).toBe('c-0');
    expect(collected[99]).toBe('c-99');
    expect(collected[100]).toBe('c-100');
    expect(collected[149]).toBe('c-149');

    const calls = fetchSpy.mock.calls;
    expect(calls[1]?.[0]).toBe(
      'https://chatgpt.com/backend-api/conversations?offset=0&limit=100&order=updated',
    );
    expect(calls[2]?.[0]).toBe(
      'https://chatgpt.com/backend-api/conversations?offset=100&limit=100&order=updated',
    );
    const init = calls[1]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok-abc');
  });

  it('respects opts.limit and stops paginating once reached', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(jsonResponse(listPage(makeItems(0, 100), 500, 0)));

    const provider = new ChatGPTProvider();
    const collected: string[] = [];
    for await (const s of provider.listConversations({ limit: 5 })) {
      collected.push(s.id);
    }

    expect(collected).toEqual(['c-0', 'c-1', 'c-2', 'c-3', 'c-4']);
    // Session + first page only — no second page fetched.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('respects opts.signal and stops mid-iteration', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(jsonResponse(listPage(makeItems(0, 100), 500, 0)));

    const controller = new AbortController();
    const provider = new ChatGPTProvider();
    const collected: string[] = [];
    for await (const s of provider.listConversations({ signal: controller.signal })) {
      collected.push(s.id);
      if (collected.length === 3) controller.abort();
    }

    expect(collected).toHaveLength(3);
    // No second page fetched — only session + first page.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back updatedAt to createdAt when update_time is null or omitted', async () => {
    const page = {
      items: [
        {
          id: 'c-null-update',
          title: 'Null update_time',
          create_time: 1700000000,
          update_time: null,
        },
        {
          id: 'c-omitted-update',
          title: 'Missing update_time field',
          create_time: 1700000000,
          // update_time omitted entirely
        },
      ],
      total: 2,
      limit: 100,
      offset: 0,
    };
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(jsonResponse(page));

    const provider = new ChatGPTProvider();
    const collected = [];
    for await (const s of provider.listConversations()) collected.push(s);

    expect(collected).toHaveLength(2);
    for (const summary of collected) {
      expect(Number.isNaN(summary.updatedAt.getTime())).toBe(false);
      expect(summary.updatedAt.getTime()).toBe(summary.createdAt.getTime());
    }
  });

  it('propagates AbortError from fetch without retrying when signal aborts mid-request', async () => {
    const controller = new AbortController();
    fetchSpy.mockResolvedValueOnce(jsonResponse(sessionBody())).mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('The operation was aborted', 'AbortError');
    });

    const provider = new ChatGPTProvider();
    let caught: unknown;
    try {
      for await (const _ of provider.listConversations({ signal: controller.signal })) {
        // unreachable
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DOMException);
    // Session + the single aborted attempt — no exponential-backoff retries.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ChatGPTProvider.getConversation', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('fetches /backend-api/conversation/<id> and pipes through normalize', async () => {
    const fixture = loadFixtureText('chatgpt-simple.json');
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }));

    const provider = new ChatGPTProvider();
    const conv = await provider.getConversation('abc');

    expect(conv.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(conv.title).toBe('Greeting');
    expect(conv.messages).toHaveLength(2);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      'https://chatgpt.com/backend-api/conversation/abc',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('encodes special characters in the conversation id', async () => {
    const fixture = loadFixtureText('chatgpt-simple.json');
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }));

    await new ChatGPTProvider().getConversation('a/b c');
    expect(fetchSpy).toHaveBeenLastCalledWith(
      'https://chatgpt.com/backend-api/conversation/a%2Fb%20c',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('retries once on 401 after refetching the session', async () => {
    const fixture = loadFixtureText('chatgpt-simple.json');
    fetchSpy
      // initial getSession
      .mockResolvedValueOnce(jsonResponse(sessionBody({ accessToken: 'old-tok' })))
      // first authed call → 401
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      // refetched session
      .mockResolvedValueOnce(jsonResponse(sessionBody({ accessToken: 'new-tok' })))
      // retry succeeds
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }));

    const provider = new ChatGPTProvider();
    const conv = await provider.getConversation('abc');
    expect(conv.id).toBe('11111111-1111-4111-8111-111111111111');

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const retryInit = fetchSpy.mock.calls[3]?.[1] as RequestInit;
    const headers = new Headers(retryInit.headers);
    expect(headers.get('Authorization')).toBe('Bearer new-tok');
  });

  it('retries up to 3x with exponential backoff on 5xx', async () => {
    vi.useFakeTimers();
    const fixture = loadFixtureText('chatgpt-simple.json');
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }));

    const provider = new ChatGPTProvider();
    const promise = provider.getConversation('abc');

    // Backoff schedule: 250, 500, 1000ms.
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);

    const conv = await promise;
    expect(conv.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('does not retry on 4xx other than 401', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));

    const provider = new ChatGPTProvider();
    // 404 returns the response; it's the JSON parse that fails. Either way,
    // no retry should occur — only session + the single failing call.
    await expect(provider.getConversation('abc')).rejects.toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ChatGPTProvider.fetchAttachment', () => {
  let fetchSpy: ReturnType<typeof spyOnFetch>;

  beforeEach(() => {
    fetchSpy = spyOnFetch();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('fetches the file metadata then the signed CDN url and returns the Blob', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'success',
          download_url: 'https://files.oaiusercontent.com/file-1?sig=xyz',
        }),
      )
      .mockResolvedValueOnce(
        new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
      );

    const provider = new ChatGPTProvider();
    const blob = await provider.fetchAttachment({
      id: 'file-DALLE0001',
      filename: 'sunset.png',
      included: false,
    });

    expect(blob).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toEqual(png);

    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'https://chatgpt.com/backend-api/files/file-DALLE0001/download',
    );
    expect(fetchSpy.mock.calls[2]?.[0]).toBe('https://files.oaiusercontent.com/file-1?sig=xyz');
    // The signed CDN URL must NOT carry the bearer token — the URL itself
    // is the authorization. Sending it would leak the access token to the CDN.
    const cdnInit = fetchSpy.mock.calls[2]?.[1] as RequestInit | undefined;
    const cdnHeaders = new Headers(cdnInit?.headers);
    expect(cdnHeaders.get('Authorization')).toBeNull();
  });

  it('encodes special characters in the file id', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(jsonResponse({ download_url: 'https://files.oaiusercontent.com/x' }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200 }));

    await new ChatGPTProvider().fetchAttachment({
      id: 'file/with spaces',
      filename: 'a.png',
      included: false,
    });
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'https://chatgpt.com/backend-api/files/file%2Fwith%20spaces/download',
    );
  });

  it('throws when the metadata response lacks download_url', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(jsonResponse({ status: 'error' }));

    await expect(
      new ChatGPTProvider().fetchAttachment({ id: 'file-1', filename: 'x', included: false }),
    ).rejects.toThrow(/missing download_url/);
  });

  it('throws when the metadata fetch returns non-OK', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));

    await expect(
      new ChatGPTProvider().fetchAttachment({ id: 'file-1', filename: 'x', included: false }),
    ).rejects.toThrow(/metadata fetch failed: 404/);
  });

  it('throws when the CDN download returns non-OK', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(sessionBody()))
      .mockResolvedValueOnce(
        jsonResponse({ download_url: 'https://files.oaiusercontent.com/expired' }),
      )
      .mockResolvedValueOnce(new Response('gone', { status: 410 }));

    await expect(
      new ChatGPTProvider().fetchAttachment({ id: 'file-1', filename: 'x', included: false }),
    ).rejects.toThrow(/download failed: 410/);
  });
});
