import type { Group } from '../core/pairs.js';
import { countMessageTokens } from '../core/tokenize.js';
import type { ChatMessage } from '../types.js';
import type { StrategyContext } from './_types.js';

export function groupTokens(group: Group, ctx: StrategyContext): number {
  let n = 0;
  for (const m of group.messages) n += countMessageTokens(m, ctx.tokens);
  return n;
}

export function isGroupSticky(group: Group, ctx: StrategyContext): boolean {
  return group.messages.some((m, k) => ctx.isSticky(m, group.indices[k] as number));
}

export interface GroupAnalysis {
  tokens: number[];
  sticky: boolean[];
  stickyTokens: number;
  nonStickyIdx: number[];
}

export function analyzeGroups(groups: Group[], ctx: StrategyContext): GroupAnalysis {
  const tokens: number[] = [];
  const sticky: boolean[] = [];
  let stickyTokens = 0;
  const nonStickyIdx: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i] as Group;
    const t = groupTokens(g, ctx);
    const s = isGroupSticky(g, ctx);
    tokens.push(t);
    sticky.push(s);
    if (s) stickyTokens += t;
    else nonStickyIdx.push(i);
  }
  return { tokens, sticky, stickyTokens, nonStickyIdx };
}

/**
 * Default sticky predicate: system messages and pinned messages.
 */
export const defaultSticky = (msg: ChatMessage): boolean =>
  msg.role === 'system' || msg.pinned === true;
