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
});
