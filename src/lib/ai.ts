import { getChatCredential } from "@/lib/secureApiKeys";
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/** When running the local build, point QUINN at the bundled Node API server. */
const BUILD_LOCAL_API = (import.meta.env.VITE_QUINN_LOCAL_API as string | undefined) || "";
const STORED_LOCAL_API =
  typeof localStorage !== "undefined" ? (localStorage.getItem("quinn_local_api") || localStorage.getItem("exile_local_api") || "") : "";

/** Resolved at runtime — the build-time var is baked in, so it is empty in downloaded builds. */
export let LOCAL_API = (BUILD_LOCAL_API || STORED_LOCAL_API).replace(/\/$/, "");

export function setLocalApi(url: string) {
  LOCAL_API = url.replace(/\/$/, "");
  try {
    if (LOCAL_API) localStorage.setItem("quinn_local_api", LOCAL_API);
    else localStorage.removeItem("quinn_local_api");
  } catch {
    /* storage blocked */
  }
}

const CANDIDATES = [8787, 8788, 8789].map((p) => `http://127.0.0.1:${p}`);

let detection: Promise<string> | null = null;

/** Probes /health on the usual local ports so the UI finds the server without env vars. */
export function detectLocalApi(force = false): Promise<string> {
  if (detection && !force) return detection;
  detection = (async () => {
    const tries = LOCAL_API ? [LOCAL_API, ...CANDIDATES] : CANDIDATES;
    for (const base of tries) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(`${base}/health`, { signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) {
          setLocalApi(base);
          return LOCAL_API;
        }
      } catch {
        /* not running on this port */
      }
    }
    setLocalApi("");
    return "";
  })();
  return detection;
}

const CLOUD_FUNCTION_ALIASES: Record<string, string> = {
  "quinn-chat": "exile-chat",
  "quinn-analyze": "exile-analyze",
  "quinn-image": "exile-image",
  "quinn-health": "exile-health",
  "quinn-phone": "exile-phone",
};

export function endpoint(fn: string) {
  if (LOCAL_API) return `${LOCAL_API}/${fn}`;
  const cloudFunction = CLOUD_FUNCTION_ALIASES[fn] || fn;
  return `${SUPABASE_URL}/functions/v1/${cloudFunction}`;
}

export function authHeaders(): Record<string, string> {
  return LOCAL_API
    ? { "Content-Type": "application/json" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_KEY}` };
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type AiFaultCode =
  | "rate_limited"
  | "no_credits"
  | "unconfigured"
  | "network"
  | "timeout"
  | "aborted"
  | "protocol"
  | "server";

export class AiError extends Error {
  code: AiFaultCode;
  status: number;
  retryable: boolean;

  constructor(code: AiFaultCode, message: string, status = 0) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
    this.retryable = code === "network" || code === "timeout" || code === "server" || code === "rate_limited";
  }
}

function classify(status: number, body: string): AiError {
  if (status === 429) return new AiError("rate_limited", "Reasoning core is rate limited. Retrying shortly.", status);
  if (status === 402) return new AiError("no_credits", "AI credits exhausted. Top up to restore cloud reasoning.", status);
  if (status === 401 || status === 403) return new AiError("unconfigured", "Reasoning core rejected the credentials.", status);
  if (status >= 500) return new AiError("server", `Reasoning core fault (HTTP ${status}).`, status);
  return new AiError("server", body?.slice(0, 200) || `HTTP ${status}`, status);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractStreamText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
      const item = part as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
    }
    return "";
  }).join("");
}



/** Fetch with a hard timeout, honouring an optional caller abort signal. */
async function timedFetch(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const onAbort = () => ctl.abort(new DOMException("aborted", "AbortError"));
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError") throw new AiError("timeout", "Reasoning core did not respond in time.");
    if (name === "AbortError") throw new AiError("aborted", "Directive cancelled.");
    throw new AiError("network", "Cannot reach the reasoning core.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export type ModelTier = "fast" | "deep";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface StreamOptions {
  /** Called once the stream ends if the model asked for tools instead of answering. */
  onToolCalls?: (calls: ToolCall[]) => void;
  signal?: AbortSignal;
  /** Total attempts for retryable faults. Default 3. */
  attempts?: number;
  timeoutMs?: number;
}

interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

export async function streamChat(
  fn: "quinn-chat" | "quinn-analyze",
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
  opts: StreamOptions = {},
): Promise<string> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const timeoutMs = opts.timeoutMs ?? 90_000;

  // Discover the local API before selecting the chat endpoint in desktop/local builds.
  const isLocalApp =
    typeof window !== "undefined" &&
    (window.location.protocol === "file:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  if (!LOCAL_API && isLocalApp) {
    await detectLocalApi(true);
  }

  let lastError: AiError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const requestBody: Record<string, unknown> = { ...body };

      // Device-owned credentials are attached only to cloud chat requests.
      // Local/desktop requests retain their existing API-key handling.
      if (!LOCAL_API && fn === "quinn-chat") {
        const credential = await getChatCredential();
        if (credential) {
          requestBody.provider = credential.provider;
          requestBody.providerKey = credential.providerKey;
        }
      }

      const res = await timedFetch(
        endpoint(fn),
        { method: "POST", headers: authHeaders(), body: JSON.stringify(requestBody) },
        timeoutMs,
        opts.signal,
      );

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        let msg = text;
        try {
          msg = JSON.parse(text).error ?? text;
        } catch {
          /* plain text body */
        }
        throw classify(res.status, msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
      const partials = new Map<number, PartialToolCall>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buf += decoder.decode();
          if (buf && !buf.endsWith("\n")) buf += "\n";
        } else {
          buf += decoder.decode(value, { stream: true });
        }
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            const choice = j.choices?.[0];
            const delta = choice?.delta ?? {};
            const content = extractStreamText(
              delta.content ?? choice?.message?.content ?? choice?.text ?? j.output_text,
            );
            if (content) {
              full += content;
              onDelta(content);
            }

            const toolUpdates = delta.tool_calls ?? choice?.message?.tool_calls ?? [];
            for (const tc of toolUpdates) {
              const idx = tc.index ?? partials.size;
              const cur = partials.get(idx) ?? {
                id: tc.id ?? `call_${idx}`,
                name: "",
                args: "",
              };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name += tc.function.name;
              const argsPart = tc.function?.arguments;
              if (typeof argsPart === "string") cur.args += argsPart;
              else if (argsPart && typeof argsPart === "object") cur.args = JSON.stringify(argsPart);
              partials.set(idx, cur);
            }
          } catch (error) {
            throw new AiError(
              "protocol",
              `Failed to parse SSE frame: ${(error as Error).message}`,
            );
          }
        }
        if (done) break;
      }

      if (partials.size && !opts.onToolCalls) {
        throw new AiError("protocol", "The AI requested a tool action that this chat interface cannot execute.");
      }

      if (partials.size && opts.onToolCalls) {
        const calls: ToolCall[] = [...partials.values()]
          .filter((p) => p.name)
          .map((p) => {
            let parsed: unknown;
            try {
              parsed = p.args ? JSON.parse(p.args) : {};
            } catch (error) {
              throw new AiError(
                "protocol",
                `Invalid arguments for tool "${p.name}": ${String(error)}`,
              );
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new AiError(
                "protocol",
                `Tool "${p.name}" arguments must be a JSON object.`,
              );
            }
            const args = parsed as Record<string, unknown>;
            return { id: p.id, name: p.name, args };
          });
        if (calls.length) opts.onToolCalls(calls);
      }

      if (!full.trim() && partials.size === 0) {
        throw new AiError(
          "protocol",
          "The AI provider ended the stream without text or tool calls. Check the cloud provider configuration.",
        );
      }

      return full;
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("network", (e as Error).message);
      lastError = err;
      if (!err.retryable || attempt === attempts) throw err;
      await sleep(400 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new AiError("server", "Unknown reasoning fault.");
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

export async function streamImage(
  prompt: string,
  onFrame: (dataUrl: string, isFinal: boolean) => void,
  model?: string,
): Promise<void> {
  // Desktop and localhost image generation must use the local model API.
  const isLocalApp =
    typeof window !== "undefined" &&
    (window.location.protocol === "file:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  let imageEndpoint: string;
  let imageHeaders: Record<string, string>;

  if (isLocalApp) {
    const localApi = await detectLocalApi(true);

    if (!localApi) {
      throw new AiError(
        "network",
        "Local image server is unavailable. Start the QUINN AI desktop app and make sure its local API is running on port 8787.",
      );
    }

    imageEndpoint = `${localApi}/quinn-image`;
    imageHeaders = { "Content-Type": "application/json" };
  } else {
    // Hosted web builds retain their existing configured image endpoint.
    imageEndpoint = endpoint("quinn-image");
    imageHeaders = authHeaders();
  }

  const res = await timedFetch(
    imageEndpoint,
    {
      method: "POST",
      headers: imageHeaders,
      body: JSON.stringify({ prompt, model }),
    },
    390_000,
  );

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {
      /* plain text body */
    }
    throw classify(res.status, msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let sawFinal = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "";
      let dataStr = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
      }
      if (!dataStr || dataStr === "[DONE]") continue;
      try {
        const p = JSON.parse(dataStr);
        if (event === "error" || p?.type === "error") throw new Error(p?.error?.message || "Image generation failed");
        if (p?.b64_json) {
          const isFinal = event === "image_generation.completed" || p.type === "image_generation.completed";
          onFrame(`data:image/png;base64,${p.b64_json}`, isFinal);
          if (isFinal) sawFinal = true;
        }
      } catch (e) {
        if ((e as Error).message !== "Unexpected end of JSON input") throw e;
      }
    }
  }
  if (!sawFinal) throw new AiError("server", "Image stream ended without a final frame");
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
