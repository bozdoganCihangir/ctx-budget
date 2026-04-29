import { readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import cac from 'cac';
import pc from 'picocolors';
import { fit } from './index.js';
import type { ChatMessage, FitOptions, FitResult, Strategy } from './types.js';

const VERSION = '0.1.0';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseInput(raw: string): ChatMessage[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Try JSON array first.
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Expected an array of messages');
    return parsed as ChatMessage[];
  }
  // Otherwise JSONL: one message per line.
  const out: ChatMessage[] = [];
  for (const [i, line] of trimmed.split('\n').entries()) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as ChatMessage);
    } catch (err) {
      throw new Error(`Invalid JSON on line ${i + 1}: ${(err as Error).message}`);
    }
  }
  return out;
}

function shortContent(c: string | null, max = 60): string {
  const s = c ?? '';
  if (s.length <= max) return s.replace(/\n/g, ' ');
  return `${s.slice(0, max).replace(/\n/g, ' ')}…`;
}

function printDiff(result: FitResult, input: ChatMessage[]): void {
  const dropped = new Set(result.dropped.map((d) => d.index));
  const reasonByIdx = new Map(result.dropped.map((d) => [d.index, d.reason]));
  const w = String(input.length).length;

  for (let i = 0; i < input.length; i++) {
    const m = input[i] as ChatMessage;
    const tag = `${String(i).padStart(w)} ${m.role.padEnd(9)}`;
    if (dropped.has(i)) {
      const reason = reasonByIdx.get(i) ?? 'over-budget';
      const marker = reason === 'summarized' ? pc.yellow('Σ') : pc.red('−');
      process.stdout.write(`${marker} ${pc.dim(tag)} ${pc.dim(shortContent(m.content))}\n`);
    } else {
      process.stdout.write(`${pc.green('+')} ${tag} ${shortContent(m.content)}\n`);
    }
  }
  if (result.summary) {
    process.stdout.write(
      `${pc.yellow('Σ')} ${' '.repeat(w)} summary   ${pc.yellow(shortContent(result.summary.content))}\n`,
    );
  }
  process.stdout.write('\n');
  printSummary(result);
}

function printSummary(result: FitResult): void {
  const fitMark = result.fits ? pc.green('fits') : pc.red('OVER BUDGET');
  process.stderr.write(
    `${pc.bold(result.strategy)}  ${fitMark}  ${result.tokensBefore} → ${result.tokensUsed} / ${result.tokensBudget} tokens  ` +
      `${pc.dim(`(${result.dropped.length} dropped${result.summary ? ', 1 summary' : ''})`)}\n`,
  );
}

const cli = cac('ctx-budget');

cli
  .command('[file]', 'fit a chat history to a token budget')
  .option('--max <n>', 'max tokens (required)')
  .option('--reserve <n>', 'tokens to reserve for the model response', { default: 0 })
  .option('--strategy <s>', 'drop-oldest | head-tail | sliding-window', { default: 'head-tail' })
  .option('--head <n>', 'head messages to keep (head-tail)', { default: 1 })
  .option('--tail <n>', 'tail messages to keep (head-tail; default: greedy)')
  .option('--window <n>', 'window size (sliding-window)', { default: 10 })
  .option('--per-message <n>', 'per-message overhead in tokens', { default: 4 })
  .option('--json', 'emit full FitResult as JSON')
  .option('--diff', 'show kept/dropped messages with reasons')
  .example('  ctx-budget chat.jsonl --max 4000 --strategy head-tail --diff')
  .example('  cat chat.jsonl | ctx-budget --max 8000 --reserve 1000 --json')
  .action(async (file: string | undefined, opts: Record<string, unknown>) => {
    try {
      const max = Number(opts.max);
      if (!Number.isFinite(max) || max <= 0) {
        process.stderr.write(pc.red('--max <n> is required and must be positive\n'));
        process.exit(2);
      }
      const strategy = (opts.strategy ?? 'head-tail') as Strategy;
      if (strategy === 'summarize') {
        process.stderr.write(
          pc.red("CLI does not support 'summarize' (requires a callback). Use the library API.\n"),
        );
        process.exit(2);
      }
      if (!['drop-oldest', 'head-tail', 'sliding-window'].includes(strategy)) {
        process.stderr.write(pc.red(`Unknown strategy: ${strategy}\n`));
        process.exit(2);
      }

      const raw = file ? readFileSync(file, 'utf8') : await readStdin();
      const input = parseInput(raw);

      const fitOpts: FitOptions = {
        maxTokens: max,
        reserveForResponse: Number(opts.reserve) || 0,
        strategy,
        perMessageOverhead: Number(opts.perMessage) || 4,
        keep: {
          head: Number(opts.head) || 1,
          ...(opts.tail !== undefined ? { tail: Number(opts.tail) } : {}),
        },
        windowSize: Number(opts.window) || 10,
      };

      const result = await fit(input, fitOpts);

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      if (opts.diff) {
        printDiff(result, input);
        return;
      }

      // Default: emit kept messages as JSONL on stdout, summary on stderr.
      for (const m of result.messages) process.stdout.write(`${JSON.stringify(m)}\n`);
      if (stdout.isTTY) printSummary(result);
    } catch (err) {
      process.stderr.write(pc.red(`${(err as Error).message}\n`));
      process.exit(1);
    }
  });

cli.help();
cli.version(VERSION);

try {
  cli.parse();
} catch (err) {
  process.stderr.write(pc.red(`${(err as Error).message}\n`));
  process.exit(1);
}
