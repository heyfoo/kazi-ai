import {
  estimateTokens,
  fetchWithTimeout,
  ProviderError,
  type GenerateOptions,
  type GenerateResult,
  type Generator,
} from "./generator";

export const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
// qwen2.5:3b is the strongest 3B all-rounder; ~2 GB RAM at Q4, comfortable on an 8 GB machine.
export const OLLAMA_MODEL = process.env.KAZI_OLLAMA_MODEL ?? "qwen2.5:3b";
// 3B models slow down sharply past ~6k context on CPU; keep prompts compact instead.
const NUM_CTX = Number(process.env.KAZI_OLLAMA_NUM_CTX ?? 6144);

export async function probeOllama(): Promise<{ up: boolean; models: string[]; detail: string }> {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_HOST}/api/tags`, {}, 1500);
    if (!res.ok) return { up: false, models: [], detail: `Ollama responded ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    const hasModel = models.some((m) => m === OLLAMA_MODEL || m.startsWith(`${OLLAMA_MODEL}:`));
    return {
      up: hasModel,
      models,
      detail: hasModel
        ? `Ollama at ${OLLAMA_HOST}, model ${OLLAMA_MODEL}`
        : `Ollama is running but ${OLLAMA_MODEL} is not pulled (run: ollama pull ${OLLAMA_MODEL})`,
    };
  } catch {
    return { up: false, models: [], detail: `Ollama not reachable at ${OLLAMA_HOST}` };
  }
}

export const ollamaGenerator: Generator = {
  name: "ollama",
  model: OLLAMA_MODEL,
  paid: false,
  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${OLLAMA_HOST}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            format: opts.json ? "json" : undefined,
            options: {
              temperature: opts.temperature ?? 0.3,
              num_ctx: NUM_CTX,
              num_predict: opts.maxTokens ?? 1200,
            },
            messages: [
              { role: "system", content: opts.system },
              { role: "user", content: opts.prompt },
            ],
          }),
        },
        180_000,
      );
    } catch (err) {
      throw new ProviderError("ollama", (err as Error).message);
    }
    if (!res.ok) {
      throw new ProviderError("ollama", `${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = data.message?.content ?? "";
    return {
      text,
      tokensIn: data.prompt_eval_count ?? estimateTokens(opts.system + opts.prompt),
      tokensOut: data.eval_count ?? estimateTokens(text),
    };
  },
};
