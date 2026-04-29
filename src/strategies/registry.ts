import type { Strategy as StrategyName } from '../types.js';
import type { Strategy } from './_types.js';
import { dropOldest } from './drop-oldest.js';
import { headTail } from './head-tail.js';
import { slidingWindow } from './sliding-window.js';
import { summarize } from './summarize.js';

export const strategies: Record<StrategyName, Strategy> = {
  'drop-oldest': dropOldest,
  'head-tail': headTail,
  'sliding-window': slidingWindow,
  summarize,
};

export function getStrategy(name: StrategyName): Strategy {
  const s = strategies[name];
  if (!s) throw new Error(`ctx-budget: unknown strategy '${name}'`);
  return s;
}
