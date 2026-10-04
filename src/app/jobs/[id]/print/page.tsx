import { notFound } from "next/navigation";
import { Markdown } from "@/components/kazi/markdown";
import { store } from "@/lib/kazi/store";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";

export default async function PrintPage(props: PageProps<"/jobs/[id]/print">) {
  const { id } = await props.params;
  const { doc } = await props.searchParams;
  const job = await store.getJob(id);
  if (!job) notFound();

  const isCover = doc === "cover";
  const content = isCover ? job.coverLetter : job.tailoredResume;

  return (
    <main className="mx-auto w-full max-w-[52rem] px-10 py-10 print:px-0 print:py-0">
      <PrintTrigger />
      {content ? (
        isCover ? (
          <div className="kazi-md whitespace-pre-wrap">{content}</div>
        ) : (
          <Markdown>{content}</Markdown>
        )
      ) : (
        <p className="text-sm text-muted-foreground">Nothing to print yet.</p>
      )}
    </main>
  );
}
