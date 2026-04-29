import { runFit } from './core/engine.js';
import {
  countAllTokens as _countAllTokens,
  defaultCountTokens,
  defaultGetText,
} from './core/tokenize.js';
import type { TokenContext } from './core/tokenize.js';
import type {
  ChangeAction,
  ChangeRecord,
  ChatMessage,
  CountTokens,
  DropReason,
  DroppedRecord,
  FitOptions,
  FitResult,
  GetText,
  IsSticky,
  Role,
  Strategy,
  Summarize,
  ToolCall,
} from './types.js';

export type {
  ChangeAction,
  ChangeRecord,
  ChatMessage,
  CountTokens,
  DropReason,
  DroppedRecord,
  FitOptions,
  FitResult,
  GetText,
  IsSticky,
  Role,
  Strategy,
  Summarize,
  ToolCall,
};

export { ChatBuffer } from './buffer.js';

/**
 * Fit `messages` to a token budget using the chosen `strategy`. Returns the trimmed
 * (and optionally summarized) message list along with a record of every kept, dropped,
 * summarized, and inserted action.
 *
 * @example
 * ```ts
 * const r = await fit(messages, {
 *   maxTokens: 8000,
 *   reserveForResponse: 1000,
 *   strategy: 'head-tail',
 *   countTokens: (t) => encode(t).length,
 * });
 * sendToModel(r.messages);
 * ```
 */
export function fit(messages: ChatMessage[], options: FitOptions): Promise<FitResult> {
  return runFit(messages, options);
}

/**
 * Count tokens for a list of messages using the same accounting `fit` uses
 * (per-message overhead included). Useful for pre-flight checks.
 */
export function countTokens(
  messages: ChatMessage[],
  options: {
    countTokens?: CountTokens;
    perMessageOverhead?: number;
    getText?: GetText;
  } = {},
): number {
  const ctx: TokenContext = {
    count: options.countTokens ?? defaultCountTokens,
    perMessageOverhead: options.perMessageOverhead ?? 4,
    getText: options.getText ?? defaultGetText,
  };
  return _countAllTokens(messages, ctx);
}
