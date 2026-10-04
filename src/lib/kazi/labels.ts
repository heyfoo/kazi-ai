import type { JobStatus } from "./types";

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  fetching: "Fetching posting",
  needs_jd: "Needs job description",
  analyzing: "Analyzing posting",
  screening: "Screening fit",
  tailoring: "Tailoring documents",
  verifying: "Verifying claims",
  ready_for_review: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  applied: "Applied",
  error: "Error",
};

export const STATUS_PROGRESS: Record<JobStatus, number> = {
  queued: 2,
  fetching: 15,
  needs_jd: 15,
  analyzing: 35,
  screening: 50,
  tailoring: 70,
  verifying: 90,
  ready_for_review: 100,
  approved: 100,
  rejected: 100,
  applied: 100,
  error: 100,
};

export const STATUS_TONE: Record<JobStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  fetching: "secondary",
  needs_jd: "destructive",
  analyzing: "secondary",
  screening: "secondary",
  tailoring: "secondary",
  verifying: "secondary",
  ready_for_review: "default",
  approved: "default",
  rejected: "outline",
  applied: "default",
  error: "destructive",
};

export const RECOMMENDATION_LABEL = {
  apply: "Strong match",
  stretch: "Stretch role",
  skip: "Weak match",
} as const;

export function engineLabel(engine: string): string {
  switch (engine) {
    case "jev":
      return "Jev (calibrated)";
    case "llm":
      return "LLM fallback";
    case "heuristic":
      return "keyword heuristic";
    default:
      return engine;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
