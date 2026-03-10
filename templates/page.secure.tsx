import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";

export default async function SecurePage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : "/");
  }

  return <div>Secure page content</div>;
}
