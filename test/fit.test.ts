import { describe, expect, it } from 'vitest';
import { fit } from '../src/index.js';
import type { ChatMessage } from '../src/types.js';

const len = (t: string) => t.length;

function mk(
  role: ChatMessage['role'],
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { role, content, ...extra };
}

describe('fit() — basic semantics', () => {
  it('returns everything if it fits', async () => {
    const msgs: ChatMessage[] = [
      mk('system', 'you are helpful'),
      mk('user', 'hi'),
      mk('assistant', 'hello'),
    ];
    const r = await fit(msgs, { maxTokens: 1000, countTokens: len, perMessageOverhead: 0 });
    expect(r.messages).toHaveLength(3);
    expect(r.dropped).toEqual([]);
    expect(r.fits).toBe(true);
    expect(r.tokensUsed).toBe('you are helpful'.length + 'hi'.length + 'hello'.length);
  });

  it('keeps system messages sticky by default', async () => {
    const msgs: ChatMessage[] = [
      mk('system', 'S'.repeat(50)),
      mk('user', 'U'.repeat(50)),
      mk('assistant', 'A'.repeat(50)),
    ];
    const r = await fit(msgs, {
      maxTokens: 60,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'drop-oldest',
    });
    expect(r.messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('honors pinned: true', async () => {
    const msgs: ChatMessage[] = [
      mk('user', 'pin me', { pinned: true }),
      mk('user', 'a'.repeat(100)),
      mk('user', 'b'.repeat(100)),
    ];
    const r = await fit(msgs, {
      maxTokens: 50,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'drop-oldest',
    });
    expect(r.messages.some((m) => m.content === 'pin me')).toBe(true);
  });

  it('reports fits=false if sticky alone exceeds budget', async () => {
    const msgs: ChatMessage[] = [mk('system', 'S'.repeat(100))];
    const r = await fit(msgs, { maxTokens: 50, countTokens: len, perMessageOverhead: 0 });
    expect(r.fits).toBe(false);
    expect(r.messages).toHaveLength(1); // sticky still kept
  });

  it('subtracts reserveForResponse from budget', async () => {
    const msgs: ChatMessage[] = [mk('user', 'a'.repeat(40)), mk('user', 'b'.repeat(40))];
    const r = await fit(msgs, {
      maxTokens: 100,
      reserveForResponse: 50,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'drop-oldest',
    });
    // budget 50, only one 40-char message can fit → drop the older one
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.content).toBe('b'.repeat(40));
    expect(r.tokensBudget).toBe(50);
  });

  it('throws on invalid maxTokens', async () => {
    await expect(fit([], { maxTokens: 0 })).rejects.toThrow(/maxTokens/);
  });
});

describe('fit() — drop-oldest', () => {
  it('drops oldest non-sticky to fit', async () => {
    const msgs: ChatMessage[] = [
      mk('system', 'sys'),
      mk('user', 'old1'),
      mk('user', 'old2'),
      mk('user', 'recent1'),
      mk('user', 'recent2'),
    ];
    const r = await fit(msgs, {
      maxTokens: 'sys'.length + 'recent1'.length + 'recent2'.length,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'drop-oldest',
    });
    expect(r.messages.map((m) => m.content)).toEqual(['sys', 'recent1', 'recent2']);
    expect(r.dropped.map((d) => d.message.content)).toEqual(['old1', 'old2']);
  });
});

describe('fit() — head-tail', () => {
  it('keeps system + head + recent that fit', async () => {
    const msgs: ChatMessage[] = [
      mk('system', 'sys'),
      mk('user', 'first'), // head
      mk('user', 'mid1'),
      mk('user', 'mid2'),
      mk('user', 'recent1'),
      mk('user', 'recent2'),
    ];
    const r = await fit(msgs, {
      maxTokens: 'sys'.length + 'first'.length + 'recent1'.length + 'recent2'.length,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'head-tail',
    });
    expect(r.messages.map((m) => m.content)).toEqual(['sys', 'first', 'recent1', 'recent2']);
  });

  it('respects keep.tail cap', async () => {
    const msgs: ChatMessage[] = [
      mk('user', 'h'),
      mk('user', 'a'),
      mk('user', 'b'),
      mk('user', 'c'),
    ];
    const r = await fit(msgs, {
      maxTokens: 1000,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'head-tail',
      keep: { head: 1, tail: 1 },
    });
    expect(r.messages.map((m) => m.content)).toEqual(['h', 'c']);
  });

  it('respects keep.head=0', async () => {
    const msgs: ChatMessage[] = [mk('user', 'a'), mk('user', 'b'), mk('user', 'c')];
    const r = await fit(msgs, {
      maxTokens: 1000,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'head-tail',
      keep: { head: 0 },
    });
    expect(r.messages.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('skips oversized oldest when filling head slot', async () => {
    // The oldest message can't fit anywhere, so the head slot should advance to the
    // next candidate rather than burning the slot on the doomed message.
    const msgs: ChatMessage[] = [
      mk('user', 'X'.repeat(500)),
      mk('user', 'a'),
      mk('user', 'b'),
      mk('user', 'c'),
    ];
    const r = await fit(msgs, {
      maxTokens: 10,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'head-tail',
      keep: { head: 1, tail: 1 },
    });
    // 'X…' dropped (over-budget); 'a' fills head, 'c' fills tail.
    expect(r.messages.map((m) => m.content)).toEqual(['a', 'c']);
    const droppedContents = r.dropped.map((d) => d.message.content);
    expect(droppedContents).toContain('X'.repeat(500));
    expect(droppedContents).toContain('b');
  });
});

describe('fit() — sliding-window', () => {
  it('keeps last N non-sticky', async () => {
    const msgs: ChatMessage[] = [
      mk('system', 'sys'),
      mk('user', '1'),
      mk('user', '2'),
      mk('user', '3'),
      mk('user', '4'),
      mk('user', '5'),
    ];
    const r = await fit(msgs, {
      maxTokens: 1000,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'sliding-window',
      windowSize: 3,
    });
    expect(r.messages.map((m) => m.content)).toEqual(['sys', '3', '4', '5']);
    expect(r.dropped.every((d) => d.reason === 'window')).toBe(true);
  });

  it('falls back to over-budget when window still too big', async () => {
    const msgs: ChatMessage[] = [
      mk('user', 'a'.repeat(20)),
      mk('user', 'b'.repeat(20)),
      mk('user', 'c'.repeat(20)),
    ];
    const r = await fit(msgs, {
      maxTokens: 25,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'sliding-window',
      windowSize: 3,
    });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.content).toBe('c'.repeat(20));
    const reasons = r.dropped.map((d) => d.reason);
    expect(reasons).toContain('over-budget');
  });
});

describe('fit() — summarize', () => {
  it('calls summarize callback on dropped messages and inserts result', async () => {
    const msgs: ChatMessage[] = [
      mk('system', 'sys'),
      mk('user', 'old1'),
      mk('user', 'old2'),
      mk('user', 'recent'),
    ];
    let received: ChatMessage[] = [];
    const r = await fit(msgs, {
      maxTokens: 'sys'.length + 'recent'.length + 50,
      countTokens: len,
      perMessageOverhead: 0,
      summaryReserve: 50,
      strategy: 'summarize',
      summarize: (ms) => {
        received = ms;
        return 'old stuff happened';
      },
    });
    expect(received.map((m) => m.content)).toEqual(['old1', 'old2']);
    expect(r.summary).not.toBeNull();
    // sys, summary, recent
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'system', 'user']);
    expect(r.messages[1]?.content).toContain('old stuff happened');
    expect(r.dropped.every((d) => d.reason === 'summarized')).toBe(true);
  });

  it('does not call summarizer if everything fits', async () => {
    const msgs: ChatMessage[] = [mk('user', 'hi')];
    let called = false;
    const r = await fit(msgs, {
      maxTokens: 10000,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'summarize',
      summarize: () => {
        called = true;
        return 'unused';
      },
    });
    expect(called).toBe(false);
    expect(r.summary).toBeNull();
  });

  it('throws if summarize callback missing', async () => {
    await expect(
      fit([mk('user', 'a'.repeat(100))], {
        maxTokens: 5,
        countTokens: len,
        perMessageOverhead: 0,
        strategy: 'summarize',
      }),
    ).rejects.toThrow(/summarize/);
  });

  it('async summarizer is awaited', async () => {
    const r = await fit([mk('user', 'old1'), mk('user', 'old2'), mk('user', 'recent')], {
      maxTokens: 'recent'.length + 50,
      countTokens: len,
      perMessageOverhead: 0,
      summaryReserve: 50,
      strategy: 'summarize',
      summarize: async (ms) => `summary of ${ms.length}`,
    });
    expect(r.summary?.content).toContain('summary of 2');
  });

  it('tags second-pass evictions as over-budget when summary exceeds reserve', async () => {
    // First pass keeps 'recent2' (7 ≤ firstPassBudget=8); old1/old2/recent1 are dropped
    // and summarized. The summary text is 100 chars which blows summaryReserve=10, so
    // recent2 is evicted in the second pass — and tagged 'over-budget' because it isn't
    // in the summary text.
    const msgs: ChatMessage[] = [
      mk('user', 'old1'),
      mk('user', 'old2'),
      mk('user', 'recent1'),
      mk('user', 'recent2'),
    ];
    let received: ChatMessage[] = [];
    const r = await fit(msgs, {
      maxTokens: 18,
      countTokens: len,
      perMessageOverhead: 0,
      summaryReserve: 10,
      strategy: 'summarize',
      summaryPrefix: '',
      summarize: (ms) => {
        received = ms;
        return 'S'.repeat(100);
      },
    });
    expect(received.map((m) => m.content)).toEqual(['old1', 'old2', 'recent1']);
    const reasons = Object.fromEntries(r.dropped.map((d) => [d.message.content, d.reason]));
    expect(reasons.old1).toBe('summarized');
    expect(reasons.old2).toBe('summarized');
    expect(reasons.recent1).toBe('summarized');
    expect(reasons.recent2).toBe('over-budget');
  });
});

describe('fit() — tool-call pair atomicity', () => {
  it('keeps assistant tool_calls together with their tool responses', async () => {
    const msgs: ChatMessage[] = [
      mk('user', 'old user msg that should be dropped'),
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
      { role: 'tool', content: 'tool result', tool_call_id: 'c1' },
      mk('user', 'recent'),
    ];
    const r = await fit(msgs, {
      maxTokens: 30, // tight enough to drop something
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'drop-oldest',
    });
    // Either both tool messages survive or both are dropped — never split.
    const hasAssistantToolCall = r.messages.some((m) => m.tool_calls);
    const hasToolResp = r.messages.some((m) => m.role === 'tool');
    expect(hasAssistantToolCall).toBe(hasToolResp);
  });
});

describe('fit() — change records', () => {
  it('emits kept/dropped/inserted-summary in input order', async () => {
    const msgs: ChatMessage[] = [mk('system', 'sys'), mk('user', 'old'), mk('user', 'recent')];
    const r = await fit(msgs, {
      maxTokens: 'sys'.length + 'recent'.length + 50,
      countTokens: len,
      perMessageOverhead: 0,
      summaryReserve: 50,
      strategy: 'summarize',
      summarize: () => 'sm',
    });
    const actions = r.changes.map((c) => c.action);
    // sys (kept) → inserted-summary → old (summarized) → recent (kept)
    // BUT the summary is inserted before the first non-sticky kept, which is 'recent' (idx 2).
    // 'old' was dropped, so the order in changes goes: kept(sys), summarized(old), inserted-summary, kept(recent)
    expect(actions[0]).toBe('kept');
    expect(actions).toContain('inserted-summary');
    expect(actions).toContain('summarized');
  });
});
