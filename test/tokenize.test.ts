import { describe, expect, it } from 'vitest';
import { countTokens } from '../src/index.js';

describe('countTokens', () => {
  it('uses chars/4 by default', () => {
    // 8-char content + per-message overhead 4 = ceil(8/4)+4 = 6
    expect(countTokens([{ role: 'user', content: 'abcdefgh' }])).toBe(6);
  });

  it('honors a custom counter', () => {
    expect(
      countTokens([{ role: 'user', content: 'abcdefgh' }], { countTokens: (t) => t.length }),
    ).toBe(12); // 8 + overhead 4
  });

  it('honors per-message overhead', () => {
    expect(
      countTokens([{ role: 'user', content: 'abcd' }], {
        countTokens: (t) => t.length,
        perMessageOverhead: 0,
      }),
    ).toBe(4);
  });

  it('counts tool-call arguments and names', () => {
    const msg = {
      role: 'assistant' as const,
      content: null,
      tool_calls: [
        { id: 'c1', type: 'function' as const, function: { name: 'foo', arguments: '{"x":1}' } },
      ],
    };
    // text: 'foo' + '\n' + '{"x":1}' = 3 + 1 + 7 = 11 chars
    expect(countTokens([msg], { countTokens: (t) => t.length, perMessageOverhead: 0 })).toBe(11);
  });

  it('handles null content', () => {
    expect(
      countTokens([{ role: 'assistant', content: null }], {
        countTokens: (t) => t.length,
        perMessageOverhead: 0,
      }),
    ).toBe(0);
  });
});
