import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { logger } from "../logger";

export interface StructuredRequest<T extends z.ZodType> {
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
}

export interface StructuredResponse<T> {
  data: T;
  provider: "anthropic";
  model: string;
  latencyMs: number;
}

/** The only gateway to an LLM in the whole system. 3ASES and KANAWITA never import this. */
export interface AiClient {
  readonly available: boolean;
  readonly model: string;
  /** Why the real AI path is unavailable (shown in the UI as the fallback reason). */
  readonly unavailableReason: string | null;
  generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResponse<z.infer<T>>>;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export interface AnthropicClientOptions {
  enabled: boolean;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
}

export class AnthropicAiClient implements AiClient {
  readonly available: boolean;
  readonly model: string;
  readonly unavailableReason: string | null;
  private client: Anthropic | null = null;

  constructor(opts: AnthropicClientOptions) {
    this.model = opts.model;
    if (!opts.enabled) {
      this.available = false;
      this.unavailableReason = "AI disabled (AI_ENABLED=false)";
    } else if (!opts.apiKey) {
      this.available = false;
      this.unavailableReason = "ANTHROPIC_API_KEY not configured";
    } else {
      this.available = true;
      this.unavailableReason = null;
      // One controlled retry (SDK retries 408/409/429/5xx and connection errors) and a hard timeout.
      this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 1 });
    }
  }

  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResponse<z.infer<T>>> {
    if (!this.client) throw new AiUnavailableError(this.unavailableReason ?? "AI unavailable");
    const started = Date.now();
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens ?? 4000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        // Short, bounded analysis task: keep effort low for demo latency.
        output_config: { effort: "low", format: zodOutputFormat(req.schema) },
      });
      if (response.stop_reason === "refusal") throw new Error("Model declined the request (refusal)");
      if (response.stop_reason === "max_tokens") throw new Error("Model output truncated (max_tokens)");
      if (response.parsed_output == null) throw new Error("Model output did not match the schema");
      return { data: response.parsed_output as z.infer<T>, provider: "anthropic", model: response.model ?? this.model, latencyMs: Date.now() - started };
    } catch (err) {
      let reason: string;
      if (err instanceof Anthropic.AuthenticationError) reason = "Anthropic authentication failed (check ANTHROPIC_API_KEY)";
      else if (err instanceof Anthropic.RateLimitError) reason = "Anthropic rate limit";
      else if (err instanceof Anthropic.APIConnectionTimeoutError) reason = "Anthropic request timed out";
      else if (err instanceof Anthropic.APIConnectionError) reason = "Anthropic API unreachable";
      else if (err instanceof Anthropic.APIError) reason = `Anthropic API error ${err.status ?? ""}`.trim();
      else reason = err instanceof Error ? err.message : String(err);
      logger.warn("ai.call_failed", { model: this.model, reason, latencyMs: Date.now() - started });
      throw new AiUnavailableError(reason);
    }
  }
}

/** Test double: returns canned data or throws, never calls the network. */
export class StubAiClient implements AiClient {
  readonly available = true;
  readonly unavailableReason = null;
  constructor(
    public readonly model: string,
    private readonly handler: (req: StructuredRequest<z.ZodType>) => unknown,
  ) {}
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResponse<z.infer<T>>> {
    const data = await this.handler(req);
    return { data: req.schema.parse(data) as z.infer<T>, provider: "anthropic", model: this.model, latencyMs: 1 };
  }
}
