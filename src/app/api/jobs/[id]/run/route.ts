import { NextResponse } from "next/server";
import { enqueueJob, isRunning } from "@/lib/kazi/pipeline";
import { store } from "@/lib/kazi/store";
import { ACTIVE_STATUSES } from "@/lib/kazi/types";

export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/run">) {
  const { id } = await ctx.params;
  const job = await store.getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (isRunning(id) || ACTIVE_STATUSES.includes(job.status)) {
    return NextResponse.json({ job, running: true });
  }
  await store.updateJob(id, { status: "queued" });
  enqueueJob(id);
  return NextResponse.json({ job: await store.getJob(id), running: true });
}
