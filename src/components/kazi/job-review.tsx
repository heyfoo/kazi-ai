"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Download, ExternalLink, Eye, Pencil, Printer, RotateCcw, Save, ShieldAlert, ShieldCheck, TextCursorInput, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, downloadText, slug } from "@/lib/kazi/client";
import { engineLabel, hostOf, RECOMMENDATION_LABEL, STATUS_LABEL, STATUS_PROGRESS } from "@/lib/kazi/labels";
import { ACTIVE_STATUSES, type Job } from "@/lib/kazi/types";
import { Markdown } from "./markdown";
import { StatusBadge } from "./status-badge";

export function JobReview({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [resumeDraft, setResumeDraft] = useState("");
  const [coverDraft, setCoverDraft] = useState("");
  const [jdDraft, setJdDraft] = useState("");
  const [preview, setPreview] = useState<{ resume: boolean; cover: boolean }>({ resume: true, cover: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { job } = await api.job(id);
      setJob((prev) => {
        // Don't clobber in-progress edits when polling.
        if (!prev || prev.status !== job.status || prev.updatedAt !== job.updatedAt) {
          if (!prev || prev.tailoredResume !== job.tailoredResume) setResumeDraft(job.tailoredResume ?? "");
          if (!prev || prev.coverLetter !== job.coverLetter) setCoverDraft(job.coverLetter ?? "");
        }
        return job;
      });
    } catch (err) {
      if ((err as Error).message.includes("not found")) setNotFound(true);
      else setError((err as Error).message);
    }
  }, [id]);

  const active = job ? ACTIVE_STATUSES.includes(job.status) || job.status === "queued" : false;
  useEffect(() => {
    const tick = () => void load();
    const first = setTimeout(tick, 0);
    const interval = active ? setInterval(tick, 1200) : undefined;
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, [active, load]);

  if (notFound) {
    return (
      <Shell>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">This application no longer exists.</CardContent>
        </Card>
      </Shell>
    );
  }
  if (!job) {
    return (
      <Shell>
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </Shell>
    );
  }

  const dirty = resumeDraft !== (job.tailoredResume ?? "") || coverDraft !== (job.coverLetter ?? "");
  const title = job.analysis?.title || hostOf(job.url);
  const fileBase = slug(`${job.analysis?.company ?? hostOf(job.url)}-${job.analysis?.title ?? "role"}`);

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const saveEdits = () => run("save", () => api.patchJob(id, { tailoredResume: resumeDraft, coverLetter: coverDraft }));
  const act = (action: "approve" | "reject" | "reopen" | "applied") =>
    run(action, async () => {
      if (dirty) await api.patchJob(id, { tailoredResume: resumeDraft, coverLetter: coverDraft });
      await api.patchJob(id, { action });
    });

  return (
    <Shell>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">
              {job.analysis?.company && <span>{job.analysis.company} · </span>}
              <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                {hostOf(job.url)} <ExternalLink className="size-3" />
              </a>
              {job.analysis?.location && <span> · {job.analysis.location}</span>}
            </p>
          </div>
          <StatusBadge status={job.status} />
        </div>
        {active && (
          <div className="grid gap-1">
            <Progress value={STATUS_PROGRESS[job.status]} />
            <p className="text-xs text-muted-foreground">{job.log.at(-1)?.slice(9) ?? STATUS_LABEL[job.status]}</p>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {job.status === "needs_jd" && (
        <Card>
          <CardHeader>
            <CardTitle>Paste the job description</CardTitle>
            <CardDescription>{job.error}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Textarea value={jdDraft} onChange={(e) => setJdDraft(e.target.value)} className="min-h-64 text-sm" placeholder="Copy the full posting text from the job page and paste it here…" />
            <div className="flex gap-2">
              <Button onClick={() => run("jd", () => api.patchJob(id, { jdText: jdDraft }))} disabled={jdDraft.trim().length < 100 || busy === "jd"}>
                Run with this description
              </Button>
              <Button variant="outline" onClick={() => run("retry", () => api.runJob(id))}>
                <RotateCcw data-icon="inline-start" /> Retry fetch
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {job.status === "error" && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Kazi hit a problem</AlertTitle>
          <AlertDescription>
            <p>{job.error}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => run("retry", () => api.runJob(id))}>
              <RotateCcw data-icon="inline-start" /> Re-run
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {job.fit && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Fit screening
                <Badge variant={job.fit.recommendation === "apply" ? "default" : job.fit.recommendation === "stretch" ? "secondary" : "destructive"}>
                  {RECOMMENDATION_LABEL[job.fit.recommendation]}
                </Badge>
              </CardTitle>
              <CardDescription>
                {Math.round(job.fit.confidence * 100)}% confidence via {engineLabel(job.fit.engine)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="grid gap-1.5">
                {(["apply", "stretch", "skip"] as const).map((k) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-14 text-muted-foreground">{k}</span>
                    <Progress value={Math.round((job.fit!.probabilities[k] ?? 0) * 100)} className="flex-1" />
                    <span className="w-9 text-right tabular-nums">{Math.round((job.fit!.probabilities[k] ?? 0) * 100)}%</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Matched</p>
                <div className="flex flex-wrap gap-1">
                  {job.fit.matchedSkills.length ? job.fit.matchedSkills.slice(0, 14).map((s) => <Badge key={s} variant="secondary">{s}</Badge>) : <span className="text-xs text-muted-foreground">Nothing matched yet</span>}
                </div>
              </div>
              {job.fit.missingSkills.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Missing must-haves</p>
                  <div className="flex flex-wrap gap-1">
                    {job.fit.missingSkills.slice(0, 10).map((s) => (
                      <Badge key={s} variant="outline" className="max-w-full truncate">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {job.verification && job.verification.fabricationRisk < 0.35 && job.verification.unsupportedClaims.length === 0 ? <ShieldCheck className="size-4 text-emerald-600" /> : <ShieldAlert className="size-4 text-amber-600" />}
                Truthfulness check
              </CardTitle>
              <CardDescription>
                {job.verification ? `Fabrication risk ${Math.round(job.verification.fabricationRisk * 100)}% via ${engineLabel(job.verification.engine)}` : "Runs after the cover letter is written"}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {!job.verification ? (
                <p className="text-muted-foreground">Pending.</p>
              ) : job.verification.unsupportedClaims.length === 0 ? (
                <p className="text-muted-foreground">Every claim in the cover letter traces back to your resume.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  {job.verification.unsupportedClaims.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              {job.changeNotes.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">What Kazi changed</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {job.changeNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {(job.tailoredResume || job.coverLetter) && (
        <Card>
          <CardContent className="pt-2">
            <Tabs defaultValue="resume">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="resume">Tailored resume</TabsTrigger>
                  <TabsTrigger value="cover">Cover letter</TabsTrigger>
                  <TabsTrigger value="analysis">Job analysis</TabsTrigger>
                  <TabsTrigger value="log">Activity & cost</TabsTrigger>
                </TabsList>
                {dirty && (
                  <Button size="sm" onClick={saveEdits} disabled={busy === "save"}>
                    <Save data-icon="inline-start" /> Save edits
                  </Button>
                )}
              </div>

              <TabsContent value="resume" className="mt-3">
                <DocEditor
                  value={resumeDraft}
                  onChange={setResumeDraft}
                  preview={preview.resume}
                  onTogglePreview={() => setPreview((p) => ({ ...p, resume: !p.resume }))}
                  onDownload={() => downloadText(`${fileBase}-resume.md`, resumeDraft)}
                  printHref={`/jobs/${id}/print?doc=resume`}
                  editable={!active}
                />
              </TabsContent>
              <TabsContent value="cover" className="mt-3">
                <DocEditor
                  value={coverDraft}
                  onChange={setCoverDraft}
                  preview={preview.cover}
                  onTogglePreview={() => setPreview((p) => ({ ...p, cover: !p.cover }))}
                  onDownload={() => downloadText(`${fileBase}-cover-letter.md`, coverDraft)}
                  printHref={`/jobs/${id}/print?doc=cover`}
                  editable={!active}
                  plain
                />
              </TabsContent>
              <TabsContent value="analysis" className="mt-3">
                {job.analysis ? <AnalysisView job={job} /> : <p className="text-sm text-muted-foreground">Not analysed yet.</p>}
              </TabsContent>
              <TabsContent value="log" className="mt-3 grid gap-3">
                <UsageView job={job} />
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{job.log.join("\n") || "No activity yet."}</pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {(job.status === "ready_for_review" || job.status === "approved" || job.status === "rejected" || job.status === "applied") && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {job.status === "ready_for_review" && "Review and edit, then approve to unlock applying."}
              {job.status === "approved" && (fillNote ?? "Approved. Fill the form types your documents in and stops before Submit. You click Submit, then confirm here.")}
              {job.status === "rejected" && "Rejected. Nothing will be sent for this role."}
              {job.status === "applied" && `Applied ${job.appliedAt ? new Date(job.appliedAt).toLocaleString() : ""}.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {job.status === "ready_for_review" && (
                <>
                  <Button variant="outline" onClick={() => act("reject")} disabled={busy !== null}>
                    <X data-icon="inline-start" /> Reject
                  </Button>
                  <Button onClick={() => act("approve")} disabled={busy !== null}>
                    <Check data-icon="inline-start" /> Approve
                  </Button>
                </>
              )}
              {job.status === "approved" && (
                <>
                  <Button variant="outline" onClick={() => act("reopen")} disabled={busy !== null}>
                    Back to review
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      run("fill", async () => {
                        const result = await api.fillForm(id);
                        setFillNote(`A ${result.board} window is opening with the approved details filled in. Kazi will not click Submit.`);
                      })
                    }
                  >
                    <TextCursorInput data-icon="inline-start" /> Fill the form
                  </Button>
                  <Button
                    onClick={() => {
                      window.open(job.url, "_blank", "noopener");
                      setApplyOpen(true);
                    }}
                  >
                    <ExternalLink data-icon="inline-start" /> Apply now
                  </Button>
                </>
              )}
              {(job.status === "rejected" || job.status === "applied") && (
                <Button variant="outline" onClick={() => act("reopen")} disabled={busy !== null}>
                  Reopen
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit on the employer&apos;s site</DialogTitle>
            <DialogDescription>
              The posting opened in a new tab. Download or print the approved documents, submit the application there, then confirm so Kazi records it. Kazi never submits forms on your behalf: job boards block bots and most require accounts and consent.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadText(`${fileBase}-resume.md`, resumeDraft)}>
              <Download data-icon="inline-start" /> Resume (.md)
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadText(`${fileBase}-cover-letter.md`, coverDraft)}>
              <Download data-icon="inline-start" /> Cover letter (.md)
            </Button>
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/jobs/${id}/print?doc=resume`} target="_blank" rel="noreferrer" />}>
              <Printer data-icon="inline-start" /> Print resume to PDF
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApplyOpen(false)}>
              Not yet
            </Button>
            <Button
              onClick={() => {
                setApplyOpen(false);
                void act("applied");
              }}
            >
              <Check data-icon="inline-start" /> I submitted it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <Link href="/" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All applications
      </Link>
      {children}
    </div>
  );
}

function DocEditor(props: {
  value: string;
  onChange: (v: string) => void;
  preview: boolean;
  onTogglePreview: () => void;
  onDownload: () => void;
  printHref: string;
  editable: boolean;
  plain?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={props.onTogglePreview} disabled={!props.editable}>
          {props.preview ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          {props.preview ? "Edit" : "Preview"}
        </Button>
        <Button variant="ghost" size="xs" onClick={props.onDownload}>
          <Download data-icon="inline-start" /> Download
        </Button>
        <Button variant="ghost" size="xs" nativeButton={false} render={<a href={props.printHref} target="_blank" rel="noreferrer" />}>
          <Printer data-icon="inline-start" /> Print / PDF
        </Button>
      </div>
      {props.preview ? (
        <div className="rounded-lg border bg-card p-5">
          {props.plain ? <div className="kazi-md whitespace-pre-wrap">{props.value}</div> : <Markdown>{props.value}</Markdown>}
        </div>
      ) : (
        <Textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} className="min-h-[28rem] font-mono text-xs" />
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisView({ job }: { job: Job }) {
  const a = job.analysis!;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-3">
        <p className="text-sm">{a.summary}</p>
        <div className="flex flex-wrap gap-1 text-xs">
          {a.seniority && <Badge variant="outline">{a.seniority}</Badge>}
          {a.location && <Badge variant="outline">{a.location}</Badge>}
          <Badge variant="outline">{job.jdSource === "pasted" ? "pasted description" : "fetched"}</Badge>
        </div>
        <Section title="Must-have" items={a.mustHave} />
        <Section title="Nice-to-have" items={a.niceToHave} />
      </div>
      <div className="grid gap-3">
        <Section title="Responsibilities" items={a.responsibilities} />
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">ATS keywords</p>
          <div className="flex flex-wrap gap-1">
            {a.keywords.map((k) => (
              <Badge key={k} variant="secondary">{k}</Badge>
            ))}
          </div>
        </div>
        {job.jdText && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Raw posting text ({job.jdText.length.toLocaleString()} chars)</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">{job.jdText}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function UsageView({ job }: { job: Job }) {
  const u = job.usage;
  const cells: Array<[string, string]> = [
    ["LLM calls", String(u.generatorCalls)],
    ["LLM tokens", `${u.generatorTokensIn.toLocaleString()} in / ${u.generatorTokensOut.toLocaleString()} out`],
    ["Decisions", `${u.decisionCalls} (${u.decisionTokensIn.toLocaleString()} tokens)`],
    ["Cache hits", String(u.cacheHits)],
    ["Estimated cost", `$${u.estimatedCostUsd.toFixed(4)}`],
    ["Engines", u.engines.join(", ") || "—"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      {cells.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="truncate font-medium" title={v}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
