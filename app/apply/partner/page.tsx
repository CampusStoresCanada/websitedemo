import { PartnerApplicationForm } from "./PartnerApplicationForm";

export const metadata = {
  title: "Become a Partner | Campus Stores Canada",
};

export default function ApplyPartnerPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">
            Partnership Application
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Apply to become a vendor partner with Campus Stores Canada
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <PartnerApplicationForm />
        </div>
      </div>
    </div>
  );
}
