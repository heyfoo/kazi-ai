import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Frame, FrameLocator, Page } from "playwright";
import type { Job, ResumeProfile } from "./types";

export type Board = "greenhouse" | "lever" | "workable" | "generic";

export type FillPayload = {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  linkedIn: string;
  coverLetter: string;
  resumePath?: string;
};

type FieldKey = Exclude<keyof FillPayload, "resumePath">;

const FIELDS: Array<{ key: FieldKey; label: RegExp }> = [
  { key: "firstName", label: /first name/i },
  { key: "lastName", label: /last name/i },
  { key: "fullName", label: /full name|^name$/i },
  { key: "email", label: /e-?mail/i },
  { key: "phone", label: /phone|mobile/i },
  { key: "location", label: /location|city/i },
  { key: "linkedIn", label: /linkedin/i },
  { key: "coverLetter", label: /cover letter|additional information/i },
];

export function detectBoard(url: string): Board {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("greenhouse.io")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  if (host.includes("workable.com")) return "workable";
  return "generic";
}

export function payloadFrom(profile: ResumeProfile | undefined, job: Job, resumePath?: string): FillPayload {
  const fullName = profile?.name?.trim() || "Applicant";
  const parts = fullName.split(/\s+/).filter(Boolean);
  const linkedIn = profile?.links?.find((link) => /linkedin\.com/i.test(link)) ?? "";
  return {
    fullName,
    firstName: parts[0] ?? fullName,
    lastName: parts.slice(1).join(" "),
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    location: profile?.location ?? "",
    linkedIn,
    coverLetter: job.coverLetter ?? "",
    resumePath,
  };
}

export function writeResumeFile(job: Job, dir: string): string | undefined {
  if (!job.tailoredResume) return undefined;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${job.id}-resume.md`);
  writeFileSync(file, job.tailoredResume);
  return file;
}

type Scope = Page | Frame | FrameLocator;

async function applicationScope(page: Page): Promise<Scope> {
  const frame = page.locator('iframe[src*="greenhouse"], iframe[id*="grnhse"], iframe[title*="application" i]');
  if ((await frame.count()) > 0) {
    const inner = await frame.first().contentFrame();
    if (inner) return inner;
  }
  return page;
}

/** Opens the application form when the posting page only shows an Apply link. */
export async function maybeOpenApplication(page: Page): Promise<void> {
  const scope = await applicationScope(page);
  if ((await scope.getByLabel(/e-?mail/i).count()) > 0) return;
  const apply = scope
    .getByRole("link", { name: /apply for this job|^apply( now)?$/i })
    .or(scope.getByRole("button", { name: /apply for this job|^apply( now)?$/i }));
  if ((await apply.count()) > 0) await apply.first().click();
}

async function fillLabel(scope: Scope, label: RegExp, value: string): Promise<boolean> {
  const box = scope.getByLabel(label);
  if ((await box.count()) === 0 || !value) return false;
  await box.first().fill(value);
  return true;
}

/**
 * Types approved values into labeled fields. Never clicks Submit.
 * Returns the labels that were actually filled.
 */
export async function fillKnownFields(page: Page, payload: FillPayload): Promise<string[]> {
  await maybeOpenApplication(page);
  const scope = await applicationScope(page);
  const filled: string[] = [];

  for (const field of FIELDS) {
    const value = payload[field.key];
    if (!value) continue;
    if (await fillLabel(scope, field.label, value)) filled.push(field.key);
  }

  // Lever's comment box is the cover letter, and it is often unlabeled.
  if (payload.coverLetter && !filled.includes("coverLetter")) {
    const comments = scope.locator('textarea[name="comments"]');
    if ((await comments.count()) > 0) {
      await comments.first().fill(payload.coverLetter);
      filled.push("coverLetter");
    }
  }

  if (payload.resumePath) {
    const file = scope.locator('input[type="file"]');
    if ((await file.count()) > 0) {
      try {
        await file.first().setInputFiles(payload.resumePath);
        filled.push("resumePath");
      } catch {
        // The control rejected the markdown file. The user can upload a PDF.
      }
    }
  }

  return filled;
}

export async function readKnownFields(page: Page): Promise<Record<string, string>> {
  const scope = await applicationScope(page);
  const values: Record<string, string> = {};
  for (const field of FIELDS) {
    const box = scope.getByLabel(field.label);
    if ((await box.count()) === 0) continue;
    values[field.key] = await box.first().inputValue();
  }
  return values;
}

export function recordEdits(file: string, url: string, before: Record<string, string>, after: Record<string, string>) {
  const edits = Object.keys(before)
    .filter((key) => after[key] !== undefined && after[key] !== before[key])
    .map((key) => ({ field: key, from: before[key], to: after[key] }));
  if (edits.length === 0) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ url, edits, at: new Date().toISOString() }) + "\n");
}

const BANNER = (board: Board) => `
  const bar = document.createElement("div");
  bar.textContent = "Kazi filled the ${board} fields it recognized. Review them, then click Submit yourself. Kazi will not.";
  bar.setAttribute("style", "position:fixed;z-index:2147483647;left:0;right:0;bottom:0;padding:12px 16px;background:#111;color:#fff;font:14px/1.4 sans-serif");
  document.body.appendChild(bar);
`;

export async function runFillSession(options: {
  url: string;
  payload: FillPayload;
  headless?: boolean;
  editsFile?: string;
  /** When false, return as soon as the form is filled. The smoke test uses this. */
  waitForUser?: boolean;
}): Promise<{ board: Board; filled: string[] }> {
  const { chromium } = await import("playwright");
  const board = detectBoard(options.url);
  const browser: Browser = await chromium.launch({ headless: options.headless ?? false, slowMo: options.headless ? 0 : 40 });
  const page = await browser.newPage();
  await page.goto(options.url, { waitUntil: "domcontentloaded" });
  const filled = await fillKnownFields(page, options.payload);
  const before = await readKnownFields(page);

  if (options.waitForUser === false) {
    await browser.close();
    return { board, filled };
  }

  await page.evaluate(BANNER(board));
  let latest = before;
  const timer = setInterval(() => {
    readKnownFields(page).then((values) => {
      latest = values;
    }).catch(() => undefined);
  }, 1500);

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    browser.on("disconnected", done);
    page.on("close", done);
  });
  clearInterval(timer);
  if (options.editsFile) recordEdits(options.editsFile, options.url, before, latest);
  await browser.close().catch(() => undefined);
  return { board, filled };
}
