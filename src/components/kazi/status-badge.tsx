import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/kazi/labels";
import { ACTIVE_STATUSES, type JobStatus } from "@/lib/kazi/types";

export function StatusBadge({ status }: { status: JobStatus }) {
  const active = ACTIVE_STATUSES.includes(status) || status === "queued";
  return (
    <Badge variant={STATUS_TONE[status]} className="gap-1">
      {active && <Loader2 className="size-3 animate-spin" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}
