import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueJob, isRunning } from "@/lib/kazi/pipeline";
import { store } from "@/lib/kazi/store";
import { collapseWhitespace } from "@/lib/kazi/text";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await store.getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job, running: isRunning(id) });
}

const Patch = z.object({
  tailoredResume: z.string().optional(),
  coverLetter: z.string().optional(),
  jdText: z.string().optional(),
  action: z.enum(["approve", "reject", "reopen", "applied"]).optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;

  const existing = await store.getJob(id);
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  let rerun = false;
  const job = await store.updateJob(id, (job) => {
    if (body.tailoredResume !== undefined) job.tailoredResume = body.tailoredResume;
    if (body.coverLetter !== undefined) job.coverLetter = body.coverLetter;
    if (body.jdText !== undefined) {
      const text = collapseWhitespace(body.jdText);
      if (text.length >= 100) {
        job.jdText = text;
        job.jdSource = "pasted";
        job.error = undefined;
        job.status = "queued";
        rerun = true;
      }
    }
    switch (body.action) {
      case "approve":
        if (job.status === "ready_for_review" || job.status === "rejected") job.status = "approved";
        break;
      case "reject":
        if (job.status === "ready_for_review" || job.status === "approved") job.status = "rejected";
        break;
      case "reopen":
        if (job.status === "approved" || job.status === "rejected" || job.status === "applied") {
          job.status = "ready_for_review";
          job.appliedAt = undefined;
        }
        break;
      case "applied":
        if (job.status === "approved") {
          job.status = "applied";
          job.appliedAt = new Date().toISOString();
        }
        break;
    }
  });

  if (rerun) enqueueJob(id);
  return NextResponse.json({ job });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  await store.update((db) => {
    db.jobs = db.jobs.filter((j) => j.id !== id);
  });
  return NextResponse.json({ ok: true });
}
