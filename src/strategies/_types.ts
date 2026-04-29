import type { Group } from '../core/pairs.js';
import type { TokenContext } from '../core/tokenize.js';
import type { ChatMessage, DropReason, FitOptions, IsSticky } from '../types.js';

export interface StrategyContext {
  tokens: TokenContext;
  /** Effective budget, already reduced by `reserveForResponse` (and `summaryReserve` for summarize). */
  budget: number;
  isSticky: IsSticky;
  options: FitOptions;
}

export interface StrategySelection {
  /** Group indices to keep. */
  keep: Set<number>;
  /** Group indices to drop, with reason. */
  drops: Map<number, DropReason>;
  /** For `summarize`: synthesized summary message and where it should be inserted. */
  summary?: ChatMessage;
  /**
   * For `summarize`: insertion point in the kept-group order.
   * Summary is spliced after the last sticky group whose original index is <= this point,
   * which keeps system messages first.
   */
  summaryAfterGroupIndex?: number;
}

export interface Strategy {
  readonly name: string;
  run(groups: Group[], ctx: StrategyContext): StrategySelection | Promise<StrategySelection>;
}
