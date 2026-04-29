import type { ChatMessage, CountTokens, GetText } from '../types.js';

/** Free fallback tokenizer — `Math.ceil(len / 4)`, OpenAI's chars-per-token rule of thumb. */
export const defaultCountTokens: CountTokens = (text) => Math.ceil(text.length / 4);

/**
 * Default text extractor. Concatenates everything the model would actually see for a
 * message: content, name, tool-call function names + arguments, and tool_call_id.
 */
export const defaultGetText: GetText = (msg: ChatMessage): string => {
  const parts: string[] = [];
  if (msg.content) parts.push(msg.content);
  if (msg.name) parts.push(msg.name);
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      parts.push(tc.function.name);
      parts.push(tc.function.arguments);
    }
  }
  if (msg.tool_call_id) parts.push(msg.tool_call_id);
  return parts.join('\n');
};

export interface TokenContext {
  count: CountTokens;
  perMessageOverhead: number;
  getText: GetText;
}

export function countMessageTokens(msg: ChatMessage, ctx: TokenContext): number {
  return ctx.perMessageOverhead + ctx.count(ctx.getText(msg));
}

export function countAllTokens(msgs: ChatMessage[], ctx: TokenContext): number {
  let total = 0;
  for (const m of msgs) total += countMessageTokens(m, ctx);
  return total;
}
