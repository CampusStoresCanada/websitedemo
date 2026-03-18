import { getCircleCutoverStatus } from "@/lib/circle/cutover";
import CircleCutoverClient from "./CircleCutoverClient";

export const metadata = {
  title: "Circle Cutover | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CircleCutoverPage() {
  const status = await getCircleCutoverStatus();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Circle Integration Cutover</h1>
        <p className="mt-1 text-sm text-gray-500">
          Launch Day Auth Cutover controls. Supabase is the canonical identity source.
        </p>
      </div>

      <CircleCutoverClient initialStatus={status} />
    </div>
  );
}
