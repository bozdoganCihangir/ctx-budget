# ctx-budget

> **Tokenizer-aware chat-history fitter.** Trims, windows, or summarizes old messages so your conversation fits the model's context window — with a full audit log of every kept, dropped, and summarized message.

[![npm](https://img.shields.io/npm/v/ctx-budget.svg)](https://www.npmjs.com/package/ctx-budget)
[![types](https://img.shields.io/npm/types/ctx-budget.svg)](https://www.npmjs.com/package/ctx-budget)
[![license](https://img.shields.io/npm/l/ctx-budget.svg)](./LICENSE)
[![bundle](https://img.shields.io/bundlephobia/minzip/ctx-budget.svg)](https://bundlephobia.com/package/ctx-budget)

---

```ts
import { fit } from 'ctx-budget';
import { encode } from 'gpt-tokenizer';

const r = await fit(messages, {
  maxTokens: 8000,
  reserveForResponse: 1000,
  strategy: 'head-tail',
  countTokens: (t) => encode(t).length,
});

sendToModel(r.messages);

r.tokensUsed;     // 6841
r.dropped.length; // 12
r.fits;           // true
r.changes;        // ordered audit log: every kept / dropped / summarized / inserted action
```

Zero runtime dependencies. Bring your own tokenizer (`gpt-tokenizer`, `tiktoken`, anything callable). Falls back to a `chars / 4` estimator if you don't.

## When you'd use this

`ctx-budget` keeps a chat conversation under a model's context limit by deciding which old messages to evict, with a strategy you choose. It is most useful when:

- you're building a **chat product** where conversations grow until they break the context window
- you use **tool calls** and need the assistant's `tool_calls` message kept together with its `tool` responses during eviction (the package does this automatically)
- you want **explainable** trimming — every dropped message recorded with a reason, so debugging "why did the model lose context" is one line
- you want to **summarize on overflow** with a callback you control (your model, your prompt) instead of being locked into a framework's choice

It is **not**:

- a vector store, retriever, or embeddings library — pair it with one if you need semantic recall over arbitrary-old history
- an LLM client — it never calls a model itself; you wire the summarizer

## Install

```sh
npm i ctx-budget
```

Node 18+. ESM and CJS, types included.

## Quick start

### Library

```ts
import { fit } from 'ctx-budget';

const result = await fit(messages, {
  maxTokens: 8000,
  reserveForResponse: 1000,
  strategy: 'head-tail',
});

console.log(`${result.tokensBefore} → ${result.tokensUsed} / ${result.tokensBudget}`);
console.log(`kept ${result.messages.length}, dropped ${result.dropped.length}`);

for (const d of result.dropped) {
  console.log(`  #${d.index} ${d.reason}: ${d.message.content?.slice(0, 60)}`);
}
```

### Stateful buffer

```ts
import { ChatBuffer } from 'ctx-budget';

const buf = new ChatBuffer({
  maxTokens: 8000,
  reserveForResponse: 1000,
  strategy: 'head-tail',
  countTokens: (t) => encode(t).length,
});

buf.push({ role: 'system', content: 'You are a helpful assistant.' });
buf.push({ role: 'user', content: 'Hi!' });
// …later
buf.push({ role: 'user', content: latestUserMessage });

const r = await buf.fit();
sendToModel(r.messages);
```

The buffer holds the **full** unedited history; each `fit()` call re-runs the strategy against everything, so pinning, sticky predicates, and summarization always see the complete picture. A previous fit never permanently destroys older context — it's a view, not a mutation.

### CLI

```sh
# fit a JSONL chat log to 8k tokens minus 1k for the reply
ctx-budget chat.jsonl --max 8000 --reserve 1000 --strategy head-tail

# show a colored kept/dropped diff
ctx-budget chat.jsonl --max 4000 --diff

# emit the full FitResult as JSON for tooling
cat chat.jsonl | ctx-budget --max 8000 --json
```

## How fit works

The pipeline runs in five stages:

1. **Group.** Walk the input. An assistant message with `tool_calls` is bundled with the immediately-following `role: 'tool'` messages whose `tool_call_id` matches one of its calls. All other messages become singleton groups. **A group is atomic** — strategies keep or drop a group as a whole, so a tool call is never orphaned from its result.
2. **Score.** For every group, compute its token cost as `sum(perMessageOverhead + countTokens(getText(msg)))` over its messages.
3. **Mark sticky.** A group is sticky if any message in it satisfies the `sticky` predicate (default: `role === 'system'` or `pinned === true`). Sticky groups are always kept.
4. **Run strategy.** The strategy receives `(groups, ctx)` and returns a `keep` set + a `drops` map of `{ groupIndex → reason }`. Optionally a `summary` message and an insertion hint.
5. **Assemble.** Walk the input in original order, emit kept messages and drop records, insert the summary (if any) just before the first non-sticky kept group. Compute final `tokensUsed` and set `fits = tokensUsed <= tokensBudget`.

`fit()` is always async. Most strategies do no I/O and resolve in the same microtask, but `summarize` awaits your user callback — making the whole API consistent.

## Strategies

```ts
fit(messages, { strategy: 'head-tail' }) // default
```

| Strategy | What it does | Cost |
| --- | --- | --- |
| `head-tail` (default) | Keep all sticky + the first `keep.head` non-sticky groups (default 1) + the most recent non-sticky groups that fit. The first user message usually carries task framing; recent messages carry working context. Dropping the middle preserves both. | O(n) |
| `drop-oldest` | Keep all sticky; drop the oldest non-sticky groups until the rest fit. Classic FIFO eviction. | O(n) |
| `sliding-window` | Keep all sticky + the last `windowSize` non-sticky groups (default 10), regardless of token count. If the kept window still exceeds budget, additionally drop oldest from the kept window with reason `over-budget`. Use when your eviction policy is a message count, not a token count. | O(n) |
| `summarize` | Same eviction shape as `drop-oldest`, but the dropped messages are passed to your `summarize` callback and the returned text is inserted as a single message at the front of the non-sticky region. Requires a callback. | O(n) + 1 LLM call |

### head-tail in detail

```
Input (10 msgs, budget tight enough that mid drops):

  [sys] [u1] [a1] [u2] [a2] [u3] [a3] [u4] [a4] [u5]
   ▲     ▲                                         ▲
   sticky head=1                              tail (fills greedily)

Output:

  [sys] [u1]               [a3] [u4] [a4] [u5]
                ↑ middle dropped as 'over-budget'
```

If `keep.tail` is set, only that many tail messages are considered. Otherwise the strategy fills greedily from newest until the next message wouldn't fit.

### Tool-call pair atomicity

OpenAI-style tool-call clusters are treated as atomic groups by every strategy. Concretely, this assistant + tool sequence:

```jsonc
{ "role": "assistant", "tool_calls": [{ "id": "c1", ... }, { "id": "c2", ... }] }
{ "role": "tool", "tool_call_id": "c1", "content": "..." }
{ "role": "tool", "tool_call_id": "c2", "content": "..." }
```

…becomes a single 3-message group. It is kept or dropped as one unit. You will never end up with an orphaned `tool` message that breaks the next API call.

### Sticky messages

Sticky messages are never evicted. By default this is `role === 'system'` plus any message with `pinned: true`. Sticky also propagates to whole groups: if any message in a tool-call cluster is sticky, the entire cluster is kept.

```ts
// pin a single message
messages.push({ role: 'user', content: 'IMPORTANT: deadline is Friday', pinned: true });

// or supply a custom predicate
await fit(messages, {
  maxTokens: 8000,
  sticky: (msg) => msg.role === 'system' || msg.id === 'task-statement',
});
```

If sticky messages alone exceed the budget, they are still returned (in original order), but `result.fits` is `false`. Use this as a signal that the system prompt is too long.

## Tokenizer setup

By default, `ctx-budget` uses `Math.ceil(text.length / 4)` (OpenAI's chars-per-token rule of thumb) and adds a `perMessageOverhead` of 4 tokens per message for role markers / separators. For accurate counts, plug in any tokenizer that exposes a `(text) => count` function.

### `gpt-tokenizer` (OpenAI, pure JS)

```ts
import { encode } from 'gpt-tokenizer';
import { fit } from 'ctx-budget';

await fit(messages, {
  maxTokens: 8000,
  countTokens: (t) => encode(t).length,
});
```

### `tiktoken` (OpenAI, WASM)

```ts
import { encoding_for_model } from 'tiktoken';

const enc = encoding_for_model('gpt-4o');
await fit(messages, {
  maxTokens: 8000,
  countTokens: (t) => enc.encode(t).length,
});
```

### `@anthropic-ai/tokenizer` (Claude)

```ts
import { countTokens as anthropicCount } from '@anthropic-ai/tokenizer';

await fit(messages, {
  maxTokens: 200_000,
  countTokens: (t) => anthropicCount(t),
});
```

### `llama-tokenizer-js` (Llama / Mistral)

```ts
import LlamaTokenizer from 'llama-tokenizer-js';

await fit(messages, {
  maxTokens: 32000,
  countTokens: (t) => LlamaTokenizer.encode(t).length,
});
```

### Per-message overhead

The exact OpenAI accounting is roughly **3 tokens per message** for role markers, **1 extra token if `name` is present**, and **3 priming tokens** for the assistant reply. The package's defaults approximate this with `perMessageOverhead: 4`. Tune both as needed:

```ts
await fit(messages, {
  maxTokens: 8000,
  reserveForResponse: 3,        // OpenAI assistant priming
  perMessageOverhead: 3,        // exact OpenAI per-message overhead
  countTokens: (t) => encode(t).length,
});
```

For most apps the defaults are within a couple of percent of the real number — leave them and add a small `reserveForResponse` to absorb the slop.

## Summarization

The `summarize` strategy decides what to drop the same way `drop-oldest` does — but instead of discarding the dropped messages, it hands them to a callback you provide and inserts the returned text as a single new message at the front of the non-sticky region.

```ts
import OpenAI from 'openai';
const ai = new OpenAI();

const result = await fit(messages, {
  maxTokens: 8000,
  reserveForResponse: 1000,
  strategy: 'summarize',
  countTokens: (t) => encode(t).length,
  summarize: async (dropped) => {
    const r = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Summarize this chat history in 4-6 sentences. ' +
            'Preserve concrete facts, names, decisions, and any open questions.',
        },
        ...dropped,
      ],
    });
    return r.choices[0].message.content!;
  },
});
```

### Budgeting the summary itself

The summary message also costs tokens. Before deciding what to drop, the strategy reserves `summaryReserve` tokens (default 200). After your callback returns, if the actual summary exceeds the reserve, the strategy evicts more messages from the kept set (also tagged `summarized`) until the result fits.

If your summarizer tends to return long output, raise `summaryReserve`:

```ts
await fit(messages, {
  // …
  strategy: 'summarize',
  summaryReserve: 500,
  summarize: yourCallback,
});
```

### Summary placement

The summary is inserted **before the first non-sticky kept group**, so it sits between your real system prompt and the remaining conversation. Customize the role and prefix:

```ts
await fit(messages, {
  // …
  strategy: 'summarize',
  summaryRole: 'system',                                   // default
  summaryPrefix: '[Earlier conversation summary]\n',       // default
  summarize: yourCallback,
});
```

If there are no non-sticky kept messages (everything was summarized), the summary is appended at the end.

## API

```ts
function fit(messages: ChatMessage[], options: FitOptions): Promise<FitResult>;

interface FitOptions {
  /** Hard ceiling. Budget is `maxTokens - reserveForResponse`. */
  maxTokens: number;
  /** Tokens to leave free for the model's reply. Default 0. */
  reserveForResponse?: number;
  /** Custom token counter. Default: `chars / 4`. */
  countTokens?: (text: string) => number;
  /** Per-message overhead (role markers, separators). Default 4 (OpenAI-ish). */
  perMessageOverhead?: number;
  /** Fit strategy. Default `'head-tail'`. */
  strategy?: 'head-tail' | 'drop-oldest' | 'sliding-window' | 'summarize';
  /** head-tail only: head/tail counts. tail undefined = greedy. */
  keep?: { head?: number; tail?: number };
  /** sliding-window only: window size. Default 10. */
  windowSize?: number;
  /** Predicate for never-evict messages. Default: system + pinned. */
  sticky?: (msg: ChatMessage, index: number) => boolean;
  /** Required by 'summarize'. Receives dropped messages oldest-first. */
  summarize?: (msgs: ChatMessage[]) => string | Promise<string>;
  /** Role for the inserted summary. Default 'system'. */
  summaryRole?: 'system' | 'user' | 'assistant';
  /** Prepended to the summary text. Default '[Earlier conversation summary]\n'. */
  summaryPrefix?: string;
  /** Token reserve for the summary itself. Default 200. */
  summaryReserve?: number;
  /** Custom message → text adapter. Default reads content/name/tool_calls/tool_call_id. */
  getText?: (msg: ChatMessage) => string;
}

interface FitResult {
  /** Messages ready to send to the model, in order. */
  messages: ChatMessage[];
  /** Removed messages, in original order. */
  dropped: DroppedRecord[];
  /** Synthesized summary, if 'summarize' fired. Else null. */
  summary: ChatMessage | null;
  /** Token count of the returned `messages`. */
  tokensUsed: number;
  /** Effective budget — maxTokens minus reserveForResponse. */
  tokensBudget: number;
  /** Token count of the input. */
  tokensBefore: number;
  /** True if tokensUsed <= tokensBudget. False only when sticky alone overflows. */
  fits: boolean;
  /** Ordered audit log: every kept, dropped, summarized, and inserted-summary action. */
  changes: ChangeRecord[];
  strategy: 'head-tail' | 'drop-oldest' | 'sliding-window' | 'summarize';
}

interface DroppedRecord {
  message: ChatMessage;
  index: number;                            // position in the input
  reason: 'over-budget' | 'summarized' | 'window';
  tokens: number;
}

interface ChangeRecord {
  action: 'kept' | 'dropped' | 'summarized' | 'inserted-summary';
  index: number;                            // -1 for inserted-summary
  reason?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  pinned?: boolean;                         // never-evict marker
  id?: string;                              // optional stable id, for tracking only
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
```

`ChatBuffer` is a thin stateful wrapper:

```ts
class ChatBuffer {
  constructor(options: FitOptions, initial?: ChatMessage[]);
  push(msg: ChatMessage): this;
  pushAll(msgs: ChatMessage[]): this;
  setMessages(msgs: ChatMessage[]): this;
  setOptions(options: FitOptions): this;
  fit(): Promise<FitResult>;
  clear(): this;
  get messages(): ChatMessage[];           // returns a copy
  get options(): FitOptions;
}
```

Helpers:

```ts
import { countTokens } from 'ctx-budget';

countTokens(messages, {
  countTokens: (t) => encode(t).length,
  perMessageOverhead: 4,
});
```

## Custom message shapes

By default the package reads OpenAI-shaped messages. If you have a different shape, pass `getText` to project a message into a string for token counting:

```ts
await fit(messages, {
  maxTokens: 8000,
  getText: (m) => `${m.author}: ${m.text}`,
});
```

You'll still need to map your messages to the `ChatMessage` shape (role + content) so eviction can run, but extra fields can live on the same object — the package only reads what it needs and passes the original through unchanged.

## CLI reference

```
ctx-budget [file] [options]

  --max <n>            max tokens (required)
  --reserve <n>        tokens to reserve for the model response (default: 0)
  --strategy <s>       drop-oldest | head-tail | sliding-window (default: head-tail)
  --head <n>           head messages to keep (head-tail; default: 1)
  --tail <n>           tail messages to keep (head-tail; default: greedy)
  --window <n>         window size (sliding-window; default: 10)
  --per-message <n>    per-message overhead in tokens (default: 4)
  --json               emit full FitResult as JSON
  --diff               show kept/dropped messages with reasons
  --version
  --help
```

The CLI accepts JSONL (one OpenAI-shaped message per line) or a JSON array. Default output is JSONL of the kept messages on stdout, with a one-line summary on stderr if writing to a TTY. The `summarize` strategy is library-only because it requires a callback.

Examples:

```sh
# pipe a chat log through, write the fitted JSONL to a file
cat chat.jsonl | ctx-budget --max 8000 --reserve 1000 > fitted.jsonl

# inspect what would be dropped at a tight budget
ctx-budget chat.jsonl --max 1500 --strategy drop-oldest --diff

# get a structured result you can grep
ctx-budget chat.jsonl --max 4000 --json | jq '.dropped | length'
```

## Benchmarks

Run `npm run bench` to reproduce locally — the script generates synthetic conversations of 100, 500, and 1000 messages and runs each non-summarize strategy 50 times.

**On an Apple-silicon MacBook (default `chars / 4` tokenizer):**

| Messages | head-tail | drop-oldest | sliding-window |
| ---: | ---: | ---: | ---: |
| 100 | ~0.04 ms | ~0.07 ms | ~0.05 ms |
| 500 | ~0.11 ms | ~0.12 ms | ~0.09 ms |
| 1000 | ~0.17 ms | ~0.19 ms | ~0.20 ms |

**The honest read:** at any conversation size you'll realistically have, fitting is essentially free. The cost of a real call is dominated by your `countTokens` callback. With `tiktoken` (WASM), expect the tokenizer alone to add a few ms per kilochar of input — most of `fit()`'s wall time will be spent inside it.

If you call `fit()` on every keystroke (don't), or on a hot path, prefer:

- `gpt-tokenizer` (pure JS, ~2× faster than `tiktoken` for small inputs) over `tiktoken` (WASM)
- caching token counts per message (the package recomputes per call; `ChatBuffer` does not memoize either, by design)
- `sliding-window` if your eviction policy is "last N messages" — it skips token counting on the part of history outside the window

## FAQ

**Does this call any LLM?** No. Even the `summarize` strategy uses a callback you provide — your model, your prompt, your cost. The package has zero runtime dependencies and no network code.

**Will this drop my system prompt?** No. System messages are sticky by default. If your system prompt alone exceeds the budget, `result.fits` is `false`, and `result.messages` will still contain the system messages so you can surface a meaningful error to the user. Add `pinned: true` to make any other message non-evictable.

**Why is the token count slightly different from my real tokenizer?** Because by default `ctx-budget` uses `chars / 4` as a free estimator and adds a per-message overhead of 4. Pass your real tokenizer via `countTokens` and tune `perMessageOverhead` (OpenAI's exact accounting is roughly 3 + 1 if `name`). Fold OpenAI's 3-token assistant priming into `reserveForResponse`.

**My tool calls keep getting orphaned.** Make sure you're passing standard OpenAI shape: an assistant message with `tool_calls: [{id, ...}]` followed **immediately** by `tool` messages with matching `tool_call_id`. The package detects these clusters and treats each as an atomic group. If your tool responses aren't contiguous after the assistant message, the grouping won't pick them up — file an issue with a sample.

**Is this stateful?** `fit()` is a pure function. `ChatBuffer` is a small stateful wrapper that holds your full history and re-runs `fit()` on demand. There is no implicit eviction — calling `push()` does not modify the buffer's history, and a previous `fit()` does not lose context for the next one.

**Can I use this with LangChain / LlamaIndex / Vercel AI SDK?** Yes — `fit()` is a pure function over `{role, content}[]`. Map your framework's message type to `ChatMessage`, call `fit`, send the result to the model. The package deliberately stays framework-agnostic.

**How do I persist a buffer across requests?** Serialize `buf.messages` (it returns a copy) — that's all the state. Function options like `summarize` and `countTokens` are wired in code, not data, so reconstruct them on the other side and pass them to a new `ChatBuffer(options, savedMessages)`.

**Can I add my own strategy?** Not via the public API in v0.1. If you need more than the four built-ins, fork the strategy registry locally — strategies are tiny (`(groups, ctx) => StrategySelection`) and the API is stable. A formal `customStrategies` option is on the roadmap.

**The summary message's role is `system`. Won't OpenAI complain about multiple system messages?** OpenAI accepts multiple system messages, but if you'd rather keep a single system message, set `summaryRole: 'user'` (with a clear prefix in `summaryPrefix`) or `summaryRole: 'assistant'` (less common). The package never reorders your real system messages.

## Roadmap

- **v0.2** — token-aware tie-breaking: when two strategies leave a tie, prefer the lower-token group. Currently strategies only consider position.
- **v0.3** — first-class Anthropic-shaped messages (tool-use blocks inside `content`), so you don't have to flatten before calling.
- **v0.4** — incremental summarization: when a previous summary already exists, fold new dropped messages into it via the same callback instead of re-summarizing the world.
- **v0.5** — `customStrategies` option for plugging in your own eviction logic.
- **future** — embedding-based semantic ranking as an opt-in strategy. Will require an embedding callback. Out of scope for v1.

## Contributing

Bug reports and PRs welcome. The most useful contributions:

- **New tokenizer integrations** added to the README's Tokenizer setup section.
- **Strategy edge cases**: a failing test that demonstrates the prior behavior was wrong is the gold standard.
- **Anonymized real-world chat logs** that exhibit interesting eviction behavior — they become test fixtures and benchmark inputs.

To work on the package:

```sh
git clone https://github.com/CihangirBozdogan/ctx-budget.git
cd ctx-budget
npm install
npm test
npm run lint
npm run build
```

## Author

**Cihangir Bozdogan** — [bozdogan.cihangir@gmail.com](mailto:bozdogan.cihangir@gmail.com)

## License

MIT © 2026 — see [LICENSE](./LICENSE).
