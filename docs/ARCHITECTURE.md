# Kazi architecture and plan

## Goal

An agent that turns "here are 20 job links and my resume" into 20 reviewed, tailored applications, on hardware a job seeker actually owns (an 8 GB laptop), at close to zero marginal cost, without ever sending something the user has not approved.

## The loop

Each job link runs through the same state machine. Every step writes its result to the job record immediately, so a crash or a slow model never loses work and the UI can show progress live.

```
queued
  -> fetching        download the page, prefer JSON-LD JobPosting, else main-content extraction
      -> needs_jd    site blocked us: user pastes the description, job re-enters at analyzing
  -> analyzing       posting -> structured JSON (title, company, must-haves, nice-to-haves, keywords, summary)
  -> screening       apply / stretch / skip decision + relevance score for every resume bullet
  -> tailoring       reorder skills and bullets, rewrite the top bullets and summary, write the cover letter
  -> verifying       fabrication-risk score; list any claim the resume does not support
  -> ready_for_review
        -> approved -> applied        (user submits on the employer's site, then confirms)
        -> rejected
  -> error           anything unexpected; re-runnable
```

The resume is parsed into a structured profile once and cached. The job description is compressed into a structured analysis once and cached. Everything downstream works from those two compact JSON objects, not from raw text, which is what keeps prompts short enough for a 3B model and cheap enough for a paid one.

## Two kinds of model calls

Kazi separates **writing** from **deciding** because they have very different cost and quality profiles.

### Writing: the `Brain`

`src/lib/kazi/brain/brain.ts` defines five operations: `extractProfile`, `analyzeJob`, `tailorResume`, `writeCoverLetter`, `listUnsupportedClaims`. Two implementations:

- `LlmBrain` — prompts written for small instruction models: short, explicit key lists, one task per call, JSON mode where the provider supports it, and a single corrective retry that quotes the Zod validation error back when the output does not parse. It only rewrites the top ~8 bullets by relevance, and it filters out any skill the model "adds" that the candidate never listed.
- `TemplateBrain` — deterministic fallback when no model is reachable. Section-aware resume parser, skill lexicon, keyword-overlap ordering, templated summary and letter. It never invents content, so it is safe, just plain.

### Deciding: Jev and fallbacks

`src/lib/kazi/decide/engine.ts` speaks the Jev request shape (`state` + typed `questions` of kind `choice`, `score`, `noul`) and degrades gracefully:

1. **Jev** (`TYPESAFE_API_KEY` or a hosted `JEV_API_KEY`): one POST, all questions answered in parallel in a single forward pass, calibrated probabilities, no generated text. Published price is about $0.042 per million input tokens with free output. Screening a job plus grading 20 bullets is well under a cent.
2. **LLM fallback**: the writer model answers the same questions as JSON. Works, but confidences are self-reported and uncalibrated; the UI labels it as such.
3. **Heuristic fallback**: keyword coverage of must-haves and term overlap per bullet. Free and instant.

Three decisions use this layer:

| Decision | Question shape | Why not just generate? |
| --- | --- | --- |
| Fit screening | `choice` apply / stretch / skip | A probability lets the UI show "62% apply" and lets you skip bad-fit jobs before paying for tailoring. |
| Bullet relevance | one `score` (0–3) per bullet, in a single request | Tells the tailor which 8 bullets deserve rewriting and which to push down. |
| Fabrication risk | `noul` "does the letter claim anything the resume doesn't support?" | Gates the more expensive "list the unsupported claims" generation; only runs it when risk ≥ 0.35. |

## Provider routing

`src/lib/kazi/llm/router.ts` builds an ordered chain each run: **Ollama** (if reachable and the model is pulled) → **Groq** → **OpenRouter** (`:free` models) → **Gemini**. Each call tries the chain in order and moves on if a provider errors or rate-limits. `KAZI_LLM_PROVIDER` pins one provider or forces `mock` (template mode).

Why local first: it is free, private (your resume never leaves the machine), and on an 8 GB box a Q4 3B model (`qwen2.5:3b`, ~2 GB) runs at usable speed. 7–8B models technically fit but leave no RAM for the OS and browser, so they are not the default.

## Cost controls

- **Compress once, reuse everywhere.** Resume → profile JSON, posting → analysis JSON, both cached by content hash. Re-running a job or applying the same resume to 20 jobs does not re-parse.
- **Decisions are not generations.** Everything that is a judgment goes through the decision layer, where Jev is roughly two orders of magnitude cheaper than a frontier chat model and returns in ~300 ms.
- **Gate expensive steps on cheap ones.** Fit screening runs before tailoring; fabrication scoring runs before claim listing.
- **Small-model-friendly prompts.** Capped context (`num_ctx` 6144 for Ollama), truncated inputs, bounded `num_predict`, only the top bullets rewritten.
- **Per-job ledger.** Every job records generator tokens in/out, decision tokens, cache hits and an estimated USD cost, visible under "Activity & cost".
- **Sequential runner.** Concurrency defaults to 1 because a CPU-bound 3B model gets slower, not faster, under parallel load.

## Human in the loop

The agent stops at `ready_for_review` every time. The review page shows the fit decision with its probabilities, matched and missing must-haves, what Kazi changed and why, the truthfulness check, and editable resume and cover letter with Markdown preview, download, and print-to-PDF. **Approve** unlocks **Fill the form** and **Apply now**.

**Fill the form** (`src/lib/kazi/fill-form.ts`) launches a headed Playwright browser on a Greenhouse, Lever, or Workable posting, types the approved name, email, phone, cover letter, and resume file, and stops. The script never clicks Submit. While the window stays open it watches the fields, and when you close it any edits are appended to `data/form-edits.jsonl` for a later version to learn from. **Apply now** still just opens the posting.

Kazi does not auto-submit forms. Job boards block bots, most require accounts and consent, and a mis-submitted application is not recoverable.

## Storage

A single JSON file (`data/kazi.json`) behind a serialized read-modify-write queue, plus a content-hash cache directory. No database to install. Swap `store.ts` for SQLite if the job list grows past a few hundred.

## Roadmap (not built yet)

1. **Learn from form edits**: read `data/form-edits.jsonl` and prefer the wording you kept last time. The file is written now; nothing reads it yet.
2. **Fine-tuned style**: learn the user's edits across reviews (diff of generated vs approved) and feed them back as few-shot examples.
3. **Jev distillation**: once a user has screened a few hundred jobs, train a tiny local classifier on Jev's answers (the Jevstiller pattern) so screening runs fully offline.
4. **Batch import**: paste a search-results page or RSS feed instead of individual links.
5. **Application tracker**: follow-up reminders and status (interview, offer, rejected) on the `applied` state.
