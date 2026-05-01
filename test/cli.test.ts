import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { version as PKG_VERSION } from '../package.json';

const ROOT = join(__dirname, '..');
let DIST: string;

beforeAll(() => {
  // Build once for CLI tests.
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
  DIST = join(ROOT, 'dist', 'cli.js');
});

afterAll(() => {
  // Leave dist for downstream commands.
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control chars.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

function run(args: string[], stdin?: string): { stdout: string; stderr: string; code: number } {
  // Strip ANSI from captured streams — NO_COLOR alone isn't reliable across
  // picocolors versions / CI envs, so we sanitize at the test boundary instead.
  const r = spawnSync('node', [DIST, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    stdout: stripAnsi(r.stdout ?? ''),
    stderr: stripAnsi(r.stderr ?? ''),
    code: r.status ?? 1,
  };
}

describe('CLI', () => {
  let dir: string;
  let chatFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctx-budget-cli-'));
    mkdirSync(dir, { recursive: true });
    chatFile = join(dir, 'chat.jsonl');
    const messages = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'first user message' },
      { role: 'assistant', content: 'first assistant reply' },
      { role: 'user', content: 'second user message' },
      { role: 'assistant', content: 'second assistant reply' },
    ];
    writeFileSync(chatFile, messages.map((m) => JSON.stringify(m)).join('\n'));
  });

  it('prints version matching package.json', () => {
    const r = run(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`ctx-budget/${PKG_VERSION}`);
  });

  it('errors when --max is missing', () => {
    const r = run([chatFile]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/--max/);
  });

  it('reads file and emits JSONL by default', () => {
    const r = run([chatFile, '--max', '10000']);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const m = JSON.parse(line);
      expect(m).toHaveProperty('role');
    }
  });

  it('emits JSON with --json', () => {
    const r = run([chatFile, '--max', '10000', '--json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty('messages');
    expect(parsed).toHaveProperty('tokensBudget');
    expect(parsed).toHaveProperty('strategy');
  });

  it('drops messages when budget is tight', () => {
    const r = run([chatFile, '--max', '20', '--strategy', 'drop-oldest', '--json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.dropped.length).toBeGreaterThan(0);
  });

  it('reads from stdin', () => {
    const input = JSON.stringify([{ role: 'user', content: 'hi' }]);
    const r = run(['--max', '1000', '--json'], input);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.messages).toHaveLength(1);
  });

  it("rejects strategy 'summarize'", () => {
    const r = run([chatFile, '--max', '10000', '--strategy', 'summarize']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/summarize/);
  });

  it('rejects an unknown strategy', () => {
    const r = run([chatFile, '--max', '10000', '--strategy', 'bogus']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/bogus/i);
  });

  it('renders --diff with kept and dropped markers', () => {
    const r = run([chatFile, '--max', '20', '--strategy', 'drop-oldest', '--diff']);
    expect(r.code).toBe(0);
    // Diff lines start with '+' for kept and '−' (U+2212) for dropped.
    expect(r.stdout).toMatch(/\+ /);
    expect(r.stdout).toMatch(/− /);
    // Summary line goes to stderr.
    expect(r.stderr).toMatch(/drop-oldest/);
  });

  it('honors --per-message 0 instead of snapping to default', () => {
    // 'hi' (2 chars) → 1 token via Math.ceil(2/4). With --per-message 0 the budget
    // accounting uses no overhead, so tokensUsed should be 1, not 5.
    const input = JSON.stringify([{ role: 'user', content: 'hi' }]);
    const r = run(['--max', '1000', '--json', '--per-message', '0'], input);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.tokensUsed).toBe(1);
  });

  it('honors --head 0 instead of snapping to 1', () => {
    // With --head 0 and --tail 1, only the most recent non-sticky message survives.
    // The old `Number(opts.head) || 1` would have turned 0 into 1, keeping 2 messages.
    const input = JSON.stringify([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'middle' },
      { role: 'user', content: 'last' },
    ]);
    const r = run(
      ['--max', '10000', '--json', '--strategy', 'head-tail', '--head', '0', '--tail', '1'],
      input,
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.messages.map((m: { content: string }) => m.content)).toEqual(['last']);
  });
});
