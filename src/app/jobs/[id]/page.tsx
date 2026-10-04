import { JobReview } from "@/components/kazi/job-review";

export default async function JobPage(props: PageProps<"/jobs/[id]">) {
  const { id } = await props.params;
  return <JobReview id={id} />;
}
