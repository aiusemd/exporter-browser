import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FIXTURES_DIR = join(__dirname, 'fixtures');

interface MappingEntry {
  id: string;
  parent: string | null;
  children: string[];
  message: unknown;
}

interface ChatGPTFixture {
  _comment: string;
  title: string;
  create_time: number;
  update_time: number;
  conversation_id: string;
  current_node: string;
  mapping: Record<string, MappingEntry>;
}

function loadFixtures(): Array<{ name: string; data: ChatGPTFixture }> {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  return files.map((name) => ({
    name,
    data: JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as ChatGPTFixture,
  }));
}

describe('test fixtures', () => {
  const fixtures = loadFixtures();

  it('directory contains the 8 expected ChatGPT fixtures', () => {
    const names = fixtures.map((f) => f.name).sort();
    expect(names).toEqual([
      'chatgpt-browsing.json',
      'chatgpt-code-interpreter.json',
      'chatgpt-code.json',
      'chatgpt-dalle.json',
      'chatgpt-markdown.json',
      'chatgpt-multimodal.json',
      'chatgpt-regen-tree.json',
      'chatgpt-simple.json',
    ]);
  });

  for (const { name, data } of fixtures) {
    describe(name, () => {
      it('has a documentation _comment', () => {
        expect(typeof data._comment).toBe('string');
        expect(data._comment.length).toBeGreaterThan(20);
      });

      it('has a title and timestamps', () => {
        expect(typeof data.title).toBe('string');
        expect(typeof data.create_time).toBe('number');
        expect(typeof data.update_time).toBe('number');
      });

      it('has a current_node that exists in mapping', () => {
        expect(data.mapping[data.current_node]).toBeDefined();
      });

      it('has a synthetic root with null message and parent', () => {
        const rootEntry = Object.values(data.mapping).find((n) => n.parent === null);
        expect(rootEntry).toBeDefined();
        expect(rootEntry?.message).toBeNull();
      });

      it('forms a valid tree (every child references back to its parent)', () => {
        for (const [nodeId, node] of Object.entries(data.mapping)) {
          for (const childId of node.children) {
            const child = data.mapping[childId];
            expect(child).toBeDefined();
            expect(child?.parent).toBe(nodeId);
          }
        }
      });

      it('canonical branch from current_node terminates at the root', () => {
        const visited = new Set<string>();
        let cursor: string | null = data.current_node;
        while (cursor !== null) {
          if (visited.has(cursor)) throw new Error(`cycle at ${cursor}`);
          visited.add(cursor);
          const entry: MappingEntry | undefined = data.mapping[cursor];
          if (entry === undefined) throw new Error(`missing node ${cursor}`);
          cursor = entry.parent;
        }
        expect(visited.size).toBeGreaterThan(1);
      });
    });
  }
});
