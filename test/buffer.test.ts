import { describe, expect, it } from 'vitest';
import { ChatBuffer } from '../src/index.js';
import type { ChatMessage } from '../src/types.js';

const len = (t: string) => t.length;

describe('ChatBuffer', () => {
  it('accumulates and refits on demand', async () => {
    const buf = new ChatBuffer({
      maxTokens: 20,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'drop-oldest',
    });
    buf.push({ role: 'user', content: 'a'.repeat(15) });
    buf.push({ role: 'assistant', content: 'b'.repeat(15) });

    const r = await buf.fit();
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.content).toBe('b'.repeat(15));
    // Buffer keeps full history.
    expect(buf.messages).toHaveLength(2);
  });

  it('clear() empties the buffer', () => {
    const buf = new ChatBuffer({ maxTokens: 100 });
    buf.push({ role: 'user', content: 'x' });
    buf.clear();
    expect(buf.messages).toHaveLength(0);
  });

  it('setMessages replaces history', () => {
    const buf = new ChatBuffer({ maxTokens: 100 });
    buf.push({ role: 'user', content: 'a' });
    const fresh: ChatMessage[] = [{ role: 'system', content: 'sys' }];
    buf.setMessages(fresh);
    expect(buf.messages).toEqual(fresh);
  });

  it('messages getter returns a copy', () => {
    const buf = new ChatBuffer({ maxTokens: 100 });
    buf.push({ role: 'user', content: 'a' });
    const out = buf.messages;
    out.push({ role: 'user', content: 'b' });
    expect(buf.messages).toHaveLength(1);
  });

  it('pushAll appends multiple messages', () => {
    const buf = new ChatBuffer({ maxTokens: 100 });
    buf.push({ role: 'system', content: 'sys' });
    buf.pushAll([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    expect(buf.messages.map((m) => m.content)).toEqual(['sys', 'a', 'b']);
  });

  it('setOptions replaces options and is reflected on next fit', async () => {
    const buf = new ChatBuffer(
      { maxTokens: 1000, countTokens: len, perMessageOverhead: 0, strategy: 'drop-oldest' },
      [
        { role: 'user', content: 'a'.repeat(20) },
        { role: 'user', content: 'b'.repeat(20) },
      ],
    );
    const big = await buf.fit();
    expect(big.messages).toHaveLength(2);

    buf.setOptions({
      maxTokens: 25,
      countTokens: len,
      perMessageOverhead: 0,
      strategy: 'drop-oldest',
    });
    const tight = await buf.fit();
    expect(tight.messages).toHaveLength(1);
    expect(tight.messages[0]?.content).toBe('b'.repeat(20));
    expect(buf.options.maxTokens).toBe(25);
  });

  it('options getter returns current options', () => {
    const opts = { maxTokens: 42 };
    const buf = new ChatBuffer(opts);
    expect(buf.options.maxTokens).toBe(42);
  });

  it('constructor accepts initial messages and copies them', () => {
    const seed = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'hi' },
    ];
    const buf = new ChatBuffer({ maxTokens: 100 }, seed);
    expect(buf.messages.map((m) => m.content)).toEqual(['sys', 'hi']);
    seed.push({ role: 'user' as const, content: 'late' });
    expect(buf.messages).toHaveLength(2);
  });
});
