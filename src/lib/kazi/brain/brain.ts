import type { JDAnalysis, ResumeProfile } from "../types";

export type TailorInput = {
  profile: ResumeProfile;
  analysis: JDAnalysis;
  /** Relevance 0-3 per experience bullet, keyed "expIndex:bulletIndex". */
  bulletScores: Record<string, number>;
  matchedSkills: string[];
};

export type TailorOutput = {
  resumeMarkdown: string;
  changeNotes: string[];
};

export type CoverLetterInput = {
  profile: ResumeProfile;
  analysis: JDAnalysis;
  matchedSkills: string[];
  /** Top evidence bullets, already picked by relevance. */
  evidence: string[];
};

export type UnsupportedClaimsInput = {
  coverLetter: string;
  resumeText: string;
};

/**
 * The "brain" is everything that writes text. It is swappable so the same
 * pipeline runs on a local 3B model, a free cloud tier, or the deterministic
 * template engine when nothing is configured.
 */
export interface Brain {
  name: string;
  extractProfile(resumeText: string): Promise<ResumeProfile>;
  analyzeJob(jdText: string, url: string): Promise<JDAnalysis>;
  tailorResume(input: TailorInput): Promise<TailorOutput>;
  writeCoverLetter(input: CoverLetterInput): Promise<string>;
  listUnsupportedClaims(input: UnsupportedClaimsInput): Promise<string[]>;
}
