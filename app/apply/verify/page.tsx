import { VerifyApplication } from "./VerifyApplication";

export const metadata = {
  title: "Verify Application | Campus Stores Canada",
};

export default function VerifyPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <VerifyApplication />
        </div>
      </div>
    </div>
  );
}
