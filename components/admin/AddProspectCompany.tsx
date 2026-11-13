"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { createProspectOrganization } from "@/lib/actions/prospect-organizations";

type Duplicate = { id: string; name: string; type: string | null; slug: string | null };

/**
 * "Add a company" on Admin › Prospects: a store or vendor we would like to
 * have. Creates the company and opens its page, where its people are added
 * with the toolkit's "Add a new contact" (tag them "Prospect (never joined)").
 */
export default function AddProspectCompany() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"member" | "partner">("partner");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);

  const close = () => {
    setOpen(false);
    setName("");
    setError(null);
    setDuplicates([]);
  };

  const submit = async (confirmDuplicates: boolean) => {
    setSaving(true);
    setError(null);
    const result = await createProspectOrganization({ name, kind, confirmDuplicates });
    setSaving(false);
    if (result.success) {
      router.push(`/org/${result.slug}`);
      return;
    }
    setError(result.error);
    setDuplicates(result.duplicates ?? []);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        Add a company
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
            {duplicates.length > 0 ? (
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
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDuplicates([]);
                setError(null);
              }}
              placeholder="e.g. Oxford University Press Canada"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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

          <p className="text-xs text-gray-500">
            The page is visible to CSC staff only. Nothing is billed and no one gets a login. Add their people on
            the page with Edit, then &ldquo;Add a new contact&rdquo;, tagged &ldquo;Prospect (never joined)&rdquo;.
          </p>

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
