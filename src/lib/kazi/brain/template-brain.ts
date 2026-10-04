import { collapseWhitespace, tokenize } from "../text";
import type { JDAnalysis, ResumeProfile } from "../types";
import type { Brain, CoverLetterInput, TailorInput, TailorOutput, UnsupportedClaimsInput } from "./brain";
import { findSkills } from "./lexicon";
import { renderResumeMarkdown } from "./render";

const SECTION_ALIASES: Record<string, string[]> = {
  summary: ["summary", "profile", "about", "objective", "professional summary"],
  skills: ["skills", "technical skills", "technologies", "core competencies", "tech stack"],
  experience: ["experience", "work experience", "professional experience", "employment", "work history"],
  education: ["education", "academic background"],
  projects: ["projects", "selected projects", "personal projects"],
};

const BULLET_RE = /^\s*([-•*▪◦‣]|\d+[.)])\s+/;
const DATE_RE = /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}|present|current)/i;

/** Case-insensitive dedupe that keeps the first (usually the candidate's own) spelling. */
function dedupeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of skills) {
    const key = s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function sectionOf(line: string): string | null {
  const clean = line.replace(/[:#*_]/g, "").trim().toLowerCase();
  if (clean.length > 40) return null;
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(clean)) return key;
  }
  return null;
}

/**
 * Deterministic engine used when no LLM is reachable. It never invents content:
 * it parses, reorders, and fills templates. Output quality is intentionally
 * plain so the UI can nudge the user toward installing Ollama.
 */
export class TemplateBrain implements Brain {
  name = "template (no LLM configured)";
  cacheKey = "template-v2";

  async extractProfile(resumeText: string): Promise<ResumeProfile> {
    const text = collapseWhitespace(resumeText);
    const lines = text.split("\n").map((l) => l.trimEnd());
    const profile: ResumeProfile = {
      name: "",
      headline: "",
      email: "",
      phone: "",
      location: "",
      links: [],
      summary: "",
      skills: [],
      experience: [],
      education: [],
      projects: [],
    };

    profile.email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "";
    profile.phone = text.match(/(\+?\d[\d\s().-]{8,}\d)/)?.[0]?.trim() ?? "";
    profile.links = [...new Set(text.match(/(https?:\/\/\S+|(?:www\.)?(?:linkedin\.com|github\.com)\/\S+)/gi) ?? [])];

    // Header = everything before the first section heading (capped), e.g. name + contact line.
    const firstSection = lines.findIndex((l) => l.trim() && sectionOf(l.trim()));
    const headerEnd = firstSection === -1 ? Math.min(6, lines.length) : Math.min(firstSection, 6);
    const header = lines.slice(0, headerEnd).map((l) => l.trim()).filter(Boolean);
    profile.name = header[0]?.split(/\s*[|•·]\s*/)[0]?.trim() ?? "";
    const segments = header
      .slice(1)
      .flatMap((l) => l.split(/\s*[|•·]\s*/))
      .map((s) => s.trim())
      .filter((s) => s && !/@|https?:|www\.|linkedin\.com|github\.com|\d{3}/.test(s));
    profile.headline = segments.find((s) => s.length < 80 && !/,/.test(s)) ?? segments[0] ?? "";
    profile.location = segments.find((s) => s !== profile.headline && /,/.test(s) && s.length < 60) ?? "";

    let current: string | null = null;
    let exp: ResumeProfile["experience"][number] | null = null;
    const summaryLines: string[] = [];
    const skillLines: string[] = [];

    for (const raw of lines.slice(headerEnd)) {
      const line = raw.trim();
      if (!line) continue;
      const sec = sectionOf(line);
      if (sec) {
        current = sec;
        exp = null;
        continue;
      }
      if (current === "summary") summaryLines.push(line);
      else if (current === "skills") skillLines.push(line);
      else if (current === "experience") {
        if (BULLET_RE.test(line)) {
          if (!exp) {
            exp = { company: "", title: "", dates: "", bullets: [] };
            profile.experience.push(exp);
          }
          exp.bullets.push(line.replace(BULLET_RE, "").trim());
        } else {
          const dates = line.match(new RegExp(`${DATE_RE.source}.*$`, "i"))?.[0] ?? "";
          const head = line.replace(dates, "").replace(/[|,–—-]+\s*$/, "").trim();
          const parts = head.split(/\s+(?:at|@|[|–—-])\s+/);
          if (exp && exp.bullets.length === 0 && !exp.dates && dates && !head) {
            exp.dates = dates;
          } else {
            exp = { title: parts[0]?.trim() ?? head, company: parts[1]?.trim() ?? "", dates: dates.trim(), bullets: [] };
            profile.experience.push(exp);
          }
        }
      } else if (current === "education") {
        const dates = line.match(new RegExp(`${DATE_RE.source}.*$`, "i"))?.[0] ?? "";
        const head = line.replace(BULLET_RE, "").replace(dates, "").replace(/[|,–—-]+\s*$/, "").trim();
        const parts = head.split(/\s*[|,–—-]\s*/);
        profile.education.push({ degree: parts[0] ?? head, school: parts.slice(1).join(", "), dates: dates.trim() });
      } else if (current === "projects") {
        const clean = line.replace(BULLET_RE, "");
        const [name, ...rest] = clean.split(/\s[–—:-]\s/);
        profile.projects.push({ name: name.trim(), description: rest.join(" - ").trim() });
      }
    }

    profile.summary = summaryLines.join(" ");
    const declared = skillLines
      .join(", ")
      .split(/[,•·|;\n]+/)
      .map((s) => s.replace(/^[-*\s]+/, "").trim())
      .filter((s) => s && s.length < 40);
    profile.skills = dedupeSkills([...declared, ...findSkills(text)]).slice(0, 40);
    return profile;
  }

  async analyzeJob(jdText: string, url: string): Promise<JDAnalysis> {
    const text = collapseWhitespace(jdText);
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const ROLE_RE = /engineer|developer|manager|designer|analyst|scientist|lead|architect|specialist|consultant|intern|director|coordinator|associate/i;
    const rawTitle = lines.find((l) => l.length < 90 && ROLE_RE.test(l)) ?? lines[0] ?? "Role";

    // Page titles are usually "Role - Company" or "Role | Company"; split them apart.
    const titleParts = rawTitle.split(/\s+(?:[-–—|]|at|@)\s+/);
    const title = titleParts[0]?.trim() || rawTitle;
    const hostname = new URL(url, "http://x").hostname.replace(/^www\./, "");
    const hostIsName = /^[a-z]/i.test(hostname) && !/^localhost$/i.test(hostname);
    const company =
      titleParts.slice(1).find((p) => p && !/job|career|hiring|remote/i.test(p))?.trim() ??
      text.match(/\b(?:at|join|about)\s+([A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+){0,2})/)?.[1] ??
      (hostIsName ? hostname.split(".")[0] : "");

    const skills = findSkills(text);
    const isHeading = (l: string) => l.length < 20 || /:$/.test(l);
    const requirementLines = lines.filter((l) => !isHeading(l) && /(experience|proficien|knowledge|familiar|required|must|strong|years)/i.test(l) && l.length < 220);
    const mustHave = skills.length >= 3 ? skills.slice(0, 10) : [...new Set([...skills, ...requirementLines.slice(0, 6)])].slice(0, 10);
    const niceToHave = lines.filter((l) => !isHeading(l) && /(nice to have|bonus|plus|preferred)/i.test(l)).slice(0, 5);
    const responsibilities = lines.filter((l) => !isHeading(l) && /^(you will|you'll|build|design|own|lead|develop|collaborate|drive|ship|work|partner|write)/i.test(l)).slice(0, 6);

    const freq = new Map<string, number>();
    for (const t of tokenize(text)) freq.set(t, (freq.get(t) ?? 0) + 1);
    const keywords = [...new Set([...skills, ...[...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)])].slice(0, 15);
    const seniority = text.match(/\b(intern|junior|mid-level|senior|staff|principal|lead|director|head of)\b/i)?.[1] ?? "";
    const location = text.match(/\b(remote|hybrid|on-site|onsite)\b/i)?.[1] ?? "";
    const prose = lines.filter((l) => l.length > 60 && !BULLET_RE.test(l)).join(" ");
    const summary = prose.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 320);

    return { title, company, location, seniority, mustHave, niceToHave, responsibilities, keywords, summary };
  }

  async tailorResume(input: TailorInput): Promise<TailorOutput> {
    const { profile, analysis, bulletScores, matchedSkills } = input;
    const matched = new Set(matchedSkills.map((s) => s.toLowerCase()));
    const skillOrder = [...profile.skills].sort((a, b) => Number(matched.has(b.toLowerCase())) - Number(matched.has(a.toLowerCase())));

    const bulletOrder: Record<number, number[]> = {};
    profile.experience.forEach((exp, ei) => {
      bulletOrder[ei] = exp.bullets.map((_, bi) => bi).sort((a, b) => (bulletScores[`${ei}:${b}`] ?? 0) - (bulletScores[`${ei}:${a}`] ?? 0));
    });

    const role = analysis.title || "this role";
    const summary = `${profile.headline || "Professional"} with hands-on experience in ${matchedSkills.slice(0, 4).join(", ") || profile.skills.slice(0, 4).join(", ")}, applying for ${role}${analysis.company ? ` at ${analysis.company}` : ""}. ${profile.summary}`.trim();

    const changeNotes = [
      `Reordered skills so ${matchedSkills.slice(0, 3).join(", ") || "role-relevant skills"} appear first.`,
      "Moved the most relevant bullets to the top of each role based on job-description overlap.",
      "Rewrote the summary to name the target role (template mode: no sentence-level rewriting).",
    ];

    return { resumeMarkdown: renderResumeMarkdown(profile, { summary, skillOrder, bulletOrder }), changeNotes };
  }

  async writeCoverLetter(input: CoverLetterInput): Promise<string> {
    const { profile, analysis, matchedSkills, evidence } = input;
    const role = analysis.title || "the open role";
    const company = analysis.company || "your team";
    const strengths = matchedSkills.slice(0, 4).join(", ");
    const evidenceLines = evidence.slice(0, 3).map((e) => `- ${e}`).join("\n");

    return `Dear Hiring Team,

I'm applying for the ${role} position at ${company}. ${analysis.summary ? `The posting's focus on ${analysis.mustHave.slice(0, 2).join(" and ") || "the role's core requirements"} lines up closely with my background.` : ""}

My experience most relevant to this role${strengths ? ` spans ${strengths}` : ""}:
${evidenceLines || "- (add a highlight from your resume here)"}

I'd welcome the chance to talk through how this experience maps to what ${company} needs. Thank you for your consideration.

Sincerely,
${profile.name || "Your Name"}`;
  }

  async listUnsupportedClaims(input: UnsupportedClaimsInput): Promise<string[]> {
    const inLetter = findSkills(input.coverLetter);
    const resumeSkills = new Set(findSkills(input.resumeText).map((s) => s.toLowerCase()));
    return inLetter.filter((s) => !resumeSkills.has(s.toLowerCase())).map((s) => `Mentions "${s}", which does not appear in the resume.`);
  }
}
