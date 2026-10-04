"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Link2, Play, RotateCcw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/kazi/client";
import { hostOf, RECOMMENDATION_LABEL, STATUS_PROGRESS } from "@/lib/kazi/labels";
import { ACTIVE_STATUSES, type Job, type ProviderStatus, type Resume } from "@/lib/kazi/types";
import { ProviderBanner } from "./provider-banner";
import { StatusBadge } from "./status-badge";

const SAMPLE_RESUME = `Amina Okafor
Full-stack engineer · Nairobi, Kenya · amina@example.com · github.com/aminaok

Summary
Full-stack engineer with 5 years building data-heavy web products for fintech and logistics teams. Comfortable owning features end to end, from Postgres schema to React UI, and mentoring junior developers.

Skills
TypeScript, React, Next.js, Node.js, PostgreSQL, Redis, Docker, AWS, GraphQL, Python, CI/CD, Tailwind

Experience
Senior Software Engineer at Sendy — Mar 2022 – Present
- Led migration of the dispatch dashboard from a legacy Angular app to Next.js, cutting page load time by 55%
- Designed a PostgreSQL event-sourcing schema that handles 2M daily shipment updates
- Mentored four junior engineers and introduced weekly code review sessions
- Built GraphQL APIs consumed by three mobile apps

Software Engineer at Cellulant — Jun 2019 – Feb 2022
- Shipped a payments reconciliation service in Node.js processing $40M monthly
- Containerised services with Docker and automated deployments with GitHub Actions on AWS
- Reduced reconciliation errors by 30% with an automated anomaly detection script in Python

Education
BSc Computer Science, University of Nairobi — 2015 – 2019

Projects
Shamba Stats — Open-source dashboard for smallholder farmers using Next.js and PostGIS`;

export function Dashboard() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [resumeDraft, setResumeDraft] = useState("");
  const [editingResume, setEditingResume] = useState(false);
  const [links, setLinks] = useState("");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshJobs = useCallback(async () => {
    try {
      const { jobs } = await api.jobs();
      setJobs(jobs);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null));
    api
      .resume()
      .then(({ resume }) => {
        setResume(resume);
        setEditingResume(!resume);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  // Fetch on mount and whenever activity flips; poll only while something is in flight.
  const anyActive = jobs?.some((j) => ACTIVE_STATUSES.includes(j.status) || j.status === "queued") ?? false;
  useEffect(() => {
    const tick = () => void refreshJobs();
    const first = setTimeout(tick, 0);
    const interval = anyActive ? setInterval(tick, 1500) : undefined;
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, [anyActive, refreshJobs]);

  async function saveResume() {
    setBusy("resume");
    setError(null);
    try {
      const { resume } = await api.saveResumeText(resumeDraft);
      setResume(resume);
      setEditingResume(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function uploadResume(file: File) {
    setBusy("resume");
    setError(null);
    try {
      const { resume } = await api.saveResumeFile(file);
      setResume(resume);
      setEditingResume(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addJobs() {
    setBusy("jobs");
    setError(null);
    try {
      await api.addJobs(links);
      setLinks("");
      await refreshJobs();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function rerun(id: string) {
    await api.runJob(id).catch((err) => setError((err as Error).message));
    await refreshJobs();
  }

  async function remove(id: string) {
    await api.deleteJob(id).catch((err) => setError((err as Error).message));
    await refreshJobs();
  }

  const reviewCount = jobs?.filter((j) => j.status === "ready_for_review").length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">K</div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Kazi</h1>
            <p className="text-sm text-muted-foreground">Paste job links. Kazi reads each posting, tailors your resume and cover letter, and waits for your approval before anything is sent.</p>
          </div>
        </div>
        <ProviderBanner status={status} />
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4" /> Your resume
            </CardTitle>
            <CardDescription>Stored locally in <code>data/kazi.json</code>. Parsed once, then reused for every job.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {resume && !editingResume ? (
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{resume.profile?.name || resume.fileName || "Resume on file"}</span>
                  <span className="text-xs text-muted-foreground">{resume.rawText.length.toLocaleString()} chars</span>
                </div>
                {resume.profile?.headline && <p className="text-muted-foreground">{resume.profile.headline}</p>}
                {resume.profile?.skills?.length ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{resume.profile.skills.slice(0, 12).join(" · ")}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Profile will be extracted on the first run.</p>
                )}
                <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{resume.rawText.slice(0, 1200)}</pre>
              </div>
            ) : (
              <Textarea
                value={resumeDraft}
                onChange={(e) => setResumeDraft(e.target.value)}
                placeholder="Paste your resume as plain text, or upload a PDF…"
                className="min-h-56 font-mono text-xs"
              />
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,text/plain,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadResume(f);
                e.target.value = "";
              }}
            />
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {resume && !editingResume ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResumeDraft(resume.rawText);
                  setEditingResume(true);
                }}
              >
                Edit text
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={saveResume} disabled={busy === "resume" || resumeDraft.trim().length < 200}>
                  Save resume
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setResumeDraft(SAMPLE_RESUME)}>
                  Use sample
                </Button>
                {resume && (
                  <Button variant="ghost" size="sm" onClick={() => setEditingResume(false)}>
                    Cancel
                  </Button>
                )}
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy === "resume"}>
              <Upload data-icon="inline-start" /> Upload PDF
            </Button>
          </CardFooter>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4" /> Job links
            </CardTitle>
            <CardDescription>One URL per line. Sites that block bots (LinkedIn, Indeed) will ask you to paste the description instead.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={links}
              onChange={(e) => setLinks(e.target.value)}
              placeholder={"https://boards.greenhouse.io/acme/jobs/123\nhttps://jobs.lever.co/acme/456"}
              className="min-h-40 font-mono text-xs"
              disabled={!resume}
            />
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{resume ? "Each link runs: fetch → analyze → screen fit → tailor → verify → your review." : "Save a resume to enable job links."}</p>
            <Button onClick={addJobs} disabled={!resume || busy === "jobs" || !links.trim()}>
              <Play data-icon="inline-start" /> Run Kazi
            </Button>
          </CardFooter>
        </Card>
      </div>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Applications</h2>
          {reviewCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {reviewCount} waiting for your review
            </span>
          )}
        </div>

        {jobs === null ? (
          <div className="grid gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">No applications yet. Add a resume and a few job links above to get started.</CardContent>
          </Card>
        ) : (
          <ul className="grid gap-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Card className="gap-3 py-4">
                  <CardContent className="grid gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/jobs/${job.id}`} className="font-medium hover:underline">
                          {job.analysis?.title || hostOf(job.url)}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {job.analysis?.company ? `${job.analysis.company} · ` : ""}
                          {job.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {job.fit && (
                          <span className="text-xs text-muted-foreground">
                            {RECOMMENDATION_LABEL[job.fit.recommendation]} · {Math.round(job.fit.confidence * 100)}%
                          </span>
                        )}
                        <StatusBadge status={job.status} />
                      </div>
                    </div>
                    <Progress value={STATUS_PROGRESS[job.status]} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="truncate text-xs text-muted-foreground">{job.error ?? job.log.at(-1)?.slice(9) ?? ""}</p>
                      <div className="flex items-center gap-1">
                        {(job.status === "error" || job.status === "ready_for_review" || job.status === "rejected") && (
                          <Button variant="ghost" size="xs" onClick={() => rerun(job.id)}>
                            <RotateCcw data-icon="inline-start" /> Re-run
                          </Button>
                        )}
                        <Button variant="ghost" size="xs" onClick={() => remove(job.id)} aria-label="Delete">
                          <Trash2 />
                        </Button>
                        <Button variant="outline" size="xs" nativeButton={false} render={<Link href={`/jobs/${job.id}`} />}>
                          {job.status === "needs_jd" ? "Paste description" : "Open"} <ArrowRight data-icon="inline-end" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
