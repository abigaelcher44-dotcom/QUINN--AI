// QUINN chat — streaming reasoning with client-executed tool calling and model tiering.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT =
  "You are QUINN AI, an intelligent personal assistant. Your AI. Your PC. Your rules. " +
  "Speak with dry wit and precision, address the user respectfully as Madam when appropriate, and stay concise unless depth is asked for.";

/** Client-executed tools. The browser runs them and returns results as role:"tool" messages. */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "open_section",
      description: "Open a panel of the QUINN interface for the operator.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: [
              "chat", "camera", "files", "voice", "whatsapp", "calls", "house", "car",
              "generate", "cinema", "docs", "research", "analysis", "contacts", "health",
              "audit", "apps", "system", "keys",
            ],
          },
        },
        required: ["section"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_device_status",
      description: "Read local device status: time, battery, network, platform.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description: "Store a durable fact about the operator in QUINN's persistent memory.",
      parameters: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_memory",
      description: "List everything QUINN remembers about the operator.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contacts",
      description: "List the operator's allocated contacts and agents.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp",
      description: "Sensitive. Open a WhatsApp message to a contact with prefilled text.",
      parameters: {
        type: "object",
        properties: { contact: { type: "string" }, message: { type: "string" } },
        required: ["contact", "message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_call",
      description: "Sensitive. Place a phone call to one of the operator's contacts.",
      parameters: {
        type: "object",
        properties: { contact: { type: "string" } },
        required: ["contact"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "house_command",
      description: "Sensitive. Control a smart-home entity (turn on, turn off, toggle).",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string" },
          action: { type: "string", enum: ["on", "off", "toggle"] },
        },
        required: ["entity", "action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Render an image from a prompt and show it on the HUD.",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  },
];

// Desktop-equivalent free-only routing: Gemini first, then OpenRouter if configured.
const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-3.6-flash"];

function usefulSseLine(line: string): boolean {
  if (!line.startsWith("data:")) return false;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return false;

  try {
    const choices = JSON.parse(data).choices ?? [];
    return choices.some((choice: any) =>
      (typeof choice.delta?.content === "string" && choice.delta.content.length > 0) ||
      (Array.isArray(choice.delta?.tool_calls) && choice.delta.tool_calls.length > 0) ||
      (typeof choice.message?.content === "string" && choice.message.content.length > 0)
    );
  } catch {
    return false;
  }
}

/**
 * Read only until the first useful SSE event.
 * This lets us retry another model before sending HTTP 200 to the phone.
 * Once useful data exists, the remaining response is streamed immediately.
 */
async function prepareUsefulStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const buffered: Uint8Array[] = [];
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      pending += decoder.decode();
      const delivered = pending.split(/\r?\n/).some(usefulSseLine);
      if (!delivered) return null;
      break;
    }

    if (!value?.byteLength) continue;

    buffered.push(value);
    pending += decoder.decode(value, { stream: true });

    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";

    if (lines.some(usefulSseLine)) break;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of buffered) controller.enqueue(chunk);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) controller.enqueue(value);
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return stream;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
    const useTools = requestBody.tools !== false;

    // A mobile owner may supply a key for this request. It is never persisted
    // by this function and is never written to logs. Environment fallback is
    // retained for existing deployments and older clients.
    const suppliedKey = typeof requestBody.providerKey === "string"
      ? requestBody.providerKey.trim()
      : "";
    const suppliedProvider = typeof requestBody.provider === "string"
      ? requestBody.provider.trim().toLowerCase()
      : "";

    const providers: Array<{
      id: string;
      key: string;
      base: string;
      models: string[];
    }> = [];

    if (suppliedKey) {
      if (suppliedProvider === "gemini") {
        providers.push({
          id: "gemini",
          key: suppliedKey,
          base: "https://generativelanguage.googleapis.com/v1beta/openai",
          models: GEMINI_MODELS,
        });
      } else if (suppliedProvider === "openrouter") {
        providers.push({
          id: "openrouter",
          key: suppliedKey,
          base: "https://openrouter.ai/api/v1",
          models: ["openrouter/free"],
        });
      } else {
        return new Response(JSON.stringify({
          error: "Unsupported provider. Use gemini or openrouter.",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const geminiKey = Deno.env.get("GEMINI_API_KEY");
      const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");

      if (geminiKey) {
        providers.push({
          id: "gemini",
          key: geminiKey,
          base: "https://generativelanguage.googleapis.com/v1beta/openai",
          models: GEMINI_MODELS,
        });
      }

      if (openRouterKey) {
        providers.push({
          id: "openrouter",
          key: openRouterKey,
          base: "https://openrouter.ai/api/v1",
          models: ["openrouter/free"],
        });
      }
    }

    if (!providers.length) {
      return new Response(JSON.stringify({
        error: "No chat provider key was supplied. Add a provider key in QUINN API Keys settings.",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const errors: string[] = [];

    for (const provider of providers) {
      for (const model of provider.models) {
        console.log(`[quinn] trying free model ${provider.id}/${model}`);

        try {
          const body: Record<string, unknown> = {
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              ...messages,
            ],
            stream: true,
          };

          if (useTools) {
            body.tools = TOOLS;
            body.tool_choice = "auto";
          }

          const upstream = await fetch(`${provider.base}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.key}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(45000),
          });

          if (!upstream.ok || !upstream.body) {
            const detail = (await upstream.text().catch(() => ""))
              .replaceAll(provider.key, "[redacted]")
              .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
              .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, "[redacted]")
              .replace(/[\r\n\t]+/g, " ")
              .slice(0, 180);

            errors.push(`${provider.id}/${model}: HTTP ${upstream.status} ${detail}`);
            continue;
          }

          const stream = await prepareUsefulStream(upstream.body);

          if (!stream) {
            errors.push(`${provider.id}/${model}: empty stream`);
            console.warn(`[quinn] ${provider.id}/${model} returned an empty stream; trying next model`);
            continue;
          }

          console.log(`[quinn] response streamed via ${provider.id}/${model}`);

          return new Response(stream, {
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "X-Quinn-Model": `${provider.id}/${model}`,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const safeMessage = message.replaceAll(provider.key, "[redacted]");
          errors.push(`${provider.id}/${model}: ${safeMessage}`);
        }
      }
    }

    console.error("[quinn] all permitted free chat models failed:", errors);

    return new Response(JSON.stringify({
      error: "No available free model could complete the response.",
      details: errors,
    }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
