import type { Job, ProviderStatus, Resume } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  status: () => request<ProviderStatus>("/api/status"),
  resume: () => request<{ resume: Resume | null }>("/api/resume"),
  saveResumeText: (text: string) => request<{ resume: Resume }>("/api/resume", { method: "POST", body: JSON.stringify({ text }) }),
  saveResumeFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ resume: Resume }>("/api/resume", { method: "POST", body: form });
  },
  jobs: () => request<{ jobs: Job[] }>("/api/jobs"),
  addJobs: (links: string) => request<{ jobs: Job[] }>("/api/jobs", { method: "POST", body: JSON.stringify({ links }) }),
  job: (id: string) => request<{ job: Job; running: boolean }>(`/api/jobs/${id}`),
  runJob: (id: string) => request<{ job: Job }>(`/api/jobs/${id}/run`, { method: "POST" }),
  patchJob: (id: string, patch: { tailoredResume?: string; coverLetter?: string; jdText?: string; action?: "approve" | "reject" | "reopen" | "applied" }) =>
    request<{ job: Job }>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteJob: (id: string) => request<{ ok: true }>(`/api/jobs/${id}`, { method: "DELETE" }),
};

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
}
