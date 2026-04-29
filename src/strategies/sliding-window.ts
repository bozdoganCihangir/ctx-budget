import type { Group } from '../core/pairs.js';
import { analyzeGroups } from './_lib.js';
import type { Strategy, StrategyContext, StrategySelection } from './_types.js';

/**
 * Keep all sticky groups + the last `windowSize` non-sticky groups (default 10),
 * regardless of token count. If the kept set still exceeds the budget, drop oldest
 * non-sticky from the kept set with reason `over-budget`.
 *
 * Use this when your eviction policy is a simple message count, not token count.
 */
export const slidingWindow: Strategy = {
  name: 'sliding-window',
  run(groups: Group[], ctx: StrategyContext): StrategySelection {
    const windowSize = ctx.options.windowSize ?? 10;
    const { tokens, sticky, stickyTokens, nonStickyIdx } = analyzeGroups(groups, ctx);

    const keep = new Set<number>();
    const drops = new Map<number, 'over-budget' | 'summarized' | 'window'>();

    for (let i = 0; i < groups.length; i++) {
      if (sticky[i]) keep.add(i);
    }

    const inWindow = new Set(nonStickyIdx.slice(-windowSize));
    for (const i of nonStickyIdx) {
      if (inWindow.has(i)) keep.add(i);
      else drops.set(i, 'window');
    }

    // Budget enforcement on the kept window.
    let used = stickyTokens;
    for (const i of nonStickyIdx) if (keep.has(i)) used += tokens[i] as number;

    for (const i of nonStickyIdx) {
      if (used <= ctx.budget) break;
      if (!keep.has(i)) continue;
      keep.delete(i);
      drops.set(i, 'over-budget');
      used -= tokens[i] as number;
    }

    return { keep, drops };
  },
};
