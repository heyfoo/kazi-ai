"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="no-print mb-6 flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <span className="text-muted-foreground">Use your browser&apos;s print dialog and choose &quot;Save as PDF&quot;.</span>
      <Button size="sm" onClick={() => window.print()}>
        Print
      </Button>
    </div>
  );
}
