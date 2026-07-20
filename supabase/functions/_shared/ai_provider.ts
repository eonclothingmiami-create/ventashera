/**
 * AI Provider port — worker depends on this interface, not on OpenAI SDK details.
 * Swap implementations (openai | anthropic | …) without touching Product Intelligence domain.
 */

export type AiChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiChatResult = {
  content: string;
  model: string;
  provider: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export type AiEmbedResult = {
  embedding: number[];
  model: string;
  provider: string;
  dims: number;
};

export type AiPingResult = {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms: number;
  message: string;
};

export interface AiProvider {
  readonly id: string;
  chatJson(opts: {
    model: string;
    messages: AiChatMessage[];
    temperature?: number;
  }): Promise<AiChatResult>;
  embed(opts: { model: string; input: string }): Promise<AiEmbedResult>;
  ping(opts: { chatModel: string }): Promise<AiPingResult>;
}

export class OpenAiProvider implements AiProvider {
  readonly id = "openai";
  constructor(private apiKey: string) {
    if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  }

  async chatJson(opts: {
    model: string;
    messages: AiChatMessage[];
    temperature?: number;
  }): Promise<AiChatResult> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.4,
        response_format: { type: "json_object" },
        messages: opts.messages,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI chat ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI empty content");
    return {
      content: String(content),
      model: String(data.model || opts.model),
      provider: this.id,
      usage: data.usage,
    };
  }

  async embed(opts: { model: string; input: string }): Promise<AiEmbedResult> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        input: opts.input.slice(0, 8000),
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI embeddings ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error("OpenAI empty embedding");
    return {
      embedding: vec as number[],
      model: String(data.model || opts.model),
      provider: this.id,
      dims: vec.length,
    };
  }

  async ping(opts: { chatModel: string }): Promise<AiPingResult> {
    const t0 = Date.now();
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      const latency = Date.now() - t0;
      if (!res.ok) {
        const errText = await res.text();
        return {
          ok: false,
          provider: this.id,
          model: opts.chatModel,
          latency_ms: latency,
          message: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      return {
        ok: true,
        provider: this.id,
        model: opts.chatModel,
        latency_ms: latency,
        message: "Conectado",
      };
    } catch (e) {
      return {
        ok: false,
        provider: this.id,
        model: opts.chatModel,
        latency_ms: Date.now() - t0,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

/** Factory — extend here when adding Claude/Gemini/Azure/Ollama. */
export function createAiProvider(providerId: string, env: {
  OPENAI_API_KEY?: string;
}): AiProvider {
  const id = (providerId || "openai").toLowerCase();
  if (id === "openai") {
    const key = env.OPENAI_API_KEY || "";
    if (!key) throw new Error("OPENAI_API_KEY not configured");
    return new OpenAiProvider(key);
  }
  throw new Error(`AI provider not implemented: ${id}`);
}
