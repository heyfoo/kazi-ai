import { z } from "zod";
import type { Generator } from "../llm/generator";
import { generate, generateJson, type Tracked } from "../llm/router";
import { truncate } from "../text";
import { JDAnalysis, ResumeProfile } from "../types";
import type { Brain, CoverLetterInput, TailorInput, TailorOutput, UnsupportedClaimsInput } from "./brain";
import { renderResumeMarkdown } from "./render";

const NO_FABRICATION =
  "Hard rule: never invent employers, titles, dates, degrees, tools, metrics, or achievements. Only rephrase, reorder, and emphasise what the candidate actually wrote.";

// Prompts are written for 3B-class models: short, explicit field lists, one job per call.
export class LlmBrain implements Brain {
  name: string;
  cacheKey: string;

  constructor(
    private chain: Generator[],
    private tracker: Tracked,
  ) {
    this.name = chain.map((g) => `${g.name}:${g.model}`).join(" → ");
    this.cacheKey = `llm:${this.name}`;
  }

  async extractProfile(resumeText: string): Promise<ResumeProfile> {
    return generateJson(
      this.chain,
      ResumeProfile,
      {
        system: `You convert resumes into JSON. ${NO_FABRICATION} Use empty strings or empty arrays when something is missing.`,
        prompt: `Return JSON with keys: name, headline, email, phone, location, links (array), summary, skills (array of short strings), experience (array of {company, title, dates, bullets: array}), education (array of {school, degree, dates}), projects (array of {name, description}).\n\nRESUME:\n${truncate(resumeText, 9000)}`,
        maxTokens: 1800,
        temperature: 0,
      },
      this.tracker,
    );
  }

  async analyzeJob(jdText: string, url: string): Promise<JDAnalysis> {
    return generateJson(
      this.chain,
      JDAnalysis,
      {
        system: "You extract structured facts from job postings. Be concise. Output JSON only.",
        prompt: `Return JSON with keys: title, company, location, seniority, mustHave (array of required skills/qualifications, max 10), niceToHave (array, max 8), responsibilities (array, max 6, short), keywords (array of ATS keywords, max 15), summary (2 sentences).\n\nURL: ${url}\n\nJOB POSTING:\n${truncate(jdText, 7000)}`,
        maxTokens: 900,
        temperature: 0,
      },
      this.tracker,
    );
  }

  async tailorResume(input: TailorInput): Promise<TailorOutput> {
    const { profile, analysis, bulletScores } = input;

    // Pick the bullets most worth rewriting so a small model only touches a handful.
    const candidates = profile.experience
      .flatMap((exp, ei) => exp.bullets.map((text, bi) => ({ key: `${ei}:${bi}`, text, score: bulletScores[`${ei}:${bi}`] ?? 1 })))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const schema = z.object({
      summary: z.string(),
      skillOrder: z.array(z.string()),
      rewrittenBullets: z.record(z.string(), z.string()),
      changeNotes: z.array(z.string()),
    });

    const out = await generateJson(
      this.chain,
      schema,
      {
        system: `You tailor resumes to a specific job posting. ${NO_FABRICATION} Mirror the posting's vocabulary where the candidate genuinely has the experience.`,
        prompt: `TARGET ROLE: ${analysis.title} at ${analysis.company}
MUST-HAVE: ${analysis.mustHave.join("; ")}
KEYWORDS: ${analysis.keywords.join(", ")}

CANDIDATE SUMMARY: ${profile.summary || "(none)"}
CANDIDATE SKILLS: ${profile.skills.join(", ")}
CANDIDATE HEADLINE: ${profile.headline}

BULLETS TO REWRITE (keep facts identical, tighten wording, lead with impact, weave in matching keywords):
${candidates.map((c) => `[${c.key}] ${c.text}`).join("\n")}

Return JSON: {
  "summary": "2-3 sentence professional summary aimed at this role, grounded in the candidate's real background",
  "skillOrder": [the candidate's existing skills reordered so the most relevant to this role come first; do not add skills],
  "rewrittenBullets": {"<key>": "<rewritten bullet>", ...} for the bullets above,
  "changeNotes": ["short note explaining each notable change"]
}`,
        maxTokens: 1400,
        temperature: 0.3,
      },
      this.tracker,
    );

    // Reject skills the model slipped in that the candidate never listed.
    const known = new Set(profile.skills.map((s) => s.toLowerCase()));
    const skillOrder = out.skillOrder.filter((s) => known.has(s.toLowerCase()));
    for (const s of profile.skills) if (!skillOrder.some((k) => k.toLowerCase() === s.toLowerCase())) skillOrder.push(s);

    const bulletOrder: Record<number, number[]> = {};
    profile.experience.forEach((exp, ei) => {
      bulletOrder[ei] = exp.bullets
        .map((_, bi) => bi)
        .sort((a, b) => (bulletScores[`${ei}:${b}`] ?? 1) - (bulletScores[`${ei}:${a}`] ?? 1));
    });

    return {
      resumeMarkdown: renderResumeMarkdown(profile, {
        summary: out.summary,
        skillOrder,
        bulletOrder,
        rewrittenBullets: out.rewrittenBullets,
      }),
      changeNotes: out.changeNotes,
    };
  }

  async writeCoverLetter(input: CoverLetterInput): Promise<string> {
    const { profile, analysis, matchedSkills, evidence } = input;
    const res = await generate(
      this.chain,
      {
        system: `You write concise, specific cover letters (220-320 words, 3-4 short paragraphs). ${NO_FABRICATION} Attribute each achievement to the employer where it actually happened. No clichés like "I am writing to express my interest". Plain text, no markdown headers.`,
        prompt: `Candidate: ${profile.name}, ${profile.headline}
Role: ${analysis.title} at ${analysis.company}
Why the role matters (from posting): ${analysis.summary}
Must-haves: ${analysis.mustHave.join("; ")}
Candidate's matching strengths: ${matchedSkills.join(", ") || "(see evidence)"}
Evidence from the resume to draw on:
${evidence.map((e) => `- ${e}`).join("\n")}

Write the letter. Start with "Dear Hiring Team," and end with "Sincerely,\n${profile.name}".`,
        maxTokens: 700,
        temperature: 0.5,
      },
      this.tracker,
    );
    return res.text.trim();
  }

  async listUnsupportedClaims(input: UnsupportedClaimsInput): Promise<string[]> {
    const out = await generateJson(
      this.chain,
      z.object({ claims: z.array(z.string()) }),
      {
        system: "You audit cover letters against resumes. Output JSON only.",
        prompt: `List every concrete claim in the COVER LETTER (skills, tools, employers, titles, numbers, achievements) that is NOT supported by the RESUME. Return {"claims": ["..."]}. Return an empty array if everything is supported.\n\nRESUME:\n${truncate(input.resumeText, 6000)}\n\nCOVER LETTER:\n${input.coverLetter}`,
        maxTokens: 400,
        temperature: 0,
      },
      this.tracker,
    );
    return out.claims;
  }
}
