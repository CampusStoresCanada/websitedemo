import { redirect } from "next/navigation";

/**
 * /admin/integrations is superseded.
 * Circle is now directly at /admin/circle (sidebar: Configuration > Circle).
 * Stripe/QB integration status lives in Ops Health.
 */
export default function IntegrationsRedirectPage() {
  redirect("/admin/ops");
}
