import * as cheerio from "cheerio";
import { fetchWithTimeout } from "./llm/generator";
import { collapseWhitespace } from "./text";

export class JobFetchError extends Error {
  constructor(
    message: string,
    public readonly needsManualPaste: boolean,
  ) {
    super(message);
  }
}

const BLOCKED_HOSTS = ["linkedin.com", "indeed.com", "glassdoor.com"];

function pickMain($: cheerio.CheerioAPI): string {
  const selectors = [
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[id*='job-description']",
    "[class*='description']",
    "article",
    "main",
    "[role='main']",
    "body",
  ];
  let best = "";
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const text = $(el).text();
      if (text.length > best.length) best = text;
    });
    if (best.length > 800) break;
  }
  return best;
}

export async function fetchJobDescription(url: string): Promise<{ text: string; title: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new JobFetchError("That doesn't look like a valid URL.", false);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new JobFetchError("Only http(s) links are supported.", false);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 KaziJobAgent/0.1",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      },
      20_000,
    );
  } catch (err) {
    throw new JobFetchError(`Could not reach ${parsed.hostname}: ${(err as Error).message}`, true);
  }

  const blocked = BLOCKED_HOSTS.some((h) => parsed.hostname.endsWith(h));
  if (!res.ok) {
    throw new JobFetchError(
      `${parsed.hostname} returned ${res.status}${blocked ? " (this site blocks automated readers)" : ""}. Paste the job description instead.`,
      true,
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header, iframe, form, button").remove();

  // Many boards embed the posting as JSON-LD JobPosting; prefer that when present.
  let ld = "";
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item && item["@type"] === "JobPosting") {
          const desc = cheerio.load(String(item.description ?? "")).text();
          ld = [item.title, item.hiringOrganization?.name ? `Company: ${item.hiringOrganization.name}` : "", desc].filter(Boolean).join("\n\n");
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  });

  const title = $("title").first().text().trim() || $("h1").first().text().trim();
  const body = ld || pickMain($);
  const text = collapseWhitespace(body.replace(/\n\s*\n/g, "\n"));

  if (text.length < 300) {
    throw new JobFetchError(
      `The page at ${parsed.hostname} rendered almost no text (it probably needs JavaScript or a login). Paste the job description instead.`,
      true,
    );
  }
  return { text: title ? `${title}\n\n${text}` : text, title };
}
