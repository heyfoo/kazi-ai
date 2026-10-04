import {
  estimateTokens,
  fetchWithTimeout,
  ProviderError,
  type GenerateOptions,
  type GenerateResult,
  type Generator,
} from "./generator";

type Config = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  paid: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  supportsJsonMode: boolean;
};

export function openAiCompatibleGenerator(cfg: Config): Generator {
  return {
    name: cfg.name,
    model: cfg.model,
    paid: cfg.paid,
    async generate(opts: GenerateOptions): Promise<GenerateResult> {
      let res: Response | undefined;
      let lastStatus = "";
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          res = await fetchWithTimeout(
            `${cfg.baseUrl}/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${cfg.apiKey}`,
                ...cfg.extraHeaders,
              },
              body: JSON.stringify({
                model: cfg.model,
                temperature: opts.temperature ?? 0.3,
                max_tokens: opts.maxTokens ?? 1200,
                response_format:
                  opts.json && cfg.supportsJsonMode ? { type: "json_object" } : undefined,
                ...cfg.extraBody,
                messages: [
                  { role: "system", content: opts.system },
                  { role: "user", content: opts.prompt },
                ],
              }),
            },
            90_000,
          );
        } catch (err) {
          throw new ProviderError(cfg.name, (err as Error).message);
        }
        if (res.status !== 429 && res.status !== 503) break;
        lastStatus = `${res.status} ${(await res.text()).slice(0, 180)}`;
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
        res = undefined;
      }
      if (!res) {
        throw new ProviderError(cfg.name, lastStatus || "rate limited");
      }
      if (!res.ok) {
        const body = await res.text();
        // 401/403 means a bad key; retrying another provider is the right move, but
        // flag it as non-retryable for this provider so the router stops using it.
        throw new ProviderError(cfg.name, `${res.status} ${body.slice(0, 300)}`, res.status !== 401 && res.status !== 403);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        text,
        tokensIn: data.usage?.prompt_tokens ?? estimateTokens(opts.system + opts.prompt),
        tokensOut: data.usage?.completion_tokens ?? estimateTokens(text),
      };
    },
  };
}

export function groqGenerator(): Generator | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return openAiCompatibleGenerator({
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey,
    model: process.env.KAZI_GROQ_MODEL ?? "llama-3.1-8b-instant",
    paid: false,
    supportsJsonMode: true,
  });
}

export function openRouterGenerator(): Generator | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return openAiCompatibleGenerator({
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    // The ":free" suffix pins OpenRouter's zero-cost routing; swap models freely via env.
    model: process.env.KAZI_OPENROUTER_MODEL ?? "qwen/qwen3.8-27b:free",
    paid: false,
    // Free Qwen/Gemma routes honor JSON mode. Without it they interleave reasoning
    // and return truncated objects that fail to parse.
    supportsJsonMode: true,
    extraHeaders: {
      "HTTP-Referer": "https://github.com/kazi-agent",
      "X-Title": "Kazi job application agent",
    },
    // Qwen free routes spend most of max_tokens on hidden reasoning and then
    // truncate the JSON. Kazi's prompts are short and explicit, so skip it.
    extraBody: { reasoning: { effort: "none" } },
  });
}

export function geminiGenerator(): Generator | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return openAiCompatibleGenerator({
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey,
    model: process.env.KAZI_GEMINI_MODEL ?? "gemini-2.5-flash",
    paid: false,
    supportsJsonMode: true,
  });
}
