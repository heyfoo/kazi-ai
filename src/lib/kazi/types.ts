import { z } from "zod";

export const JobStatus = z.enum([
  "queued",
  "fetching",
  "needs_jd",
  "analyzing",
  "screening",
  "tailoring",
  "verifying",
  "ready_for_review",
  "approved",
  "rejected",
  "applied",
  "error",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const ACTIVE_STATUSES: JobStatus[] = [
  "fetching",
  "analyzing",
  "screening",
  "tailoring",
  "verifying",
];

export const ResumeProfile = z.object({
  name: z.string().default(""),
  headline: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  links: z.array(z.string()).default([]),
  summary: z.string().default(""),
  skills: z.array(z.string()).default([]),
  experience: z
    .array(
      z.object({
        company: z.string().default(""),
        title: z.string().default(""),
        dates: z.string().default(""),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string().default(""),
        degree: z.string().default(""),
        dates: z.string().default(""),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().default(""),
        description: z.string().default(""),
      }),
    )
    .default([]),
});
export type ResumeProfile = z.infer<typeof ResumeProfile>;

export const Resume = z.object({
  rawText: z.string(),
  fileName: z.string().optional(),
  profile: ResumeProfile.optional(),
  profileEngine: z.string().optional(),
  updatedAt: z.string(),
});
export type Resume = z.infer<typeof Resume>;

export const JDAnalysis = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  location: z.string().default(""),
  seniority: z.string().default(""),
  mustHave: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  summary: z.string().default(""),
});
export type JDAnalysis = z.infer<typeof JDAnalysis>;

export const FitDecision = z.object({
  recommendation: z.enum(["apply", "stretch", "skip"]),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  engine: z.string(),
});
export type FitDecision = z.infer<typeof FitDecision>;

export const Verification = z.object({
  fabricationRisk: z.number(),
  unsupportedClaims: z.array(z.string()).default([]),
  engine: z.string(),
});
export type Verification = z.infer<typeof Verification>;

export const Usage = z.object({
  generatorTokensIn: z.number().default(0),
  generatorTokensOut: z.number().default(0),
  generatorCalls: z.number().default(0),
  decisionTokensIn: z.number().default(0),
  decisionCalls: z.number().default(0),
  estimatedCostUsd: z.number().default(0),
  cacheHits: z.number().default(0),
  engines: z.array(z.string()).default([]),
});
export type Usage = z.infer<typeof Usage>;

export const emptyUsage = (): Usage => ({
  generatorTokensIn: 0,
  generatorTokensOut: 0,
  generatorCalls: 0,
  decisionTokensIn: 0,
  decisionCalls: 0,
  estimatedCostUsd: 0,
  cacheHits: 0,
  engines: [],
});

export const Job = z.object({
  id: z.string(),
  url: z.string(),
  status: JobStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  jdText: z.string().optional(),
  jdSource: z.enum(["fetched", "pasted"]).optional(),
  analysis: JDAnalysis.optional(),
  fit: FitDecision.optional(),
  tailoredResume: z.string().optional(),
  coverLetter: z.string().optional(),
  changeNotes: z.array(z.string()).default([]),
  verification: Verification.optional(),
  usage: Usage.default(emptyUsage),
  error: z.string().optional(),
  log: z.array(z.string()).default([]),
  appliedAt: z.string().optional(),
});
export type Job = z.infer<typeof Job>;

export const Database = z.object({
  resume: Resume.optional(),
  jobs: z.array(Job).default([]),
});
export type Database = z.infer<typeof Database>;

export type ProviderStatus = {
  generator: {
    name: string;
    model: string;
    available: boolean;
    detail: string;
  };
  decision: {
    name: string;
    available: boolean;
    detail: string;
  };
  candidates: Array<{ name: string; configured: boolean; hint: string }>;
};
