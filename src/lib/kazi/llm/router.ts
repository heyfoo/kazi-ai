import { z } from "zod";
import { ProviderError, type GenerateOptions, type GenerateResult, type Generator } from "./generator";
import { ollamaGenerator, probeOllama } from "./ollama";
import { geminiGenerator, groqGenerator, openRouterGenerator } from "./openai-compatible";

export type ProviderName = "ollama" | "groq" | "openrouter" | "gemini" | "mock";

const PROVIDER_ORDER: ProviderName[] = ["ollama", "groq", "openrouter", "gemini"];

let probeCache: { at: number; result: Awaited<ReturnType<typeof probeOllama>> } | null = null;

export async function ollamaStatus() {
  if (probeCache && Date.now() - probeCache.at < 30_000) return probeCache.result;
  const result = await probeOllama();
  probeCache = { at: Date.now(), result };
  return result;
}

function configuredGenerators(): Record<ProviderName, Generator | null> {
  return {
    ollama: ollamaGenerator,
    groq: groqGenerator(),
    openrouter: openRouterGenerator(),
    gemini: geminiGenerator(),
    mock: null,
  };
}

/**
 * Returns the ordered chain of generators to try. Local first (free, private),
 * then free-tier cloud providers in the order they're configured. An empty chain
 * means Kazi should run in template (mock) mode.
 */
export async function generatorChain(): Promise<Generator[]> {
  const forced = process.env.KAZI_LLM_PROVIDER as ProviderName | "auto" | undefined;
  const gens = configuredGenerators();

  if (forced && forced !== "auto") {
    if (forced === "mock") return [];
    const g = gens[forced];
    return g ? [g] : [];
  }

  const chain: Generator[] = [];
  for (const name of PROVIDER_ORDER) {
    const g = gens[name];
    if (!g) continue;
    if (name === "ollama") {
      const status = await ollamaStatus();
      if (!status.up) continue;
    }
    chain.push(g);
  }
  return chain;
}

export type Tracked = {
  tokensIn: number;
  tokensOut: number;
  calls: number;
  engines: Set<string>;
};

export function newTracker(): Tracked {
  return { tokensIn: 0, tokensOut: 0, calls: 0, engines: new Set() };
}

export async function generate(
  chain: Generator[],
  opts: GenerateOptions,
  tracker?: Tracked,
): Promise<GenerateResult & { provider: string }> {
  const errors: string[] = [];
  for (const gen of chain) {
    try {
      const result = await gen.generate(opts);
      if (tracker) {
        tracker.tokensIn += result.tokensIn;
        tracker.tokensOut += result.tokensOut;
        tracker.calls += 1;
        tracker.engines.add(`${gen.name}:${gen.model}`);
      }
      return { ...result, provider: gen.name };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      if (err instanceof ProviderError && !err.retryable) continue;
    }
  }
  throw new Error(`All LLM providers failed: ${errors.join(" | ") || "none configured"}`);
}

export function extractJson(text: string): unknown {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
  const start = stripped.search(/[[{]/);
  if (start === -1) throw new Error("No JSON object in response");
  const open = stripped[start];
  const close = open === "{" ? "}" : "]";
  const end = stripped.lastIndexOf(close);
  if (end === -1) throw new Error("Unterminated JSON in response");
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Generates JSON that validates against `schema`. Small local models drift, so a
 * failed parse gets one corrective retry that quotes the validation error back.
 */
export async function generateJson<T extends z.ZodTypeAny>(
  chain: Generator[],
  schema: T,
  opts: GenerateOptions,
  tracker?: Tracked,
): Promise<z.infer<T>> {
  let lastError = "";
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generate(chain, { ...opts, prompt, json: true }, tracker);
    try {
      const parsed = schema.safeParse(extractJson(res.text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } catch (err) {
      lastError = (err as Error).message;
    }
    prompt = `${opts.prompt}\n\nYour previous answer was invalid (${lastError}). Return ONLY the JSON object, no prose, no markdown fences.`;
  }
  throw new Error(`Model did not return valid JSON: ${lastError}`);
}
