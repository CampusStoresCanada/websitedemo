import ConferenceForm from "@/components/admin/conference/ConferenceForm";

export const metadata = { title: "Create Conference | Admin" };

export default function CreateConferencePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Conference</h1>
      <ConferenceForm />
    </div>
  );
}
