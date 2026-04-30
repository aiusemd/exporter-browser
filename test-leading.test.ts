import { describe, expect, it } from 'vitest';
import { wrap } from './src/format/fences.js';

describe('leading newline test', () => {
  it('test wrap with leading newline', () => {
    const result = wrap('\nhello');
    console.log('Result:', JSON.stringify(result));
    console.log('Visual output:');
    console.log(result);
    expect(result).toContain('hello');
  });
});
