/**
 * Synthetic benchmark for ctx-budget. Generates a 1k-message conversation and runs
 * each non-summarize strategy. Reports throughput and basic stats.
 *
 * Usage: npm run bench
 */

import { performance } from 'node:perf_hooks';
import { fit } from '../src/index.js';
import type { ChatMessage, Strategy } from '../src/types.js';

function generateConversation(n: number): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: 'You are a helpful assistant.' }];
  for (let i = 0; i < n; i++) {
    out.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${'lorem ipsum dolor sit amet '.repeat(8 + (i % 5) * 4)}`,
    });
  }
  return out;
}

async function timeFit(
  msgs: ChatMessage[],
  strategy: Strategy,
  iters: number,
): Promise<{ avgMs: number; lastResult: Awaited<ReturnType<typeof fit>> }> {
  // Warm up
  await fit(msgs, { maxTokens: 4000, strategy });

  const start = performance.now();
  let last!: Awaited<ReturnType<typeof fit>>;
  for (let i = 0; i < iters; i++) {
    last = await fit(msgs, { maxTokens: 4000, strategy });
  }
  const elapsed = performance.now() - start;
  return { avgMs: elapsed / iters, lastResult: last };
}

async function main(): Promise<void> {
  const sizes = [100, 500, 1000];
  const strategies: Strategy[] = ['drop-oldest', 'head-tail', 'sliding-window'];
  const iters = 50;

  console.log(`\n## ctx-budget benchmark (avg over ${iters} iterations)\n`);
  console.log('| Messages | Strategy | Avg ms | Kept | Dropped | Tokens used |');
  console.log('| ---: | --- | ---: | ---: | ---: | ---: |');

  for (const n of sizes) {
    const msgs = generateConversation(n);
    for (const strategy of strategies) {
      const { avgMs, lastResult } = await timeFit(msgs, strategy, iters);
      console.log(
        `| ${n} | ${strategy} | ${avgMs.toFixed(2)} | ${lastResult.messages.length} | ${lastResult.dropped.length} | ${lastResult.tokensUsed} |`,
      );
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
