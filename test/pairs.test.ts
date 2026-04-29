import { describe, expect, it } from 'vitest';
import { groupMessages } from '../src/core/pairs.js';
import type { ChatMessage } from '../src/types.js';

describe('groupMessages', () => {
  it('singletons for plain messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.indices)).toEqual([[0], [1], [2]]);
  });

  it('bundles assistant tool_calls with following tool messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'use a tool' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'f1', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'f2', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'r1', tool_call_id: 'c1' },
      { role: 'tool', content: 'r2', tool_call_id: 'c2' },
      { role: 'assistant', content: 'done' },
    ];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.indices).toEqual([0]);
    expect(groups[1]?.indices).toEqual([1, 2, 3]);
    expect(groups[2]?.indices).toEqual([4]);
  });

  it('handles partial tool responses (missing one)', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'f1', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'f2', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'r1', tool_call_id: 'c1' },
      { role: 'user', content: 'kept going without c2' },
    ];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.indices).toEqual([0, 1]);
    expect(groups[1]?.indices).toEqual([2]);
  });

  it('orphan tool message becomes a singleton', () => {
    const msgs: ChatMessage[] = [
      { role: 'tool', content: 'orphan', tool_call_id: 'c0' },
      { role: 'user', content: 'huh' },
    ];
    const groups = groupMessages(msgs);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.indices).toEqual([0]);
  });
});
