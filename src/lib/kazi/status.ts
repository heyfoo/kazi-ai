import { jevConfig } from "./decide/engine";
import { OLLAMA_MODEL } from "./llm/ollama";
import { generatorChain, ollamaStatus } from "./llm/router";
import type { ProviderStatus } from "./types";

export async function providerStatus(): Promise<ProviderStatus> {
  const [chain, ollama] = await Promise.all([generatorChain(), ollamaStatus()]);
  const primary = chain[0];
  const jev = jevConfig();

  return {
    generator: primary
      ? { name: primary.name, model: primary.model, available: true, detail: chain.length > 1 ? `Fallbacks: ${chain.slice(1).map((g) => g.name).join(", ")}` : "No fallback configured" }
      : { name: "template", model: "deterministic", available: false, detail: ollama.detail },
    decision: jev
      ? { name: "jev", available: true, detail: `TypeSafe Jev via ${new URL(jev.url).hostname}` }
      : primary
        ? { name: "llm", available: true, detail: `Falling back to ${primary.name} for yes/no decisions (uncalibrated)` }
        : { name: "heuristic", available: false, detail: "Keyword overlap only. Add TYPESAFE_API_KEY for calibrated decisions." },
    candidates: [
      { name: "ollama", configured: ollama.up, hint: ollama.up ? ollama.detail : `Install Ollama and run: ollama pull ${OLLAMA_MODEL}` },
      { name: "groq", configured: Boolean(process.env.GROQ_API_KEY), hint: "Free tier: set GROQ_API_KEY" },
      { name: "openrouter", configured: Boolean(process.env.OPENROUTER_API_KEY), hint: "Free models: set OPENROUTER_API_KEY" },
      { name: "gemini", configured: Boolean(process.env.GEMINI_API_KEY), hint: "Free tier: set GEMINI_API_KEY" },
      { name: "jev", configured: Boolean(jev), hint: "Typed decisions at ~$0.04/M tokens: set TYPESAFE_API_KEY" },
    ],
  };
}
