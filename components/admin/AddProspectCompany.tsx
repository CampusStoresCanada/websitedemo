"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { createProspectOrganization } from "@/lib/actions/prospect-organizations";

type Duplicate = { id: string; name: string; type: string | null; slug: string | null };

export interface ProspectPrefill {
  company?: string;
  kind?: "member" | "partner";
  personName?: string;
  personEmail?: string;
  /** A contact inquiry this prospect came from; its message becomes their first call-history entry. */
  inquiryId?: string;
  /** Shown in the form so staff can see what they asked. Not sent: the server reads the inquiry itself. */
  message?: string;
}

/**
 * Adding a prospect: a store or vendor we would like to have, and the first
 * person there. On Admin › Prospects ("Add a company") and on each contact
 * inquiry ("Make a prospect", pre-filled). Opens the company's page; more
 * people are added there with Edit, then "Add a new contact".
 */
export default function AddProspectCompany({
  prefill,
  triggerLabel = "Add a company",
}: {
  prefill?: ProspectPrefill;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(prefill?.company ?? "");
  const [kind, setKind] = useState<"member" | "partner">(prefill?.kind ?? "partner");
  const [personName, setPersonName] = useState(prefill?.personName ?? "");
  const [personEmail, setPersonEmail] = useState(prefill?.personEmail ?? "");
  const [personTitle, setPersonTitle] = useState("");
  const [personPhone, setPersonPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [warning, setWarning] = useState<{ text: string; slug: string } | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
    setDuplicates([]);
    setWarning(null);
  };

  const submit = async (confirmDuplicates: boolean) => {
    setSaving(true);
    setError(null);
    const result = await createProspectOrganization({
      name,
      kind,
      confirmDuplicates,
      person: personName.trim()
        ? { name: personName, email: personEmail, title: personTitle, phone: personPhone }
        : null,
      inquiryId: prefill?.inquiryId ?? null,
    });
    setSaving(false);
    if (result.success) {
      if (result.warning) {
        setWarning({ text: result.warning, slug: result.slug });
        return;
      }
      router.push(`/org/${result.slug}`);
      return;
    }
    setError(result.error);
    setDuplicates(result.duplicates ?? []);
  };

  const field = "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap"
      >
        {triggerLabel}
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Add a prospective member or partner"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            {warning ? (
              <Link
                href={`/org/${warning.slug}`}
                className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white"
              >
                Open its page
              </Link>
            ) : duplicates.length > 0 ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => submit(true)}
                className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                It&rsquo;s a different company, add it
              </button>
            ) : (
              <button
                type="button"
                disabled={saving || !name.trim()}
                onClick={() => submit(false)}
                className="rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Adding…" : "Add and open its page"}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {prefill?.message && (
            <blockquote className="rounded-md border-l-4 border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 whitespace-pre-line">
              {prefill.message}
            </blockquote>
          )}

          <label className="block text-sm">
            <span className="font-medium text-gray-700">Company</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDuplicates([]);
                setError(null);
              }}
              placeholder="e.g. Oxford University Press Canada"
              className={field}
              autoFocus
            />
          </label>

          <fieldset className="text-sm">
            <legend className="font-medium text-gray-700">What would they be?</legend>
            <div className="mt-2 space-y-1.5">
              <label className="flex items-center gap-2">
                <input type="radio" checked={kind === "partner"} onChange={() => setKind("partner")} />
                A partner (a vendor that sells to stores)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={kind === "member"} onChange={() => setKind("member")} />
                A member (a campus store)
              </label>
            </div>
          </fieldset>

          <fieldset className="text-sm">
            <legend className="font-medium text-gray-700">Who there? (optional)</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Full name" className={field} />
              <input value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} placeholder="Email" type="email" className={field} />
              <input value={personTitle} onChange={(e) => setPersonTitle(e.target.value)} placeholder="Title" className={field} />
              <input value={personPhone} onChange={(e) => setPersonPhone(e.target.value)} placeholder="Phone" type="tel" className={field} />
            </div>
          </fieldset>

          <p className="text-xs text-gray-500">
            Visible to CSC staff only. Nothing is billed and no one gets a login. The person is tagged
            &ldquo;Prospect (never joined)&rdquo;.
            {prefill?.inquiryId && " Their message goes into the company's call history, and the inquiry moves to in progress."}
          </p>

          {warning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{warning.text}</div>
          )}

          {error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p>{error}</p>
              {duplicates.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {duplicates.map((d) => (
                    <li key={d.id}>
                      {d.slug ? (
                        <Link href={`/org/${d.slug}`} className="font-medium underline">
                          {d.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{d.name}</span>
                      )}
                      {d.type ? <span className="text-amber-800"> · {d.type}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
