import type { Brain } from "./brain/brain";
import { LlmBrain } from "./brain/llm-brain";
import { TemplateBrain } from "./brain/template-brain";
import { cached, contentHash } from "./cache";
import { gradeBullets, fabricationRisk, profileText, screenFit, type DecisionContext } from "./decide/decisions";
import { jevConfig } from "./decide/engine";
import { fetchJobDescription, JobFetchError } from "./fetch-job";
import { generatorChain, newTracker } from "./llm/router";
import { store } from "./store";
import { emptyUsage, type Job, type JobStatus, type ResumeProfile, type Usage } from "./types";

async function setStatus(id: string, status: JobStatus, note?: string) {
  await store.updateJob(id, { status });
  if (note) await store.appendLog(id, note);
}

async function brainForRun(): Promise<{ brain: Brain; chain: Awaited<ReturnType<typeof generatorChain>>; tracker: ReturnType<typeof newTracker> }> {
  const chain = await generatorChain();
  const tracker = newTracker();
  const brain: Brain = chain.length > 0 ? new LlmBrain(chain, tracker) : new TemplateBrain();
  return { brain, chain, tracker };
}

export async function ensureResumeProfile(brain: Brain, usage: Usage): Promise<{ profile: ResumeProfile; rawText: string }> {
  const db = await store.get();
  if (!db.resume?.rawText) throw new Error("No resume on file. Add your resume before running jobs.");
  const key = contentHash("profile", db.resume.rawText, brain.name);
  if (db.resume.profile && db.resume.profileEngine === key) {
    usage.cacheHits += 1;
    return { profile: db.resume.profile, rawText: db.resume.rawText };
  }
  const profile = await cached(key, () => brain.extractProfile(db.resume!.rawText), () => void (usage.cacheHits += 1));
  await store.update((d) => {
    if (d.resume) {
      d.resume.profile = profile;
      d.resume.profileEngine = key;
    }
  });
  return { profile, rawText: db.resume.rawText };
}

export async function runJob(jobId: string): Promise<Job> {
  const job = await store.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const usage: Usage = emptyUsage();
  const { brain, chain, tracker } = await brainForRun();
  const decisionCtx: DecisionContext = {
    chain,
    tracker,
    onDecision: (d) => {
      usage.decisionCalls += 1;
      usage.decisionTokensIn += d.tokensIn;
      usage.estimatedCostUsd += d.costUsd;
      if (!usage.engines.includes(`decide:${d.engine}`)) usage.engines.push(`decide:${d.engine}`);
    },
  };
  const decisionEngineKey = jevConfig() ? "jev" : chain.length ? `llm:${chain[0].name}` : "heuristic";

  await store.updateJob(jobId, { error: undefined, log: [] });
  await store.appendLog(jobId, `Brain: ${brain.name}. Decisions: ${decisionEngineKey}.`);

  try {
    const { profile, rawText } = await ensureResumeProfile(brain, usage);

    let jdText = job.jdText;
    if (!jdText || job.jdSource !== "pasted") {
      await setStatus(jobId, "fetching", `Fetching ${job.url}`);
      try {
        const fetched = await fetchJobDescription(job.url);
        jdText = fetched.text;
        await store.updateJob(jobId, { jdText, jdSource: "fetched" });
        await store.appendLog(jobId, `Fetched ${jdText.length} characters${fetched.title ? ` ("${fetched.title}")` : ""}`);
      } catch (err) {
        if (err instanceof JobFetchError && err.needsManualPaste) {
          await store.updateJob(jobId, { status: "needs_jd", error: err.message });
          await store.appendLog(jobId, `Fetch blocked: ${err.message}`);
          return (await store.getJob(jobId))!;
        }
        throw err;
      }
    }

    await setStatus(jobId, "analyzing", "Extracting structured requirements from the posting");
    const analysis = await cached(contentHash("jd", jdText, brain.name), () => brain.analyzeJob(jdText!, job.url), () => void (usage.cacheHits += 1));
    await store.updateJob(jobId, { analysis });

    await setStatus(jobId, "screening", "Screening fit and grading resume bullets");
    const fit = await screenFit(profile, analysis, decisionCtx);
    const bulletScores = await cached(contentHash("bullets", profile, analysis, decisionEngineKey), () => gradeBullets(profile, analysis, decisionCtx), () => void (usage.cacheHits += 1));
    await store.updateJob(jobId, { fit });
    await store.appendLog(jobId, `Fit: ${fit.recommendation} (${Math.round(fit.confidence * 100)}% via ${fit.engine}); ${fit.matchedSkills.length} matched, ${fit.missingSkills.length} missing must-haves`);

    await setStatus(jobId, "tailoring", "Tailoring resume");
    const tailored = await brain.tailorResume({ profile, analysis, bulletScores, matchedSkills: fit.matchedSkills });
    await store.updateJob(jobId, { tailoredResume: tailored.resumeMarkdown, changeNotes: tailored.changeNotes });

    await store.appendLog(jobId, "Writing cover letter");
    const evidence = profile.experience
      .flatMap((exp, ei) => exp.bullets.map((text, bi) => ({ text, score: bulletScores[`${ei}:${bi}`] ?? 1 })))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((b) => b.text);
    const coverLetter = await brain.writeCoverLetter({ profile, analysis, matchedSkills: fit.matchedSkills, evidence });
    await store.updateJob(jobId, { coverLetter });

    await setStatus(jobId, "verifying", "Checking the cover letter for unsupported claims");
    const { risk, engine } = await fabricationRisk(coverLetter, rawText, decisionCtx);
    const unsupportedClaims = risk >= 0.35 || chain.length === 0 ? await brain.listUnsupportedClaims({ coverLetter, resumeText: `${rawText}\n${profileText(profile)}` }) : [];
    await store.updateJob(jobId, { verification: { fabricationRisk: risk, unsupportedClaims, engine } });

    usage.generatorTokensIn = tracker.tokensIn;
    usage.generatorTokensOut = tracker.tokensOut;
    usage.generatorCalls = tracker.calls;
    for (const e of tracker.engines) if (!usage.engines.includes(e)) usage.engines.push(e);
    if (chain.length === 0) usage.engines.push("template");

    await store.updateJob(jobId, { status: "ready_for_review", usage });
    await store.appendLog(jobId, `Ready for review. ${usage.generatorCalls} LLM calls, ${usage.decisionCalls} decisions, ${usage.cacheHits} cache hits, est. $${usage.estimatedCostUsd.toFixed(4)}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.updateJob(jobId, { status: "error", error: message, usage });
    await store.appendLog(jobId, `Error: ${message}`);
  }
  return (await store.getJob(jobId))!;
}

// Local 3B models don't benefit from parallel requests, so the runner is sequential by default.
const CONCURRENCY = Math.max(1, Number(process.env.KAZI_CONCURRENCY ?? 1));

type Runner = { queue: string[]; active: Set<string> };
const g = globalThis as unknown as { __kaziRunner?: Runner };
const runner: Runner = (g.__kaziRunner ??= { queue: [], active: new Set() });

function pump() {
  while (runner.active.size < CONCURRENCY && runner.queue.length > 0) {
    const id = runner.queue.shift()!;
    runner.active.add(id);
    runJob(id)
      .catch(() => undefined)
      .finally(() => {
        runner.active.delete(id);
        pump();
      });
  }
}

export function enqueueJob(id: string) {
  if (runner.active.has(id) || runner.queue.includes(id)) return;
  runner.queue.push(id);
  pump();
}

export function isRunning(id: string) {
  return runner.active.has(id) || runner.queue.includes(id);
}
