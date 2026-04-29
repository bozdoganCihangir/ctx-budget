import { defaultSticky } from '../strategies/_lib.js';
import { getStrategy } from '../strategies/registry.js';
import type {
  ChangeRecord,
  ChatMessage,
  DroppedRecord,
  FitOptions,
  FitResult,
  IsSticky,
  Strategy as StrategyName,
} from '../types.js';
import { groupMessages } from './pairs.js';
import {
  countAllTokens,
  countMessageTokens,
  defaultCountTokens,
  defaultGetText,
} from './tokenize.js';
import type { TokenContext } from './tokenize.js';

export async function runFit(messages: ChatMessage[], options: FitOptions): Promise<FitResult> {
  if (!Number.isFinite(options.maxTokens) || options.maxTokens <= 0) {
    throw new Error('ctx-budget: maxTokens must be a positive number');
  }

  const tokens: TokenContext = {
    count: options.countTokens ?? defaultCountTokens,
    perMessageOverhead: options.perMessageOverhead ?? 4,
    getText: options.getText ?? defaultGetText,
  };

  const reserve = options.reserveForResponse ?? 0;
  const budget = options.maxTokens - reserve;

  const strategyName: StrategyName = options.strategy ?? 'head-tail';
  const strategy = getStrategy(strategyName);
  const isSticky: IsSticky = options.sticky ?? defaultSticky;

  const groups = groupMessages(messages);
  const tokensBefore = countAllTokens(messages, tokens);

  const selection = await strategy.run(groups, { tokens, budget, isSticky, options });

  // Per-input-message status, indexed by original position.
  type Status = { action: 'kept' | 'dropped' | 'summarized'; reason?: string };
  const statusByInput: (Status | undefined)[] = new Array(messages.length);

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (!group) continue;
    if (selection.keep.has(gi)) {
      for (const idx of group.indices) statusByInput[idx] = { action: 'kept' };
    } else {
      const reason = selection.drops.get(gi) ?? 'over-budget';
      for (const idx of group.indices)
        statusByInput[idx] = { action: reason === 'summarized' ? 'summarized' : 'dropped', reason };
    }
  }

  // Where does the summary go? Before the first non-sticky kept group's first message.
  const firstNonStickyKeptInputIdx = (() => {
    for (let gi = 0; gi < groups.length; gi++) {
      if (!selection.keep.has(gi)) continue;
      const g = groups[gi];
      if (!g) continue;
      const sticky = g.messages.some((m, k) => isSticky(m, g.indices[k] as number));
      if (!sticky) return g.indices[0] as number;
    }
    return -1;
  })();

  const out: ChatMessage[] = [];
  const changes: ChangeRecord[] = [];
  const droppedRecords: DroppedRecord[] = [];

  for (let i = 0; i < messages.length; i++) {
    const s = statusByInput[i];
    if (selection.summary && i === firstNonStickyKeptInputIdx) {
      out.push(selection.summary);
      changes.push({ action: 'inserted-summary', index: -1 });
    }
    if (!s) continue;
    if (s.action === 'kept') {
      out.push(messages[i] as ChatMessage);
      changes.push({ action: 'kept', index: i });
    } else {
      const m = messages[i] as ChatMessage;
      droppedRecords.push({
        message: m,
        index: i,
        reason: (s.reason ?? 'over-budget') as DroppedRecord['reason'],
        tokens: countMessageTokens(m, tokens),
      });
      changes.push({ action: s.action, index: i, ...(s.reason ? { reason: s.reason } : {}) });
    }
  }

  // No non-sticky kept group: append summary at the end if present.
  if (selection.summary && firstNonStickyKeptInputIdx === -1) {
    out.push(selection.summary);
    changes.push({ action: 'inserted-summary', index: -1 });
  }

  const tokensUsed = countAllTokens(out, tokens);
  const fits = tokensUsed <= budget;

  return {
    messages: out,
    dropped: droppedRecords,
    summary: selection.summary ?? null,
    tokensUsed,
    tokensBudget: budget,
    tokensBefore,
    fits,
    changes,
    strategy: strategyName,
  };
}
