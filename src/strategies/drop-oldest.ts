import type { Group } from '../core/pairs.js';
import { analyzeGroups } from './_lib.js';
import type { Strategy, StrategyContext, StrategySelection } from './_types.js';

/**
 * Keep all sticky groups; among non-sticky groups, keep the most recent ones that fit
 * the budget and drop the rest from the front. The classic "FIFO eviction" approach.
 *
 * If a single non-sticky group is too big to fit alone, it is dropped. Smaller older
 * groups behind it may still be kept if the budget allows.
 */
export const dropOldest: Strategy = {
  name: 'drop-oldest',
  run(groups: Group[], ctx: StrategyContext): StrategySelection {
    const { tokens, sticky, stickyTokens, nonStickyIdx } = analyzeGroups(groups, ctx);
    const keep = new Set<number>();
    const drops = new Map<number, 'over-budget' | 'summarized' | 'window'>();

    for (let i = 0; i < groups.length; i++) {
      if (sticky[i]) keep.add(i);
    }

    // Sticky-only path: even if sticky exceed budget, we still keep them (fits=false later).
    let remaining = ctx.budget - stickyTokens;

    // Walk non-sticky from newest → oldest.
    for (let k = nonStickyIdx.length - 1; k >= 0; k--) {
      const i = nonStickyIdx[k] as number;
      const t = tokens[i] as number;
      if (t <= remaining) {
        keep.add(i);
        remaining -= t;
      } else {
        drops.set(i, 'over-budget');
      }
    }

    return { keep, drops };
  },
};
