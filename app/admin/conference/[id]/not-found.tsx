import Link from "next/link";

export default function ConferenceNotFound() {
  return (
    <div className="text-center py-12 text-gray-500">
      Conference not found.{" "}
      <Link href="/admin/conference" className="text-accent hover:underline">
        Back to conferences
      </Link>
    </div>
  );
}
