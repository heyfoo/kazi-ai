"use client";

import { Cpu, ShieldCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProviderStatus } from "@/lib/kazi/types";

export function ProviderBanner({ status }: { status: ProviderStatus | null }) {
  if (!status) return <Skeleton className="h-16 w-full" />;

  const templateMode = !status.generator.available;
  return (
    <div className="grid gap-3">
      {templateMode && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Template mode: no LLM is reachable</AlertTitle>
          <AlertDescription>
            Kazi still parses, screens and reorders your resume deterministically, but sentence-level rewriting needs a model. On an 8 GB PC, install{" "}
            <a href="https://ollama.com" target="_blank" rel="noreferrer">
              Ollama
            </a>{" "}
            and run <code className="rounded bg-muted px-1">ollama pull qwen2.5:3b</code>, or add a free API key (Groq, OpenRouter, Gemini) to <code className="rounded bg-muted px-1">.env.local</code>.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Cpu className="size-4" />
          Writer:
          <Badge variant={status.generator.available ? "default" : "outline"}>
            {status.generator.name}
            {status.generator.available ? ` · ${status.generator.model}` : ""}
          </Badge>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-4" />
          Decisions:
          <Badge variant={status.decision.name === "jev" ? "default" : "outline"}>{status.decision.name}</Badge>
        </span>
        <span className="hidden text-xs sm:inline">{status.decision.detail}</span>
      </div>
    </div>
  );
}
