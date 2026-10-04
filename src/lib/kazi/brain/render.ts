import type { ResumeProfile } from "../types";

/** Renders a profile to Markdown. Shared by the template brain and as the skeleton the LLM brain fills in. */
export function renderResumeMarkdown(
  profile: ResumeProfile,
  opts: {
    summary?: string;
    skillOrder?: string[];
    bulletOrder?: Record<number, number[]>;
    rewrittenBullets?: Record<string, string>;
  } = {},
): string {
  const lines: string[] = [];
  lines.push(`# ${profile.name || "Your Name"}`, "");
  if (profile.headline) lines.push(`**${profile.headline}**`, "");
  const contact = [profile.email, profile.phone, profile.location, ...profile.links].filter(Boolean);
  if (contact.length) lines.push(contact.join(" · "), "");

  const summary = opts.summary ?? profile.summary;
  if (summary) {
    lines.push("## Summary", summary, "");
  }

  const skills = opts.skillOrder ?? profile.skills;
  if (skills.length) {
    lines.push("## Skills", skills.join(" · "), "");
  }

  if (profile.experience.length) {
    lines.push("## Experience");
    profile.experience.forEach((exp, ei) => {
      const head = [exp.title, exp.company].filter(Boolean).join(" — ");
      lines.push(`### ${head}${exp.dates ? `  \n_${exp.dates}_` : ""}`);
      const order = opts.bulletOrder?.[ei] ?? exp.bullets.map((_, i) => i);
      for (const bi of order) {
        const text = opts.rewrittenBullets?.[`${ei}:${bi}`] ?? exp.bullets[bi];
        if (text) lines.push(`- ${text}`);
      }
      lines.push("");
    });
  }

  if (profile.projects.length) {
    lines.push("## Projects");
    for (const p of profile.projects) {
      lines.push(`- **${p.name}** — ${p.description}`);
    }
    lines.push("");
  }

  if (profile.education.length) {
    lines.push("## Education");
    for (const e of profile.education) {
      lines.push(`- ${[e.degree, e.school].filter(Boolean).join(", ")}${e.dates ? ` (${e.dates})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}
