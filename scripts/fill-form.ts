import path from "node:path";
import { payloadFrom, runFillSession, writeResumeFile } from "../src/lib/kazi/fill-form";
import { store } from "../src/lib/kazi/store";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: tsx scripts/fill-form.ts <jobId>");
    process.exit(1);
  }

  const db = await store.get();
  const job = db.jobs.find((item) => item.id === id);
  if (!job) {
    console.error(`Job ${id} not found`);
    process.exit(1);
  }
  if (job.status !== "approved") {
    console.error("Approve the application before filling the form.");
    process.exit(1);
  }
  if (!job.coverLetter && !job.tailoredResume) {
    console.error("This job has no approved documents to type in.");
    process.exit(1);
  }

  const resumePath = writeResumeFile(job, path.join(store.dataDir, "exports"));
  const payload = payloadFrom(db.resume?.profile, job, resumePath);

  await store.appendLog(id, "Form fill started. Kazi will type approved fields and will not click Submit.");
  try {
    const result = await runFillSession({
      url: job.url,
      payload,
      editsFile: path.join(store.dataDir, "form-edits.jsonl"),
    });
    await store.appendLog(id, `Form fill closed (${result.board}). Filled: ${result.filled.join(", ") || "nothing recognized"}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.appendLog(id, `Form fill failed: ${message}`);
    process.exit(1);
  }
}

main();
