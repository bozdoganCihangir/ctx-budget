import type { ChatMessage } from '../types.js';

/**
 * An atomic unit of messages. Singleton groups for ordinary messages; multi-message
 * groups for assistant tool-call messages bundled with their tool responses. Strategies
 * keep or drop a group as a whole, so a tool call never gets orphaned from its result.
 */
export interface Group {
  /** Original input indices, ascending. */
  indices: number[];
  messages: ChatMessage[];
}

/**
 * Walk messages and collect tool-call clusters. An assistant message with `tool_calls`
 * gets bundled with the immediately-following `role: 'tool'` messages whose
 * `tool_call_id` matches one of its calls. Other messages become singleton groups.
 */
export function groupMessages(messages: ChatMessage[]): Group[] {
  const groups: Group[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) continue;
    const m = messages[i];
    if (!m) continue;

    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      const expectedIds = new Set(m.tool_calls.map((tc) => tc.id));
      const matched = new Set<string>();
      const indices = [i];
      consumed.add(i);

      // Tool responses must be contiguous after the assistant message.
      // Stop at the first non-tool message or once every expected id is matched.
      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j];
        if (!next || next.role !== 'tool') break;
        if (
          next.tool_call_id &&
          expectedIds.has(next.tool_call_id) &&
          !matched.has(next.tool_call_id)
        ) {
          indices.push(j);
          consumed.add(j);
          matched.add(next.tool_call_id);
          if (matched.size === expectedIds.size) break;
        } else {
          break;
        }
      }

      groups.push({ indices, messages: indices.map((idx) => messages[idx] as ChatMessage) });
    } else {
      groups.push({ indices: [i], messages: [m] });
      consumed.add(i);
    }
  }

  return groups;
}
