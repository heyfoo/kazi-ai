import type { Generator } from "../llm/generator";
import type { Tracked } from "../llm/router";
import { coverage, overlapScore, truncate } from "../text";
import type { FitDecision, JDAnalysis, ResumeProfile } from "../types";
import { decide, type ChoiceAnswer, type Decision, type ScoreAnswer } from "./engine";

export type DecisionContext = {
  chain: Generator[];
  tracker: Tracked;
  onDecision: (d: { engine: string; tokensIn: number; costUsd: number }) => void;
};

export function profileText(profile: ResumeProfile): string {
  return [
    profile.headline,
    profile.summary,
    profile.skills.join(", "),
    ...profile.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...profile.projects.map((p) => `${p.name} ${p.description}`),
    ...profile.education.map((e) => `${e.degree} ${e.school}`),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function screenFit(profile: ResumeProfile, analysis: JDAnalysis, ctx: DecisionContext): Promise<FitDecision> {
  const text = profileText(profile);
  const seen = new Set<string>();
  const wanted = [...analysis.mustHave, ...analysis.keywords].filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const cov = coverage(wanted, text);
  const mustCov = coverage(analysis.mustHave, text);

  const questions = {
    recommendation: {
      type: "choice" as const,
      instructions: "Given the candidate profile and the job requirements, should this candidate apply?",
      criteria: {
        apply: "Candidate meets most must-have requirements; strong match worth applying to.",
        stretch: "Candidate meets some requirements; plausible but a reach.",
        skip: "Candidate is clearly under- or over-qualified or in the wrong field.",
      },
    },
  };

  const d: Decision<typeof questions> = await decide({
    state: {
      candidate: truncate(text, 3500),
      job: {
        title: analysis.title,
        seniority: analysis.seniority,
        must_have: analysis.mustHave,
        nice_to_have: analysis.niceToHave,
      },
    },
    questions,
    chain: ctx.chain,
    tracker: ctx.tracker,
    onDecision: ctx.onDecision,
    heuristic: () => {
      const r = mustCov.ratio;
      const choice = r >= 0.6 ? "apply" : r >= 0.3 ? "stretch" : "skip";
      const probabilities = {
        apply: Math.min(0.95, Math.max(0.05, r)),
        stretch: 0.3,
        skip: Math.min(0.95, Math.max(0.05, 1 - r)),
      };
      const total = Object.values(probabilities).reduce((a, b) => a + b, 0);
      for (const k of Object.keys(probabilities) as Array<keyof typeof probabilities>) probabilities[k] /= total;
      const answer: ChoiceAnswer = { type: "choice", choice, confidence: probabilities[choice], probabilities };
      return { recommendation: answer };
    },
  });

  const rec = d.answers.recommendation;
  return {
    recommendation: rec.choice as FitDecision["recommendation"],
    confidence: rec.confidence,
    probabilities: rec.probabilities,
    matchedSkills: cov.matched,
    missingSkills: mustCov.missing,
    engine: d.engine,
  };
}

const RELEVANCE_SCALE = ["irrelevant", "somewhat related", "relevant", "directly addresses a requirement"];

/** Grades every experience bullet against the job in one decision round-trip. */
export async function gradeBullets(profile: ResumeProfile, analysis: JDAnalysis, ctx: DecisionContext): Promise<Record<string, number>> {
  const bullets = profile.experience.flatMap((exp, ei) => exp.bullets.map((text, bi) => ({ key: `${ei}:${bi}`, text })));
  if (bullets.length === 0) return {};

  const jdText = [analysis.title, ...analysis.mustHave, ...analysis.niceToHave, ...analysis.keywords].join("\n");
  const questions: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
  for (const b of bullets.slice(0, 40)) {
    questions[`b_${b.key.replace(":", "_")}`] = {
      type: "score",
      instructions: `How relevant is this resume bullet to the job? Bullet: "${truncate(b.text, 300)}"`,
      criteria: RELEVANCE_SCALE,
    };
  }

  const d = await decide({
    state: { job_title: analysis.title, requirements: analysis.mustHave, nice_to_have: analysis.niceToHave, keywords: analysis.keywords },
    questions,
    chain: ctx.chain,
    tracker: ctx.tracker,
    onDecision: ctx.onDecision,
    heuristic: () => {
      const out: Record<string, ScoreAnswer> = {};
      for (const b of bullets) {
        const s = overlapScore(b.text, jdText);
        out[`b_${b.key.replace(":", "_")}`] = { type: "score", score: s > 0.35 ? 3 : s > 0.2 ? 2 : s > 0.08 ? 1 : 0, confidence: 0.5 };
      }
      return out;
    },
  });

  const scores: Record<string, number> = {};
  for (const b of bullets) {
    const a = d.answers[`b_${b.key.replace(":", "_")}`];
    scores[b.key] = a ? a.score : 1;
  }
  return scores;
}

export async function fabricationRisk(coverLetter: string, resumeText: string, ctx: DecisionContext): Promise<{ risk: number; engine: string }> {
  const questions = {
    fabricates: {
      type: "noul" as const,
      instructions:
        "Does the cover letter claim any skill, tool, employer, title, metric, or achievement that the resume does not support?",
    },
  };
  const d = await decide({
    state: { resume: truncate(resumeText, 5000), cover_letter: coverLetter },
    questions,
    chain: ctx.chain,
    tracker: ctx.tracker,
    onDecision: ctx.onDecision,
    heuristic: () => ({ fabricates: { type: "noul" as const, noul: 0.2 } }),
  });
  return { risk: d.answers.fabricates.noul, engine: d.engine };
}
