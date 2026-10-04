/** Common skills Kazi can recognise without a model. Matching is case-insensitive, whole-token. */
export const SKILL_LEXICON: string[] = [
  // languages
  "python", "javascript", "typescript", "java", "kotlin", "swift", "go", "golang", "rust", "c", "c++", "c#", "ruby", "php", "scala", "r", "sql", "bash", "dart", "elixir",
  // web / frontend
  "react", "next.js", "nextjs", "vue", "nuxt", "angular", "svelte", "html", "css", "tailwind", "sass", "redux", "webpack", "vite", "graphql", "rest", "websockets", "accessibility", "figma",
  // backend / data
  "node.js", "nodejs", "express", "nestjs", "django", "flask", "fastapi", "spring", "rails", "laravel", ".net", "postgresql", "postgres", "mysql", "sqlite", "mongodb", "redis", "elasticsearch", "kafka", "rabbitmq", "dynamodb", "snowflake", "bigquery", "spark", "hadoop", "airflow", "dbt", "etl", "pandas", "numpy",
  // ml / ai
  "machine learning", "deep learning", "pytorch", "tensorflow", "scikit-learn", "llm", "nlp", "computer vision", "rag", "langchain", "hugging face", "mlops", "prompt engineering",
  // cloud / devops
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "ansible", "ci/cd", "github actions", "jenkins", "linux", "nginx", "serverless", "lambda", "cloudflare", "vercel", "monitoring", "observability", "grafana", "prometheus", "datadog",
  // mobile
  "ios", "android", "react native", "flutter",
  // practices
  "agile", "scrum", "kanban", "tdd", "unit testing", "integration testing", "code review", "microservices", "distributed systems", "system design", "performance optimization", "security", "oauth", "api design", "technical writing", "mentoring", "leadership", "stakeholder management", "product management", "roadmap", "analytics", "a/b testing", "data analysis", "excel", "tableau", "power bi", "looker", "jira", "confluence", "git",
  // soft
  "communication", "collaboration", "problem solving", "customer focus", "cross-functional",
];

export function findSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const skill of SKILL_LEXICON) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9+#.])${escaped}(?=$|[^a-z0-9+#])`, "i");
    if (re.test(lower)) found.push(skill);
  }
  // Prefer canonical duplicates (next.js over nextjs, etc.)
  const dedupe = new Map<string, string>();
  for (const s of found) {
    const key = s.replace(/[^a-z0-9+#]/g, "");
    if (!dedupe.has(key)) dedupe.set(key, s);
  }
  return [...dedupe.values()];
}
