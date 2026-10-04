import { z } from "zod";
import { estimateTokens, fetchWithTimeout } from "../llm/generator";
import { generateJson, type Tracked } from "../llm/router";
import type { Generator } from "../llm/generator";

/**
 * Typed decision questions in Jev's shape (TypeSafe "System One").
 * Jev answers these in one forward pass with calibrated probabilities and no
 * generated text, at ~$0.04 per million input tokens. When no key is present
 * we degrade to the generator LLM, then to deterministic heuristics.
 */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
};
export type ScoreQuestion = { type: "score"; instructions: string; criteria: string[] };
export type NoulQuestion = { type: "noul"; instructions: string };
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type ScoreAnswer = { type: "score"; score: number; confidence: number };
export type NoulAnswer = { type: "noul"; noul: number };
export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export type DecisionEngine = "jev" | "llm" | "heuristic";

export type Decision<Q extends Record<string, Question>> = {
  answers: { [K in keyof Q]: Q[K] extends ChoiceQuestion ? ChoiceAnswer : Q[K] extends ScoreQuestion ? ScoreAnswer : NoulAnswer };
  engine: DecisionEngine;
  tokensIn: number;
  costUsd: number;
};

export function jevConfig(): { url: string; key: string } | null {
  const key = process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY;
  if (!key) return null;
  const url =
    process.env.JEV_API_URL ??
    (process.env.TYPESAFE_API_KEY
      ? "https://api.typesafe.ai/v1/systemone"
      : "https://jevtypesafeai.com/api/v1/decide");
  return { url, key };
}

// Published list price for Jev input tokens; output is free. Used only when the
// API omits cost_usd in its usage block.
const JEV_USD_PER_MILLION_INPUT = 0.042;

async function decideWithJev<Q extends Record<string, Question>>(
  state: unknown,
  questions: Q,
): Promise<Decision<Q>> {
  const cfg = jevConfig();
  if (!cfg) throw new Error("Jev not configured");
  const res = await fetchWithTimeout(
    cfg.url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: process.env.JEV_MODEL ?? "jev-latest", state, questions }),
    },
    20_000,
  );
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    answers: Record<string, Record<string, unknown>>;
    usage?: { input_tokens?: number; cost_usd?: number };
  };
  const answers: Record<string, Answer> = {};
  for (const [name, q] of Object.entries(questions)) {
    const a = data.answers[name] ?? {};
    if (q.type === "choice") {
      const probabilities = (a.probabilities as Record<string, number>) ?? {};
      const choice = (a.choice as string) ?? Object.keys(q.criteria)[0];
      answers[name] = {
        type: "choice",
        choice,
        confidence: Number(a.confidence ?? probabilities[choice] ?? 0),
        probabilities,
      };
    } else if (q.type === "score") {
      answers[name] = {
        type: "score",
        score: Number(a.score ?? 0),
        confidence: Number(a.confidence ?? 0),
      };
    } else {
      answers[name] = { type: "noul", noul: Number(a.noul ?? 0) };
    }
  }
  const tokensIn = data.usage?.input_tokens ?? estimateTokens(JSON.stringify({ state, questions }));
  return {
    answers: answers as Decision<Q>["answers"],
    engine: "jev",
    tokensIn,
    costUsd: data.usage?.cost_usd ?? (tokensIn / 1_000_000) * JEV_USD_PER_MILLION_INPUT,
  };
}

async function decideWithLlm<Q extends Record<string, Question>>(
  chain: Generator[],
  state: unknown,
  questions: Q,
  tracker: Tracked,
): Promise<Decision<Q>> {
  const lines = Object.entries(questions).map(([name, q]) => {
    if (q.type === "choice") {
      const opts = Object.entries(q.criteria)
        .map(([k, v]) => (v ? `"${k}" (${v})` : `"${k}"`))
        .join(", ");
      return `- ${name}: ${q.instructions} Pick exactly one of: ${opts}.`;
    }
    if (q.type === "score") {
      return `- ${name}: ${q.instructions} Answer with an integer index 0-${q.criteria.length - 1} where ${q.criteria
        .map((c, i) => `${i}="${c}"`)
        .join(", ")}.`;
    }
    return `- ${name}: ${q.instructions} Answer with a probability between 0 and 1 that the answer is yes.`;
  });

  const schema = z.record(
    z.string(),
    z.object({ answer: z.union([z.string(), z.number()]), confidence: z.number().min(0).max(1).optional() }),
  );
  const out = await generateJson(
    chain,
    schema,
    {
      system:
        "You are a careful classifier. Read the STATE and answer every question. Respond ONLY with a JSON object mapping each question name to {\"answer\": ..., \"confidence\": 0-1}.",
      prompt: `STATE:\n${typeof state === "string" ? state : JSON.stringify(state, null, 1)}\n\nQUESTIONS:\n${lines.join("\n")}`,
      maxTokens: 400,
      temperature: 0,
    },
    tracker,
  );

  const answers: Record<string, Answer> = {};
  for (const [name, q] of Object.entries(questions)) {
    const raw = out[name];
    const confidence = raw?.confidence ?? 0.6;
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const picked = keys.find((k) => k.toLowerCase() === String(raw?.answer ?? "").toLowerCase()) ?? keys[0];
      const probabilities: Record<string, number> = {};
      for (const k of keys) probabilities[k] = k === picked ? confidence : (1 - confidence) / Math.max(1, keys.length - 1);
      answers[name] = { type: "choice", choice: picked, confidence, probabilities };
    } else if (q.type === "score") {
      const n = Number(raw?.answer);
      answers[name] = {
        type: "score",
        score: Number.isFinite(n) ? Math.min(q.criteria.length - 1, Math.max(0, n)) : 0,
        confidence,
      };
    } else {
      const n = Number(raw?.answer);
      answers[name] = { type: "noul", noul: Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5 };
    }
  }
  return { answers: answers as Decision<Q>["answers"], engine: "llm", tokensIn: 0, costUsd: 0 };
}

export type DecideOptions<Q extends Record<string, Question>> = {
  state: unknown;
  questions: Q;
  chain: Generator[];
  tracker: Tracked;
  heuristic: () => Decision<Q>["answers"];
  onDecision?: (d: Pick<Decision<Q>, "engine" | "tokensIn" | "costUsd">) => void;
};

export async function decide<Q extends Record<string, Question>>(opts: DecideOptions<Q>): Promise<Decision<Q>> {
  const errors: string[] = [];
  if (jevConfig()) {
    try {
      const d = await decideWithJev(opts.state, opts.questions);
      opts.onDecision?.(d);
      return d;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (opts.chain.length > 0) {
    try {
      const d = await decideWithLlm(opts.chain, opts.state, opts.questions, opts.tracker);
      opts.onDecision?.(d);
      return d;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  const d: Decision<Q> = { answers: opts.heuristic(), engine: "heuristic", tokensIn: 0, costUsd: 0 };
  opts.onDecision?.(d);
  return d;
}

export function decisionEngineName(): DecisionEngine | "auto" {
  return jevConfig() ? "jev" : "auto";
}
