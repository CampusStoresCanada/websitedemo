import { redirect } from "next/navigation";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { loadSurveyFlags } from "@/lib/actions/benchmarking-flags";
import IssueQueue from "@/components/benchmarking/admin/IssueQueue";

export const metadata = {
  title: "Reported problems | Benchmarking Admin",
};

/**
 * What respondents said was wrong while filling the survey.
 *
 * Gated here as well as in the layout. The shell is the front door, not the
 * lock — submissions and flags once carried no check of their own and inherited
 * whoever the shell let in.
 */
export default async function BenchmarkingIssuesPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");
  if (!isGlobalAdmin(auth.ctx.globalRole)) redirect("/benchmarking/admin");

  const issues = await loadSurveyFlags();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Reported problems</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-600">
        Raised from inside the survey with the toolkit&apos;s Flag, the same one used
        everywhere else on the site, with the section they were on attached.
        A report nobody answers is the expensive one: the store that wrote it learns that
        telling us costs effort and changes nothing, and the next time it meets a question
        it cannot answer it guesses instead.
      </p>
      <IssueQueue issues={issues} />
    </div>
  );
}
