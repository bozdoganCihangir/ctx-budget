import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

function run(args: string[], stdin?: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync('node', [DIST, ...args], {
      input: stdin,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf8') ?? ''),
      code: e.status ?? 1,
    };
  }
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

  it('prints version', () => {
    const r = run(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/0\.1\.0/);
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
