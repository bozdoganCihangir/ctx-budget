import type { Group } from '../core/pairs.js';
import type { ChatMessage } from '../types.js';
import { analyzeGroups } from './_lib.js';
import type { Strategy, StrategyContext, StrategySelection } from './_types.js';

/**
 * Drop oldest non-sticky messages until under budget (same shape as `drop-oldest`),
 * then call the user's `summarize` callback on the dropped messages and insert the
 * returned text as a single message. The summary takes the place of the dropped
 * history at the front of the non-sticky region.
 *
 * Requires `options.summarize` to be set. Throws otherwise.
 *
 * Budgeting: `summaryReserve` tokens (default 200) are subtracted from the budget
 * before deciding what to drop. If the actual summary exceeds the reserve, more
 * messages are evicted in a second pass.
 */
export const summarize: Strategy = {
  name: 'summarize',
  async run(groups: Group[], ctx: StrategyContext): Promise<StrategySelection> {
    if (!ctx.options.summarize) {
      throw new Error(
        "ctx-budget: strategy 'summarize' requires options.summarize — provide a callback (msgs) => string|Promise<string>",
      );
    }
    const summaryReserve = ctx.options.summaryReserve ?? 200;
    const summaryRole = ctx.options.summaryRole ?? 'system';
    const summaryPrefix = ctx.options.summaryPrefix ?? '[Earlier conversation summary]\n';

    const analysis = analyzeGroups(groups, ctx);

    // First pass: drop oldest non-sticky to fit (budget - summaryReserve).
    const firstPassBudget = ctx.budget - summaryReserve;
    const keep = new Set<number>();
    const drops = new Map<number, 'over-budget' | 'summarized' | 'window'>();
    for (let i = 0; i < groups.length; i++) if (analysis.sticky[i]) keep.add(i);

    let remaining = firstPassBudget - analysis.stickyTokens;
    for (let k = analysis.nonStickyIdx.length - 1; k >= 0; k--) {
      const i = analysis.nonStickyIdx[k] as number;
      const t = analysis.tokens[i] as number;
      if (t <= remaining) {
        keep.add(i);
        remaining -= t;
      } else {
        drops.set(i, 'summarized');
      }
    }

    if (drops.size === 0) {
      return { keep, drops };
    }

    // Synthesize summary on dropped messages, oldest first.
    const droppedIndices = [...drops.keys()].sort((a, b) => a - b);
    const droppedMessages: ChatMessage[] = [];
    for (const i of droppedIndices) {
      const g = groups[i] as Group;
      droppedMessages.push(...g.messages);
    }
    const summaryText = await ctx.options.summarize(droppedMessages);
    const summaryContent = summaryPrefix + summaryText;
    const summaryMsg: ChatMessage = { role: summaryRole, content: summaryContent };

    // Second pass: if the actual summary blows the reserve, evict more from the kept set.
    const summaryTokens =
      ctx.tokens.perMessageOverhead + ctx.tokens.count(ctx.tokens.getText(summaryMsg));
    const usedAfterSummary =
      analysis.stickyTokens +
      [...keep]
        .filter((i) => !analysis.sticky[i])
        .reduce((s, i) => s + (analysis.tokens[i] as number), 0) +
      summaryTokens;

    if (usedAfterSummary > ctx.budget) {
      let over = usedAfterSummary - ctx.budget;
      // Evict the kept non-sticky from oldest. These are NOT in the summary text — the
      // summarizer already ran on the first-pass set — so tag them 'over-budget'.
      for (const i of analysis.nonStickyIdx) {
        if (over <= 0) break;
        if (!keep.has(i)) continue;
        keep.delete(i);
        drops.set(i, 'over-budget');
        over -= analysis.tokens[i] as number;
      }
    }

    return { keep, drops, summary: summaryMsg };
  },
};
