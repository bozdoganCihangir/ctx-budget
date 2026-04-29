export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type Strategy = 'drop-oldest' | 'head-tail' | 'sliding-window' | 'summarize';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  /** Optional name (OpenAI tool-message author or function-call name). */
  name?: string;
  /** Assistant tool calls (OpenAI shape). */
  tool_calls?: ToolCall[];
  /** Tool message: id of the tool call this responds to. */
  tool_call_id?: string;
  /** Mark a message as never-evict. ctx-budget treats this as sticky. */
  pinned?: boolean;
  /** Optional stable id for tracking — not sent to the model. */
  id?: string;
}

export type CountTokens = (text: string) => number;
export type GetText = (msg: ChatMessage) => string;
export type IsSticky = (msg: ChatMessage, index: number) => boolean;
export type Summarize = (msgs: ChatMessage[]) => string | Promise<string>;

export interface FitOptions {
  /** Hard ceiling. Budget is `maxTokens - reserveForResponse`. */
  maxTokens: number;
  /** Tokens to leave free for the model's reply. Default 0. */
  reserveForResponse?: number;
  /** Custom token counter. Default: `chars / 4`. */
  countTokens?: CountTokens;
  /** Per-message overhead (role markers, separators). Default 4 (OpenAI-ish). */
  perMessageOverhead?: number;
  /** Fit strategy. Default `head-tail`. */
  strategy?: Strategy;
  /** Strategy-specific: head/tail counts for `head-tail`. */
  keep?: { head?: number; tail?: number };
  /** Strategy-specific: window size for `sliding-window`. Default 10. */
  windowSize?: number;
  /**
   * Predicate for sticky (never-drop) messages.
   * Default: `role === 'system'` or `pinned === true`.
   */
  sticky?: IsSticky;
  /**
   * User-supplied summarizer. Required when `strategy === 'summarize'`.
   * Receives the messages that would have been dropped, oldest first.
   */
  summarize?: Summarize;
  /** Role for the inserted summary message. Default `'system'`. */
  summaryRole?: Role;
  /** Prefix prepended to the summary text. Default `'[Earlier conversation summary]\n'`. */
  summaryPrefix?: string;
  /** Token budget reserved for the summary itself. Default 200. */
  summaryReserve?: number;
  /** Custom message → text adapter. Default reads `content`/`name`/`tool_calls`/`tool_call_id`. */
  getText?: GetText;
}

export type DropReason = 'over-budget' | 'summarized' | 'window';

export interface DroppedRecord {
  message: ChatMessage;
  /** Position in the input. */
  index: number;
  reason: DropReason;
  tokens: number;
}

export type ChangeAction = 'kept' | 'dropped' | 'summarized' | 'inserted-summary';

export interface ChangeRecord {
  action: ChangeAction;
  /** Original input index for kept/dropped/summarized; -1 for inserted-summary. */
  index: number;
  reason?: string;
}

export interface FitResult {
  /** Messages ready to send to the model, in order. */
  messages: ChatMessage[];
  /** Messages removed from the input, in original order. */
  dropped: DroppedRecord[];
  /** Synthesized summary, if `strategy === 'summarize'` and any messages were summarized. */
  summary: ChatMessage | null;
  /** Token count of the returned `messages`. */
  tokensUsed: number;
  /** Effective budget — `maxTokens - reserveForResponse`. */
  tokensBudget: number;
  /** Token count of the input. */
  tokensBefore: number;
  /** True if `tokensUsed <= tokensBudget`. False only when sticky messages alone exceed budget. */
  fits: boolean;
  /** Ordered audit log: every kept, dropped, summarized, and inserted-summary action. */
  changes: ChangeRecord[];
  /** Strategy used. */
  strategy: Strategy;
}
