import { runFit } from './core/engine.js';
import type { ChatMessage, FitOptions, FitResult } from './types.js';

/**
 * A small stateful wrapper around `fit()` for chat apps. Push messages as they arrive;
 * call `fit()` to get a budget-fitting view to send to the model.
 *
 * The buffer holds the **full** unedited history. Each `fit()` call re-runs the
 * configured strategy against the full history, so a previous fit never permanently
 * destroys older context — pinning, sticky predicates, and summarization all behave
 * predictably.
 *
 * For persistence, serialize `messages` and `options` (without function callbacks)
 * yourself, then construct a new `ChatBuffer` on the other side.
 */
export class ChatBuffer {
  private _messages: ChatMessage[];
  private _options: FitOptions;

  constructor(options: FitOptions, initial: ChatMessage[] = []) {
    this._options = options;
    this._messages = initial.slice();
  }

  /** Append a message. Does not trigger a fit — call `fit()` to refresh. */
  push(msg: ChatMessage): this {
    this._messages.push(msg);
    return this;
  }

  /** Append several messages. */
  pushAll(msgs: ChatMessage[]): this {
    for (const m of msgs) this._messages.push(m);
    return this;
  }

  /** Replace all messages. */
  setMessages(msgs: ChatMessage[]): this {
    this._messages = msgs.slice();
    return this;
  }

  /** Update options (does not refit). */
  setOptions(options: FitOptions): this {
    this._options = options;
    return this;
  }

  /** All messages currently in the buffer (unedited). */
  get messages(): ChatMessage[] {
    return this._messages.slice();
  }

  /** Current options. */
  get options(): FitOptions {
    return this._options;
  }

  /** Run the strategy and return a fit result. */
  fit(): Promise<FitResult> {
    return runFit(this._messages, this._options);
  }

  /** Drop everything. */
  clear(): this {
    this._messages = [];
    return this;
  }
}
