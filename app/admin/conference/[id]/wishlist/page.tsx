import { listWishlistIntentsForConference } from "@/lib/actions/conference-commerce";
import WishlistQueue from "@/components/admin/conference/WishlistQueue";

export const metadata = { title: "Conference Wishlist | Admin" };

export default async function ConferenceWishlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await listWishlistIntentsForConference({ conferenceId: id });

  return (
    <WishlistQueue
      conferenceId={id}
      initialRows={result.success ? result.data : []}
    />
  );
}
