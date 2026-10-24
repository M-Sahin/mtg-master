// Tiny streaming client for the Anthropic Messages API (no SDK dependency).
// Docs: https://docs.claude.com/en/api/messages-streaming

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "thinking"; thinking: string; signature?: string };

export interface AssistantMessage {
  content: ContentBlock[];
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}

export interface StreamHandlers {
  onText?(delta: string): void;
  onToolStart?(index: number, id: string, name: string): void;
  onToolInput?(index: number, name: string, accumulated: string): void;
  onToolDone?(index: number, block: ContentBlock & { type: "tool_use" }): void;
}

export interface MessageParams {
  model: string;
  max_tokens: number;
  system: any;
  messages: any[];
  tools?: readonly any[];
}

export type ModelCaller = (params: MessageParams, handlers: StreamHandlers, signal?: AbortSignal) => Promise<AssistantMessage>;

export class ModelError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Parse an SSE byte stream into {event, data} objects. */
export async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}

/** Assemble an assistant message from Messages-API stream events, calling handlers along the way. */
export async function consumeStream(events: AsyncIterable<{ event: string; data: string }>, h: StreamHandlers): Promise<AssistantMessage> {
  const blocks: any[] = [];
  const json: string[] = [];
  const msg: AssistantMessage = { content: [], stop_reason: null };
  let stopped = false;
  for await (const { data } of events) {
    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    switch (ev.type) {
      case "message_start":
        msg.usage = ev.message?.usage;
        break;
      case "content_block_start": {
        const b = { ...ev.content_block };
        blocks[ev.index] = b;
        if (b.type === "tool_use") {
          json[ev.index] = "";
          h.onToolStart?.(ev.index, b.id, b.name);
        }
        break;
      }
      case "content_block_delta": {
        const b = blocks[ev.index];
        const d = ev.delta;
        if (d.type === "text_delta") {
          b.text = (b.text ?? "") + d.text;
          h.onText?.(d.text);
        } else if (d.type === "input_json_delta") {
          json[ev.index] += d.partial_json;
          h.onToolInput?.(ev.index, b.name, json[ev.index]);
        } else if (d.type === "thinking_delta") {
          b.thinking = (b.thinking ?? "") + d.thinking;
        } else if (d.type === "signature_delta") {
          b.signature = d.signature;
        }
        break;
      }
      case "content_block_stop": {
        const b = blocks[ev.index];
        if (b?.type === "tool_use") {
          try {
            b.input = json[ev.index] ? JSON.parse(json[ev.index]) : {};
          } catch {
            b.input = { __invalid_json: json[ev.index] };
          }
          h.onToolDone?.(ev.index, b);
        }
        break;
      }
      case "message_delta":
        if (ev.delta?.stop_reason) msg.stop_reason = ev.delta.stop_reason;
        if (ev.usage) msg.usage = { ...msg.usage, ...ev.usage };
        break;
      case "message_stop":
        stopped = true;
        break;
      case "error": {
        const type = ev.error?.type ?? "";
        throw new ModelError(ev.error?.message ?? "Model stream error", type === "overloaded_error" ? 529 : type === "rate_limit_error" ? 429 : 500);
      }
    }
  }
  if (!stopped) throw new ModelError("The response stream ended early", 503);
  msg.content = blocks.filter(Boolean);
  return msg;
}

const retryable = (status: number) => status === 429 || status === 529 || status >= 500;

export function anthropicCaller(apiKey: string): ModelCaller {
  return async (params, handlers, signal) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      let wait = 1500 * (attempt + 1);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ ...params, stream: true }),
        });
        if (res.ok && res.body) return await consumeStream(sseEvents(res.body), handlers);
        const text = await res.text().catch(() => "");
        let message = text;
        try {
          message = JSON.parse(text).error?.message ?? text;
        } catch {}
        lastErr = new ModelError(`Claude API ${res.status}: ${message}`.slice(0, 400), res.status);
        if (!retryable(res.status)) break;
        wait = Math.max(wait, (Number(res.headers.get("retry-after")) || 0) * 1000);
      } catch (e) {
        if (signal?.aborted) throw e;
        lastErr = e;
        // mid-stream overload or a dropped stream: retry; anything else is final
        if (!(e instanceof ModelError) || !retryable(e.status)) break;
      }
      await new Promise((r) => setTimeout(r, Math.min(wait, 10000)));
    }
    throw lastErr;
  };
}
