import type { Group } from '../core/pairs.js';
import { analyzeGroups } from './_lib.js';
import type { Strategy, StrategyContext, StrategySelection } from './_types.js';

/**
 * Keep all sticky groups + the first `keep.head` non-sticky groups (default 1) + the
 * most recent non-sticky groups that fit the remaining budget. If `keep.tail` is set,
 * cap the tail at that count; otherwise fill greedily.
 *
 * Why this is the default: the first user message usually contains task framing, and
 * recent messages contain the conversational context. Dropping the middle preserves
 * both, which is what most chat apps want.
 */
export const headTail: Strategy = {
  name: 'head-tail',
  run(groups: Group[], ctx: StrategyContext): StrategySelection {
    const head = ctx.options.keep?.head ?? 1;
    const tailCap = ctx.options.keep?.tail; // undefined → greedy

    const { tokens, sticky, stickyTokens, nonStickyIdx } = analyzeGroups(groups, ctx);
    const keep = new Set<number>();
    const drops = new Map<number, 'over-budget' | 'summarized' | 'window'>();

    for (let i = 0; i < groups.length; i++) {
      if (sticky[i]) keep.add(i);
    }

    let remaining = ctx.budget - stickyTokens;

    // Head: oldest non-sticky.
    let headTaken = 0;
    for (const i of nonStickyIdx) {
      if (headTaken >= head) break;
      const t = tokens[i] as number;
      if (t <= remaining) {
        keep.add(i);
        remaining -= t;
        headTaken++;
      } else {
        // Mark as over-budget; keep trying further head slots in case a tiny one fits.
        drops.set(i, 'over-budget');
        headTaken++;
      }
    }

    // Tail candidates: non-sticky after the head slots.
    const tailCandidates = nonStickyIdx.slice(headTaken);
    let tailKept = 0;
    for (let k = tailCandidates.length - 1; k >= 0; k--) {
      const i = tailCandidates[k] as number;
      if (tailCap !== undefined && tailKept >= tailCap) {
        // Beyond the requested tail — drop as over-budget.
        drops.set(i, 'over-budget');
        continue;
      }
      const t = tokens[i] as number;
      if (t <= remaining) {
        keep.add(i);
        remaining -= t;
        tailKept++;
      } else {
        drops.set(i, 'over-budget');
        if (tailCap === undefined) {
          // Greedy: stop on first non-fit so we don't keep a stale older message
          // ahead of a more-recent one we couldn't fit.
          for (let kk = k - 1; kk >= 0; kk--) {
            drops.set(tailCandidates[kk] as number, 'over-budget');
          }
          break;
        }
      }
    }

    // Anything still unaccounted-for (e.g. all-sticky exceeded budget edge cases) is dropped.
    for (let i = 0; i < groups.length; i++) {
      if (!keep.has(i) && !drops.has(i)) drops.set(i, 'over-budget');
    }

    return { keep, drops };
  },
};
