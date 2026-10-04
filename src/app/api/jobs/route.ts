import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/kazi/pipeline";
import { store } from "@/lib/kazi/store";
import { emptyUsage, type Job } from "@/lib/kazi/types";

export async function GET() {
  const db = await store.get();
  const jobs = [...db.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ jobs });
}

function parseLinks(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const candidate = raw.trim();
    if (!candidate) continue;
    const withProto = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    try {
      const url = new URL(withProto);
      if (!url.hostname.includes(".")) continue;
      const key = url.toString();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    } catch {
      // skip junk tokens
    }
  }
  return out;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { links?: string; run?: boolean };
  const links = parseLinks(body.links ?? "");
  if (links.length === 0) return NextResponse.json({ error: "Paste at least one job link." }, { status: 400 });

  const db = await store.get();
  if (!db.resume?.rawText) return NextResponse.json({ error: "Add your resume first so Kazi has something to tailor." }, { status: 400 });

  const now = new Date().toISOString();
  const created: Job[] = links.map((url) => ({
    id: nanoid(10),
    url,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    changeNotes: [],
    usage: emptyUsage(),
    log: [],
  }));

  await store.update((d) => {
    d.jobs.push(...created);
  });

  if (body.run !== false) for (const job of created) enqueueJob(job.id);
  return NextResponse.json({ jobs: created }, { status: 201 });
}
