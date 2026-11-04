import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { detectBoard } from "@/lib/kazi/fill-form";
import { store } from "@/lib/kazi/store";

const running = new Set<string>();

export async function POST(_req: Request, ctx: RouteContext<"/api/jobs/[id]/fill">) {
  const { id } = await ctx.params;
  const job = await store.getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "approved") {
    return NextResponse.json({ error: "Approve the application before Kazi fills the form." }, { status: 409 });
  }
  if (!job.coverLetter && !job.tailoredResume) {
    return NextResponse.json({ error: "There are no approved documents to type in." }, { status: 409 });
  }
  if (running.has(id)) return NextResponse.json({ started: true, board: detectBoard(job.url), alreadyRunning: true });

  running.add(id);
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/fill-form.ts", id], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.on("exit", () => running.delete(id));
  child.on("error", () => running.delete(id));
  child.unref();

  return NextResponse.json({ started: true, board: detectBoard(job.url) });
}
