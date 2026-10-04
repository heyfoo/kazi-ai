export type GenerateOptions = {
  system: string;
  prompt: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
};

export type GenerateResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
};

export interface Generator {
  /** Stable id, e.g. "ollama", "groq". */
  name: string;
  model: string;
  /** Whether this provider charges real money per token. */
  paid: boolean;
  generate(opts: GenerateOptions): Promise<GenerateResult>;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public retryable = true,
  ) {
    super(`[${provider}] ${message}`);
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
