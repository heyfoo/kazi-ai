# Kazi — job application agent

Kazi takes a list of job links and your resume, reads each posting, screens whether the role is worth applying to, tailors a resume and cover letter for it, checks the cover letter for claims your resume does not support, and then **waits for you**. Nothing is approved or applied without your review.

It is built to run on cheap or free inference: a local 3B model through Ollama on an 8 GB PC, free cloud tiers as fallbacks, and TypeSafe's Jev decision model for the yes/no judgments that do not need a text generator.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design, the cost strategy, and the roadmap.

## Run it locally

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env.local   # optional; everything works without it
npm run dev -- --port 4717
```

Open <http://127.0.0.1:4717>.

1. Paste your resume (or upload a PDF) and save it.
2. Paste job links, one per line, and press **Run Kazi**.
3. Open each application when it reaches **Ready for review**. Edit the resume or cover letter, then **Approve** or **Reject**.
4. **Approve**, then **Fill the form**. Playwright opens the posting in a visible browser, types the approved details, and stops before Submit. You click Submit, then confirm so Kazi marks it **Applied**. **Apply now** only opens the link if you would rather paste the documents yourself.

The first time you fill a form, install the browser Kazi drives:

```bash
npx playwright install chromium
```

Sites that block automated readers (LinkedIn, Indeed, Glassdoor, JavaScript-only boards) land in **Needs job description**; paste the posting text and Kazi continues.

All data stays on your machine in `data/` (ignored by git).

## Choosing a model

| Setup | What to do | Notes |
| --- | --- | --- |
| 8 GB PC, no GPU (default) | Install [Ollama](https://ollama.com), then `ollama pull qwen2.5:3b` | ~2 GB RAM, 15–30 tok/s on a modern CPU. `llama3.2:3b` is a fine alternative. |
| 8 GB PC with a free API key | Set `GROQ_API_KEY`, `OPENROUTER_API_KEY`, or `GEMINI_API_KEY` in `.env.local` | Kazi uses Ollama first when it is up, then these in order. |
| Nothing configured | Just run it | **Template mode**: resume parsing, screening, reordering and templated letters, all deterministic. Good for trying the flow, not for sending. |
| Calibrated decisions | Set `TYPESAFE_API_KEY` | Jev answers "apply / stretch / skip", grades every bullet, and scores fabrication risk for fractions of a cent per job. |

Run `GET /api/status` (or look at the banner on the dashboard) to see which writer and decision engine are live.

## Project layout

```
src/app/                    Next.js App Router pages and API routes
  api/resume                save / read the resume (text or PDF)
  api/jobs                  add links, list, update, run
  api/status                which LLM / decision engine is active
  jobs/[id]                 review page; jobs/[id]/print for PDF export
src/components/kazi/        dashboard, review page, provider banner
src/lib/kazi/
  pipeline.ts               the agent loop: fetch -> analyze -> screen -> tailor -> verify -> review
  llm/                      provider router: Ollama, Groq, OpenRouter, Gemini
  decide/                   Jev adapter + LLM and heuristic fallbacks; fit / bullet / fabrication decisions
  brain/                    writers: LlmBrain (prompts tuned for 3B models) and TemplateBrain
  fetch-job.ts              HTML / JSON-LD job description extraction
  store.ts, cache.ts        JSON file store and content-hash cache
```

## Scripts

```bash
npm run dev     # start the dev server
npm run lint    # eslint
npm run build   # production build
```
