"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  createEntity,
  deleteEntity,
  setEntityReferences,
  stampInstances,
  updateEntity,
  type BuildEntity,
  type BuildWorkspace as Workspace,
  type EntityAttributes,
  type EntityRefView,
  type LinkedEvent,
} from "@/lib/actions/conference-entities";
import { createLinkedEventFromEntity } from "@/lib/actions/conference-event-link";
import {
  KIND_SUGGESTIONS,
  RELATIONSHIPS,
  RELATIONSHIP_BY_ROLE,
  SUGGESTION_BY_KIND,
  kindLabel,
  type SuggestedField,
} from "@/lib/conference/entity-kinds";
import { effectiveAttributes, effectiveRefs, instanceTypeId, openQuestions } from "@/lib/conference/entity-graph";
import { accessibleThings, offerGrants } from "@/lib/conference/entity-commerce";
import { availability, priceTable } from "@/lib/conference/entity-pricing";
import { colorForKind } from "@/lib/conference/schedule-colors";
import QBItemPicker from "@/components/admin/qbo/QBItemPicker";

type Picked = { id: string; name: string; kind: string };
type PropRow = { key: string; label: string; value: string; type: SuggestedField["type"]; placeholder?: string; hint?: string };
type ConnRow = { role: string; target: Picked | null; quantity: string };
type FormState = { mode: "add" } | { mode: "edit"; entity: BuildEntity } | null;

const SYSTEM_ATTRS = ["source_role", "date"];
const TIER_OPTIONS: Array<{ role: string; label: string }> = [
  { role: "public", label: "Public" },
  { role: "partner", label: "Partner" },
  { role: "member", label: "Member" },
  { role: "org_admin", label: "Org Admin" },
  { role: "admin", label: "Admin" },
  { role: "super_admin", label: "Super Admin" },
];
const inputClass =
  "rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent";
/** Kinds that can be backed by a real Events row for RSVP/waitlist/Circle sync. */
const RSVP_LINKABLE_KINDS = ["event", "session", "meeting", "networking"];

function money(cents: number | null): string {
  return `$${((cents ?? 0) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`;
}

export default function BuildWorkspace({
  conferenceId,
  workspace,
}: {
  conferenceId: string;
  workspace: Workspace;
}) {
  const [entities, setEntities] = useState<BuildEntity[]>(workspace.entities);
  const [linkedEvents, setLinkedEvents] = useState<Record<string, LinkedEvent>>(workspace.linkedEventByEntityId);
  const [form, setForm] = useState<FormState>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "offers">("all");

  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const questions = useMemo(
    () => entities.map((e) => ({ e, reasons: openQuestions(e, byId) })).filter((x) => x.reasons.length > 0),
    [entities, byId]
  );
  const openIds = useMemo(() => new Set(questions.map((x) => x.e.id)), [questions]);

  // Backlinks: who points at each thing (the "everything about X" payoff).
  const incomingByTo = useMemo(() => {
    const m = new Map<string, Array<{ from: BuildEntity; role: string; quantity: number | null }>>();
    for (const e of entities) {
      for (const r of e.refs) {
        const list = m.get(r.toEntityId) ?? [];
        list.push({ from: e, role: r.role, quantity: r.quantity });
        m.set(r.toEntityId, list);
      }
    }
    return m;
  }, [entities]);

  // Instances grouped under their type, so dozens of copies don't flood the list.
  const instancesByType = useMemo(() => {
    const m = new Map<string, BuildEntity[]>();
    for (const e of entities) {
      const t = instanceTypeId(e);
      if (t) {
        const list = m.get(t) ?? [];
        list.push(e);
        m.set(t, list);
      }
    }
    return m;
  }, [entities]);

  // Top-level rows = things that aren't an instance of something we have.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchText = (e: BuildEntity) =>
      !q || e.name.toLowerCase().includes(q) || kindLabel(e.kind).toLowerCase().includes(q);
    const passFilter = (e: BuildEntity) =>
      filter === "open" ? openIds.has(e.id) : filter === "offers" ? e.isForSale : true;

    const m = new Map<string, BuildEntity[]>();
    for (const e of entities) {
      const t = instanceTypeId(e);
      if (t && byId.has(t)) continue; // shown nested under its type
      if (!passFilter(e)) continue;
      const insts = instancesByType.get(e.id) ?? [];
      const instMatch = q ? insts.some(matchText) : false;
      if (!matchText(e) && !instMatch) continue;
      const list = m.get(e.kind) ?? [];
      list.push(e);
      m.set(e.kind, list);
    }
    return [...m.entries()].sort(([a], [b]) => {
      const seeded = (k: string) => (SUGGESTION_BY_KIND[k]?.seeded ? 1 : 0);
      return seeded(a) - seeded(b) || kindLabel(a).localeCompare(kindLabel(b));
    });
  }, [entities, byId, instancesByType, openIds, query, filter]);

  const shownCount = useMemo(() => groups.reduce((n, [, items]) => n + items.length, 0), [groups]);

  function upsertLocal(entity: BuildEntity) {
    setEntities((prev) => {
      const without = prev.filter((e) => e.id !== entity.id);
      return [...without, entity].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  // Coining a thing inline creates a STUB — flagged needs-definition until the
  // admin comes back to it via the open-questions list.
  async function createReferenceable(kind: string, name: string, attributes?: EntityAttributes): Promise<Picked | null> {
    const res = await createEntity(conferenceId, { kind, name, attributes, needsDefinition: true });
    if (!res.success) return null;
    upsertLocal({
      id: res.data.id, kind, name: name.trim(), isForSale: false, priceCents: null,
      currency: "CAD", attributes: attributes ?? {}, needsDefinition: true, inventory: null, tierPrices: {},
      qboItemId: null, salesWindow: null, refs: [],
    });
    return { id: res.data.id, name: name.trim(), kind };
  }

  async function stamp(typeId: string, names: string[]): Promise<string | null> {
    const res = await stampInstances(conferenceId, typeId, names);
    if (!res.success) return res.error;
    const type = byId.get(typeId);
    for (const { id, name } of res.data.created) {
      upsertLocal({
        id, kind: type?.kind ?? "thing", name, isForSale: false, priceCents: null,
        currency: "CAD", attributes: {}, needsDefinition: false, inventory: null, tierPrices: {},
        qboItemId: null, salesWindow: null,
        refs: [{ toEntityId: typeId, toName: type?.name ?? "", toKind: type?.kind ?? "", role: "instance_of", quantity: null }],
      });
    }
    return null;
  }

  async function removeEntity(id: string) {
    const res = await deleteEntity(id);
    if (res.success) setEntities((prev) => prev.filter((e) => e.id !== id));
  }

  // Edit happens in place: the row being edited swaps for this form (the "add"
  // form stays at the top). renderForm closes over the shared props so any row —
  // top-level or a nested instance — can render it where it lives.
  const editingId = form?.mode === "edit" ? form.entity.id : null;
  const renderForm = (entity: BuildEntity): ReactNode => (
    <ThingForm
      key={entity.id}
      conferenceId={conferenceId}
      entities={entities}
      editing={entity}
      linkedEvent={linkedEvents[entity.id]}
      onLinkedEvent={(entityId, ev) => setLinkedEvents((prev) => ({ ...prev, [entityId]: ev }))}
      createReferenceable={createReferenceable}
      onSaved={(saved) => {
        upsertLocal(saved);
        setForm(null);
      }}
      onCancel={() => setForm(null)}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Build the conference</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Add a thing, call it what it is, and plug other things into it — what it includes (with
            quantities), what it&apos;s involved in, when/where/who. Coin things on the fly; the open
            questions below remember what still needs defining.
          </p>
        </div>
        {form?.mode !== "add" && (
          <button
            onClick={() => setForm({ mode: "add" })}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            + Add a thing
          </button>
        )}
      </div>

      {questions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Open questions · {questions.length}
          </div>
          <div className="mt-2 space-y-1">
            {questions.map(({ e, reasons }) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-800">{e.name}</span>
                <span className="text-gray-400">{kindLabel(e.kind)}</span>
                <span className="text-xs text-amber-700">— {reasons.join("; ")}</span>
                <button
                  onClick={() => setForm({ mode: "edit", entity: e })}
                  className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                >
                  Define
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {form?.mode === "add" && (
        <ThingForm
          key="add"
          conferenceId={conferenceId}
          entities={entities}
          onLinkedEvent={(entityId, ev) => setLinkedEvents((prev) => ({ ...prev, [entityId]: ev }))}
          createReferenceable={createReferenceable}
          onSaved={(entity) => {
            upsertLocal(entity);
            setForm(null);
          }}
          onCancel={() => setForm(null)}
        />
      )}

      {entities.length === 0 && !form && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Nothing yet. Add a thing to begin.
        </div>
      )}

      {entities.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search things…"
            className="w-56 rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {([
            ["all", "All"],
            ["open", `Open questions${questions.length ? ` · ${questions.length}` : ""}`],
            ["offers", "Offers"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === key ? "border-accent bg-blue-50 text-accent" : "border-gray-300 text-gray-600 hover:border-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {entities.length > 0 && shownCount === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          No things match.
        </div>
      )}

      {groups.map(([kind, items]) => (
        <div key={kind} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h2 className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorForKind(kind).accent }} />
            {kindLabel(kind)}
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">{items.length}</span>
          </h2>
          <div className="space-y-1.5 p-2">
            {items.map((e) => (
              <ThingRow
                key={e.id}
                entity={e}
                conferenceId={conferenceId}
                byId={byId}
                incomingByTo={incomingByTo}
                instancesByType={instancesByType}
                soldByOffer={workspace.soldByOffer}
                instanceQuery={query}
                editingId={editingId}
                renderForm={renderForm}
                onEdit={(t) => setForm({ mode: "edit", entity: t })}
                onStamp={stamp}
                onDelete={removeEntity}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const INCOMING_LABEL: Record<string, string> = {
  includes: "Included by",
  involved_in: "Participants",
  when: "Scheduled here",
  where: "Hosted here",
  who: "Audience for",
  about: "Subject of",
};

// ── Row + detail ──────────────────────────────────────────────────

function summarize(entity: BuildEntity, byId: Map<string, BuildEntity>): string {
  const eff = effectiveRefs(entity, byId);
  const parts: string[] = [];
  for (const rel of RELATIONSHIPS) {
    const items = eff.filter((r) => r.role === rel.role);
    if (!items.length) continue;
    parts.push(`${rel.label}: ${items.map((r) => (r.quantity ? `${r.quantity}× ${r.toName}` : r.toName)).join(", ")}`);
  }
  return parts.join("  ·  ");
}

function ThingRow({
  entity,
  conferenceId,
  byId,
  incomingByTo,
  instancesByType,
  soldByOffer,
  instanceQuery = "",
  editingId,
  renderForm,
  onEdit,
  onStamp,
  onDelete,
}: {
  entity: BuildEntity;
  conferenceId: string;
  byId: Map<string, BuildEntity>;
  incomingByTo: Map<string, Array<{ from: BuildEntity; role: string; quantity: number | null }>>;
  instancesByType: Map<string, BuildEntity[]>;
  soldByOffer: Record<string, number>;
  instanceQuery?: string;
  editingId: string | null;
  renderForm: (entity: BuildEntity) => ReactNode;
  onEdit: (entity: BuildEntity) => void;
  onStamp: (typeId: string, names: string[]) => Promise<string | null>;
  onDelete: (id: string) => void;
}) {
  const instanceOf = entity.refs.find((r) => r.role === "instance_of");
  const sug = SUGGESTION_BY_KIND[entity.kind];
  const color = colorForKind(entity.kind);
  const eff = effectiveRefs(entity, byId);
  const summary = summarize(entity, byId);
  // Use effective attributes so instances show their type's values as defaults.
  const effAttrs = effectiveAttributes(entity, byId);
  const propEntries = Object.entries(effAttrs).filter(([k]) => !SYSTEM_ATTRS.includes(k));
  const incoming = (incomingByTo.get(entity.id) ?? []).filter((r) => r.role !== "instance_of");
  const allInstances = instancesByType.get(entity.id) ?? [];
  const q = instanceQuery.trim().toLowerCase();
  const shownInstances = q ? allInstances.filter((i) => i.name.toLowerCase().includes(q)) : allInstances;

  const [open, setOpen] = useState(false);
  const [instancesOpen, setInstancesOpen] = useState(q.length > 0 && shownInstances.length > 0);

  // Edit in place: this row swaps for the form. If one of my instances is being
  // edited, auto-reveal my detail + instance list so the inline form shows.
  if (editingId === entity.id) return <>{renderForm(entity)}</>;
  const childBeingEdited = editingId != null && shownInstances.some((i) => i.id === editingId);
  const detailOpen = open || childBeingEdited;
  const showInstances = instancesOpen || childBeingEdited;

  return (
    <div
      className={`rounded-lg border bg-white ${entity.needsDefinition ? "border-amber-300" : "border-gray-200"}`}
      style={{ borderLeft: `3px solid ${color.accent}` }}
    >
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 p-3 text-left">
        <span className="mt-0.5 text-gray-300">{detailOpen ? "▾" : "▸"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color.accent }} />
            <span className="text-sm font-medium text-gray-900">{entity.name}</span>
            {entity.isForSale && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                Offer · {sug?.computedPricing ? "priced per-org at checkout" : money(entity.priceCents)}
              </span>
            )}
            {instanceOf && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">instance of {instanceOf.toName}</span>
            )}
            {entity.needsDefinition && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">needs defining</span>
            )}
            {entity.attributes.source_role && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-accent">inherited</span>
            )}
            {allInstances.length > 0 && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{allInstances.length} instances</span>
            )}
          </div>
          {summary && <div className="mt-0.5 truncate text-xs text-gray-500">{summary}</div>}
        </div>
      </button>

      {detailOpen && (
        <div className="border-t border-gray-100 p-3 text-xs">
          {entity.kind === "policy" && (
            <div className="mb-2">
              <a
                href={`/admin/conference/${conferenceId}/legal`}
                className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-accent hover:underline"
              >
                Edit document text &amp; targeting →
              </a>
            </div>
          )}
          {propEntries.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {propEntries.map(([k, v]) => {
                const isInherited = !(k in entity.attributes) || entity.attributes[k] == null;
                return (
                  <span key={k}
                    className={`rounded px-2 py-0.5 ${isInherited ? "bg-gray-50 text-gray-400 italic" : "bg-gray-50 text-gray-600"}`}
                    title={isInherited ? "Inherited from type" : undefined}>
                    {k}: <span className={isInherited ? "font-normal" : "font-medium text-gray-800"}>{String(v)}</span>
                    {isInherited ? <span className="ml-1 text-[9px] text-gray-300">↑</span> : null}
                  </span>
                );
              })}
            </div>
          )}

          {RELATIONSHIPS.map((rel) => {
            const items = eff.filter((r) => r.role === rel.role);
            if (!items.length) return null;
            return (
              <div key={rel.role} className="mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{rel.label}</span>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {items.map((r) => (
                    <span
                      key={r.toEntityId + r.role}
                      className={`rounded px-2 py-0.5 ${r.inherited ? "bg-gray-100 text-gray-500" : "bg-blue-50 text-accent"}`}
                    >
                      {r.quantity ? `${r.quantity}× ` : ""}{r.toName}
                      <span className={`ml-1 ${r.inherited ? "text-gray-400" : "text-accent/50"}`}>{kindLabel(r.toKind)}</span>
                      {r.inherited && <span className="ml-1 text-[10px] text-gray-400">(from type)</span>}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          {incoming.length > 0 &&
            [...new Set(incoming.map((r) => r.role))].map((role) => (
              <div key={`in-${role}`} className="mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {INCOMING_LABEL[role] ?? `Referenced by (${role})`}
                </span>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {incoming.filter((r) => r.role === role).map((r) => (
                    <span key={r.from.id + role} className="rounded bg-gray-50 px-2 py-0.5 text-gray-600">
                      {r.quantity ? `${r.quantity}× ` : ""}{r.from.name}
                      <span className="ml-1 text-gray-400">{kindLabel(r.from.kind)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}

          {!summary && propEntries.length === 0 && incoming.length === 0 && (
            <p className="text-gray-400">No connections yet.</p>
          )}

          {entity.isForSale && <OfferPreview entity={entity} byId={byId} sold={soldByOffer[entity.id] ?? 0} />}

          {allInstances.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <button
                onClick={() => setInstancesOpen((v) => !v)}
                className="text-[11px] font-medium text-gray-600 hover:text-gray-800"
              >
                {showInstances ? "▾" : "▸"} {allInstances.length} instances
                {q && shownInstances.length !== allInstances.length ? ` (${shownInstances.length} match)` : ""}
              </button>
              {showInstances && (
                <div className="mt-1.5 space-y-1.5 border-l-2 border-gray-100 pl-2">
                  {shownInstances.map((inst) => (
                    <ThingRow
                      key={inst.id}
                      entity={inst}
                      conferenceId={conferenceId}
                      byId={byId}
                      incomingByTo={incomingByTo}
                      instancesByType={instancesByType}
                      soldByOffer={soldByOffer}
                      editingId={editingId}
                      renderForm={renderForm}
                      onEdit={onEdit}
                      onStamp={onStamp}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2">
            <button onClick={() => onEdit(entity)} className="text-[11px] font-medium text-accent hover:underline">Edit</button>
            {!instanceOf && <StampControl typeName={entity.name} onStamp={(names) => onStamp(entity.id, names)} />}
            <button onClick={() => onDelete(entity.id)} className="text-[11px] text-red-500 hover:text-red-700">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What buying this Offer grants, and what those grants get you into — live from the graph. */
function OfferPreview({ entity, byId, sold }: { entity: BuildEntity; byId: Map<string, BuildEntity>; sold: number }) {
  const grants = offerGrants(entity.id, byId, 1);
  const access = accessibleThings([entity.id], byId);
  const prices = priceTable(entity, byId);
  const avail = availability(entity, sold);
  return (
    <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Sells for</div>
        {prices.map((p) => (
          <span key={p.tier} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-emerald-800">
            {money(p.cents)} <span className="text-emerald-600/70">{p.tier}</span>
          </span>
        ))}
        <span className={`ml-auto text-[11px] ${avail.soldOut ? "font-semibold text-red-600" : "text-emerald-700"}`}>
          {avail.cap == null ? "unlimited" : avail.soldOut ? "SOLD OUT" : `${avail.remaining} of ${avail.cap} left`}
        </span>
      </div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">…and one buyer gets</div>
      {grants.length > 0 && (
        <div className="mt-1">
          <span className="text-[11px] text-emerald-700">Grants:</span>{" "}
          {grants.map((g) => (
            <span key={g.entityId} className="mr-1 inline-block rounded bg-white px-1.5 py-0.5 text-[11px] text-emerald-800">
              {g.quantity}× {g.name}
            </span>
          ))}
        </div>
      )}
      {access.length > 0 && (
        <div className="mt-1">
          <span className="text-[11px] text-emerald-700">Access:</span>{" "}
          {access.map((a) => (
            <span key={a.id} className="mr-1 inline-block rounded bg-white px-1.5 py-0.5 text-[11px] text-emerald-800">
              {a.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StampControl({ typeName, onStamp }: { typeName: string; onStamp: (names: string[]) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  // Default to empty prefix so instances are named by number only: "601", "602".
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState("601");
  const [count, setCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Math.max(1, parseInt(count, 10) || 1);
  const s = parseInt(start, 10);
  const preview = Array.from({ length: Math.min(n, 3) }, (_, i) =>
    Number.isNaN(s) ? `${prefix}${i + 1}` : `${prefix}${s + i}`
  );

  async function go() {
    if (!n || n < 1) return;
    const names = Array.from({ length: n }, (_, i) => (Number.isNaN(s) ? `${prefix}${i + 1}` : `${prefix}${s + i}`));
    setBusy(true);
    const err = await onStamp(names);
    setBusy(false);
    if (err) setError(err);
    else setOpen(false);
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="text-[11px] font-medium text-accent hover:underline">Stamp instances →</button>;
  }
  return (
    <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-2 space-y-1.5">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{typeName} — stamp instances</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex flex-col gap-0.5 text-[10px] text-gray-500">
          Prefix
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="#" className={`${inputClass} w-20`} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-gray-500">
          Start #
          <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="601" className={`${inputClass} w-16`} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-gray-500">
          Count
          <input value={count} onChange={(e) => setCount(e.target.value)} placeholder="10" className={`${inputClass} w-14`} />
        </label>
      </div>
      <p className="text-[10px] text-gray-400">
        Preview: {preview.join(", ")}{n > 3 ? ` … (${n} total)` : ""}
      </p>
      <div className="flex items-center gap-1.5">
        <button onClick={go} disabled={busy} className="rounded bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {busy ? "Stamping…" : `Stamp ${n}`}
        </button>
        <button onClick={() => setOpen(false)} className="text-[11px] text-gray-400 hover:text-gray-600">cancel</button>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  );
}

// ── Add / edit a thing ────────────────────────────────────────────

function ThingForm({
  conferenceId,
  entities,
  editing,
  linkedEvent,
  onLinkedEvent,
  createReferenceable,
  onSaved,
  onCancel,
  onNotice,
}: {
  conferenceId: string;
  entities: BuildEntity[];
  editing?: BuildEntity;
  /** The Events row already linked to `editing`, if any. */
  linkedEvent?: LinkedEvent;
  onLinkedEvent?: (entityId: string, event: LinkedEvent) => void;
  createReferenceable: (kind: string, name: string, attributes?: EntityAttributes) => Promise<Picked | null>;
  onSaved: (entity: BuildEntity) => void;
  onCancel: () => void;
  onNotice?: (message: string) => void;
}) {
  const [kind, setKind] = useState(editing?.kind ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  // "Event" is almost always something you want RSVP for (reception, tour,
  // gala); session/meeting/networking are the exception, not the rule — so
  // this only auto-checks for brand-new entities via applyKind() below, never
  // silently on an existing, previously-unlinked entity's routine edit-save.
  const [enableRsvp, setEnableRsvp] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const [props, setProps] = useState<PropRow[]>(() => {
    if (editing) {
      const fields = SUGGESTION_BY_KIND[editing.kind]?.fields ?? [];
      // Use effective attributes so instances show inherited values from their type.
      const attrs = effectiveAttributes(editing, byId);
      return Object.entries(attrs)
        .filter(([k]) => !SYSTEM_ATTRS.includes(k))
        .map(([k, v]) => {
          const f = fields.find((x) => x.key === k);
          return {
            key: k, label: f?.label ?? k, value: String(v ?? ""),
            type: f?.type ?? (typeof v === "number" ? "number" : "text"),
            placeholder: f?.placeholder, hint: f?.hint,
          };
        });
    }
    return [];
  });
  const [conns, setConns] = useState<ConnRow[]>(() => {
    if (editing) {
      return editing.refs
        .filter((r) => r.role !== "instance_of")
        .map((r) => ({ role: r.role, target: { id: r.toEntityId, name: r.toName, kind: r.toKind }, quantity: String(r.quantity ?? "1") }));
    }
    return [];
  });
  const [isForSale, setIsForSale] = useState(editing?.isForSale ?? false);
  const [salesWindow, setSalesWindow] = useState<"member" | "vendor" | null>(editing?.salesWindow ?? null);
  const [qboItemId, setQboItemId] = useState<string | null>(editing?.qboItemId ?? null);
  const [price, setPrice] = useState(editing?.priceCents != null ? (editing.priceCents / 100).toString() : "");
  const [inventory, setInventory] = useState(editing?.inventory != null ? String(editing.inventory) : "");
  const [tierPriceRows, setTierPriceRows] = useState<Array<{ tier: string; price: string }>>(() =>
    editing ? Object.entries(editing.tierPrices ?? {}).map(([tier, cents]) => ({ tier, price: String((cents as number) / 100) })) : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);

  // Instance → type context for "apply to all instances".
  const instanceOfRef = editing?.refs.find((r) => r.role === "instance_of");
  const proliferateTypeId = instanceOfRef?.toEntityId ?? null;
  const proliferateType = proliferateTypeId ? byId.get(proliferateTypeId) : undefined;
  const isInstance = Boolean(proliferateTypeId && proliferateType);
  // If we're editing a TYPE, how many instances already follow it.
  const ownInstanceCount = editing
    ? entities.filter(
        (e) => e.id !== editing.id && e.refs.some((r) => r.role === "instance_of" && r.toEntityId === editing.id)
      ).length
    : 0;

  const suggestion = SUGGESTION_BY_KIND[kind.trim().toLowerCase()];
  const sellable = suggestion?.sellable ?? true;
  const computedPricing = suggestion?.computedPricing ?? false;

  function applyKind(k: string) {
    setKind(k);
    if (editing) return; // don't clobber an existing thing's fields
    setEnableRsvp(k === "event");
    const s = SUGGESTION_BY_KIND[k];
    setProps((s?.fields ?? []).map((f) => ({ key: f.key, label: f.label, value: "", type: f.type, placeholder: f.placeholder, hint: f.hint })));
    setConns((s?.suggestedRoles ?? []).map((role) => ({ role, target: null, quantity: "1" })));
  }

  async function save() {
    if (!kind.trim()) { setError("Give it a kind — what is it?"); return; }
    setSaving(true);
    setError(null);

    // Apply-to-all: write properties + new connections to the TYPE so every
    // instance inherits them, leaving each instance's own customizations intact.
    if (editing && isInstance && applyToAll && proliferateTypeId && proliferateType) {
      const typeAttributes: EntityAttributes = {};
      for (const k of SYSTEM_ATTRS) {
        const v = proliferateType.attributes[k];
        if (v != null) typeAttributes[k] = v;
      }
      for (const p of props) {
        if (!p.key.trim() || p.value === "") continue;
        typeAttributes[p.key.trim()] = p.type === "number" ? Number(p.value) : p.value;
      }
      const updRes = await updateEntity(proliferateTypeId, { attributes: typeAttributes });
      if (!updRes.success) { setSaving(false); setError(updRes.error); return; }

      // Union the form's connections into the type's existing ones (never wipe).
      const typeOwnRefs = proliferateType.refs
        .filter((r) => r.role !== "instance_of")
        .map((r) => ({ toEntityId: r.toEntityId, role: r.role, quantity: r.quantity }));
      const newConnRefs = conns
        .filter((c) => c.target)
        .map((c) => ({
          toEntityId: c.target!.id,
          role: c.role,
          quantity: RELATIONSHIP_BY_ROLE[c.role]?.hasQuantity ? Number(c.quantity || "1") : null,
        }));
      const seen = new Set<string>();
      const unionRefs: Array<{ toEntityId: string; role: string; quantity: number | null }> = [];
      for (const r of [...typeOwnRefs, ...newConnRefs]) {
        const key = `${r.role}|${r.toEntityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unionRefs.push(r);
      }
      const refRes = await setEntityReferences(conferenceId, proliferateTypeId, unionRefs);
      if (!refRes.success) { setSaving(false); setError(refRes.error); return; }

      // Receipt: how many inherit it vs keep their own.
      const changedKeys = props.filter((p) => p.key.trim() && p.value !== "").map((p) => p.key.trim());
      const siblings = entities.filter((e) =>
        e.refs.some((r) => r.role === "instance_of" && r.toEntityId === proliferateTypeId)
      );
      const kept = siblings.filter(
        (s) => s.id !== editing.id && changedKeys.some((k) => s.attributes[k] != null && s.attributes[k] !== "")
      ).length;
      const applied = siblings.length - kept;
      onNotice?.(
        `Applied to “${proliferateType.name}”. ${applied} instance${applied === 1 ? "" : "s"} ` +
          `inherit${applied === 1 ? "s" : ""} it${kept > 0 ? `; ${kept} kept their own values` : ""}.`
      );

      const updatedType: BuildEntity = {
        ...proliferateType,
        attributes: typeAttributes,
        refs: [
          ...proliferateType.refs.filter((r) => r.role === "instance_of"),
          ...unionRefs.map((r) => ({
            toEntityId: r.toEntityId,
            role: r.role,
            quantity: r.quantity,
            toName: byId.get(r.toEntityId)?.name ?? "",
            toKind: byId.get(r.toEntityId)?.kind ?? "",
          })),
        ],
      };
      setSaving(false);
      onSaved(updatedType);
      return;
    }

    const attributes: EntityAttributes = {};
    if (editing) for (const k of SYSTEM_ATTRS) if (editing.attributes[k] != null) attributes[k] = editing.attributes[k];
    for (const p of props) {
      if (!p.key.trim() || p.value === "") continue;
      attributes[p.key.trim()] = p.type === "number" ? Number(p.value) : p.value;
    }

    const finalKind = kind.trim().toLowerCase();
    const finalName = name.trim() || `Untitled ${kind.trim()}`;
    const finalSale = sellable && isForSale;
    const finalPrice = finalSale && price ? Math.round(parseFloat(price) * 100) : null;
    const finalInventory = finalSale && inventory.trim() !== "" ? Math.max(0, parseInt(inventory, 10) || 0) : null;
    const finalTierPrices: Record<string, number> = {};
    if (finalSale) {
      for (const r of tierPriceRows) {
        if (r.tier && r.price.trim() !== "") finalTierPrices[r.tier] = Math.round(parseFloat(r.price) * 100);
      }
    }

    // Unlike qboItemId, salesWindow is meaningful precisely when the item is
    // NOT yet for sale (it's what the cron will later flip on) — gate on
    // `sellable` (the kind can ever be sold), not `finalSale` (is right now).
    const finalSalesWindow = sellable ? salesWindow : null;

    const connRefs = conns
      .filter((c) => c.target)
      .map((c) => ({
        toEntityId: c.target!.id,
        role: c.role,
        quantity: RELATIONSHIP_BY_ROLE[c.role]?.hasQuantity ? Number(c.quantity || "1") : null,
      }));
    // Preserve instance_of edges (setEntityReferences replaces the whole set).
    const preserved = (editing?.refs ?? [])
      .filter((r) => r.role === "instance_of")
      .map((r) => ({ toEntityId: r.toEntityId, role: r.role, quantity: r.quantity }));
    const allRefs = [...preserved, ...connRefs];

    let id = editing?.id ?? "";
    if (editing) {
      const res = await updateEntity(editing.id, {
        kind: finalKind, name: finalName, isForSale: finalSale, priceCents: finalPrice,
        attributes, needsDefinition: false, inventory: finalInventory, tierPrices: finalTierPrices,
        qboItemId: finalSale ? qboItemId : null, salesWindow: finalSalesWindow,
      });
      if (!res.success) { setSaving(false); setError(res.error); return; }
    } else {
      const res = await createEntity(conferenceId, {
        kind: finalKind, name: finalName, isForSale: finalSale, priceCents: finalPrice, attributes,
        inventory: finalInventory, tierPrices: finalTierPrices, qboItemId: finalSale ? qboItemId : null,
        salesWindow: finalSalesWindow,
      });
      if (!res.success) { setSaving(false); setError(res.error); return; }
      id = res.data.id;
    }

    const refRes = await setEntityReferences(conferenceId, id, allRefs);
    if (!refRes.success) { setSaving(false); setError(refRes.error); return; }

    // Best-effort: the entity itself already saved above regardless of this
    // outcome, so a failure here (e.g. missing a When/day reference) surfaces
    // as a notice, not a blocker.
    if (enableRsvp && !linkedEvent) {
      const rsvpRes = await createLinkedEventFromEntity(id);
      if (rsvpRes.success) {
        onLinkedEvent?.(id, { id: rsvpRes.data.eventId, slug: rsvpRes.data.slug, title: finalName, status: "draft" });
        onNotice?.(`RSVP enabled — "${finalName}" now has a draft Events page. Publish it from the Events admin when ready.`);
      } else {
        setRsvpError(rsvpRes.error);
      }
    }

    const viewRefs: EntityRefView[] = [
      ...(editing?.refs.filter((r) => r.role === "instance_of") ?? []),
      ...conns.filter((c) => c.target).map((c) => ({
        toEntityId: c.target!.id, toName: c.target!.name, toKind: c.target!.kind,
        role: c.role, quantity: RELATIONSHIP_BY_ROLE[c.role]?.hasQuantity ? Number(c.quantity || "1") : null,
      })),
    ];
    setSaving(false);
    onSaved({
      id, kind: finalKind, name: finalName, isForSale: finalSale, priceCents: finalPrice,
      currency: editing?.currency ?? "CAD", attributes, needsDefinition: false,
      inventory: finalInventory, tierPrices: finalTierPrices, qboItemId: finalSale ? qboItemId : null,
      salesWindow: finalSalesWindow, refs: viewRefs,
    });
  }

  return (
    <div className="rounded-lg border border-gray-300 bg-white p-4">
      <div className="text-sm font-semibold text-gray-900">{editing ? `Define “${editing.name}”` : "Add a thing"}</div>

      <div className="mt-3 flex flex-wrap gap-2">
        {KIND_SUGGESTIONS.filter((s) => !s.seeded).map((s) => (
          <button
            key={s.kind}
            onClick={() => applyKind(s.kind)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              kind === s.kind ? "border-accent bg-blue-50 text-accent" : "border-gray-300 text-gray-600 hover:border-accent"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="…or type a kind (meeting, tour…)" className={`${inputClass} w-64`} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it" className={`${inputClass} flex-1`} />
      </div>
      {suggestion?.hint && <p className="mt-1.5 text-[11px] text-gray-500">{suggestion.hint}</p>}

      {RSVP_LINKABLE_KINDS.includes(kind.trim().toLowerCase()) && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2">
          {linkedEvent ? (
            <p className="text-xs text-gray-600">
              Linked to <span className="font-medium text-gray-900">{linkedEvent.title}</span> · {linkedEvent.status} —{" "}
              <a href={`/admin/events/${linkedEvent.id}/edit`} className="text-accent hover:underline">Manage in Events →</a>
            </p>
          ) : (
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={enableRsvp} onChange={(e) => setEnableRsvp(e.target.checked)} />
              Enable RSVP via Events
            </label>
          )}
          {rsvpError && <p className="mt-1 text-[11px] text-red-600">{rsvpError}</p>}
        </div>
      )}

      <div className="mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Properties</span>
          <span className="text-[10px] text-gray-400">drafts — edit, delete, or add your own</span>
        </div>
        <div className="mt-1 space-y-1.5">
          {props.map((p, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <input
                  value={p.label || p.key}
                  onChange={(e) => {
                    const val = e.target.value;
                    // Selecting a suggested field (by its canonical key, via the
                    // datalist) fills in the correct key even though the admin
                    // sees the friendly label — prevents e.g. typing "Capacity"
                    // (matching the on-screen label) when the required key is
                    // actually "capacity".
                    const matched = suggestion?.fields.find((f) => f.key === val);
                    setProps((prev) => prev.map((x, j) => (j === i ? {
                      ...x,
                      key: matched?.key ?? val,
                      label: matched?.label ?? val,
                      type: matched?.type ?? x.type,
                      placeholder: matched?.placeholder ?? x.placeholder,
                      hint: matched?.hint ?? x.hint,
                    } : x)));
                  }}
                  placeholder="property name"
                  list="property-key-suggestions"
                  className={`${inputClass} w-40`}
                />
                <input
                  type={p.type === "number" ? "number" : p.type === "time" ? "time" : p.type === "date" ? "date" : "text"}
                  value={p.value}
                  onChange={(e) => setProps((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder={p.placeholder ?? "value"}
                  className={`${inputClass} flex-1`}
                />
                <button onClick={() => setProps((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label="Remove property">×</button>
              </div>
              {p.hint && <p className="mt-0.5 pl-1 text-[10px] text-gray-400">{p.hint}</p>}
            </div>
          ))}
          <button onClick={() => setProps((prev) => [...prev, { key: "", label: "", value: "", type: "text" }])} className="text-[11px] font-medium text-accent hover:underline">
            + property
          </button>
          <datalist id="property-key-suggestions">
            {(suggestion?.fields ?? [])
              .filter((f) => !props.some((p) => p.key === f.key))
              .map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </datalist>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Connections</span>
          <span className="text-[10px] text-gray-400">how this plugs into other things</span>
        </div>
        <div className="mt-1 space-y-2">
          {conns.map((c, i) => (
            <ConnEditor
              key={i}
              conn={c}
              entities={entities}
              createReferenceable={createReferenceable}
              onChange={(next) => setConns((prev) => prev.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setConns((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
          <button onClick={() => setConns((prev) => [...prev, { role: "includes", target: null, quantity: "1" }])} className="text-[11px] font-medium text-accent hover:underline">
            + connection
          </button>
        </div>
      </div>

      {sellable && (
        <div className="mt-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={isForSale} onChange={(e) => setIsForSale(e.target.checked)} />
            For sale (an Offer)
          </label>
          <div className="mt-2 space-y-1">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              Sales window
              <select
                value={salesWindow ?? ""}
                onChange={(e) => setSalesWindow((e.target.value || null) as "member" | "vendor" | null)}
                className={inputClass}
              >
                <option value="">Manual only — toggle by hand</option>
                <option value="member">Member — opens with conference registration_open_at</option>
                <option value="vendor">Vendor — opens with conference booth_sales_general_open_at</option>
              </select>
            </label>
            <p className="text-[11px] text-gray-500">
              {isForSale
                ? "Set here so the conference-sales-open cron knows this is already-on item belongs to; harmless once it's already for sale."
                : "Not for sale yet — pick a window and the conference-sales-open cron will flip \"For sale\" on automatically at that scheduled time. Leave Manual to keep controlling it by hand."}
            </p>
          </div>
          {isForSale && (
            <div className="mt-2 space-y-2 rounded-md border border-gray-100 bg-gray-50 p-2">
              <QBItemPicker
                value={qboItemId}
                onChange={(id) => setQboItemId(id)}
                label={isInstance ? "QuickBooks item (usually set on the type, not per instance)" : "QuickBooks item"}
              />
              {isInstance && !qboItemId && proliferateType?.qboItemId && (
                <p className="text-[11px] text-gray-500">
                  Currently inherits “{proliferateType.name}”&apos;s item — leave blank to keep inheriting it.
                </p>
              )}
            </div>
          )}
          {isForSale && computedPricing && (
            <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
              Priced per-org at checkout (grace/lock status, FTE tier, proration) — there's nothing to set here.
              {suggestion?.hint && <span className="block mt-1 text-[11px] text-gray-500">{suggestion.hint}</span>}
            </div>
          )}
          {isForSale && !computedPricing && (
            <div className="mt-2 space-y-2 rounded-md border border-emerald-100 bg-emerald-50/50 p-2">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  Base price $
                  <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className={`${inputClass} w-24`} />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  Inventory
                  <input type="number" min={0} value={inventory} onChange={(e) => setInventory(e.target.value)} placeholder="∞" className={`${inputClass} w-20`} />
                  <span className="text-[10px] text-gray-400">blank = unlimited</span>
                </label>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Tier prices (override base for a permission tier)</div>
                <div className="mt-1 space-y-1">
                  {tierPriceRows.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <select
                        value={r.tier}
                        onChange={(e) => setTierPriceRows((prev) => prev.map((x, j) => (j === i ? { ...x, tier: e.target.value } : x)))}
                        className={`${inputClass} bg-white`}
                      >
                        <option value="">(tier)</option>
                        {TIER_OPTIONS.map((t) => <option key={t.role} value={t.role}>{t.label}</option>)}
                      </select>
                      <span className="text-xs text-gray-500">$</span>
                      <input
                        type="number" min={0} step="0.01" value={r.price}
                        onChange={(e) => setTierPriceRows((prev) => prev.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                        placeholder="0.00" className={`${inputClass} w-24`}
                      />
                      <button onClick={() => setTierPriceRows((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label="Remove tier price">×</button>
                    </div>
                  ))}
                  <button onClick={() => setTierPriceRows((prev) => [...prev, { tier: "", price: "" }])} className="text-[11px] font-medium text-accent hover:underline">
                    + tier price
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && isInstance && (
        <label className="mt-3 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-2.5 text-xs text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
          />
          <span>
            <span className="font-medium text-gray-900">Apply to all instances of {proliferateType?.name}</span>
            <br />
            Saves these properties and connections to the type so every instance inherits them. Instances
            you&apos;ve individually customized keep their own values.
          </span>
        </label>
      )}
      {editing && !isInstance && ownInstanceCount > 0 && (
        <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2.5 text-[11px] text-gray-500">
          This is a type with {ownInstanceCount} instance{ownInstanceCount === 1 ? "" : "s"} — changes here
          flow to all of them (each keeps any value it overrides).
        </p>
      )}

      {error && <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {saving ? "Saving…" : applyToAll ? `Apply to all instances` : editing ? "Save definition" : "Save thing"}
        </button>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </div>
  );
}

function ConnEditor({
  conn,
  entities,
  createReferenceable,
  onChange,
  onRemove,
}: {
  conn: ConnRow;
  entities: BuildEntity[];
  createReferenceable: (kind: string, name: string, attributes?: EntityAttributes) => Promise<Picked | null>;
  onChange: (next: ConnRow) => void;
  onRemove: () => void;
}) {
  const rel = RELATIONSHIP_BY_ROLE[conn.role];
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 p-2">
      <div className="flex flex-wrap items-start gap-2">
        <select value={conn.role} onChange={(e) => onChange({ ...conn, role: e.target.value })} className={`${inputClass} bg-white`}>
          {RELATIONSHIPS.map((r) => (
            <option key={r.role} value={r.role}>{r.label}</option>
          ))}
        </select>
        {rel?.hasQuantity && (
          <input type="number" min={1} value={conn.quantity} onChange={(e) => onChange({ ...conn, quantity: e.target.value })} className={`${inputClass} w-16`} aria-label="Quantity" />
        )}
        <div className="min-w-0 flex-1">
          <ThingPicker
            targetHint={rel?.targetHint}
            entities={entities}
            selected={conn.target}
            onSelect={(p) => onChange({ ...conn, target: p })}
            createReferenceable={createReferenceable}
          />
        </div>
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500" aria-label="Remove connection">×</button>
      </div>
      {rel?.hint && <p className="mt-1 pl-1 text-[10px] text-gray-400">{rel.hint}</p>}
    </div>
  );
}

/** Pick any existing thing, or define one inline (a stub). One target per connection. */
function ThingPicker({
  targetHint,
  entities,
  selected,
  onSelect,
  createReferenceable,
}: {
  targetHint?: string;
  entities: BuildEntity[];
  selected: Picked | null;
  onSelect: (p: Picked | null) => void;
  createReferenceable: (kind: string, name: string, attributes?: EntityAttributes) => Promise<Picked | null>;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // When the relationship doesn't pin a kind (includes / involved_in / about),
  // let the admin name it here instead of letting it default to "item".
  const [newKind, setNewKind] = useState("item");

  if (selected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs text-accent">
        {selected.name} <span className="text-accent/50">{kindLabel(selected.kind)}</span>
        <button onClick={() => onSelect(null)} className="text-accent/70 hover:text-accent" aria-label="Clear">×</button>
      </span>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (q ? entities.filter((e) => e.name.toLowerCase().includes(q)) : entities)
    .sort((a, b) => (targetHint ? (a.kind === targetHint ? 0 : 1) - (b.kind === targetHint ? 0 : 1) : 0))
    .slice(0, 6);
  const exactExists = entities.some((e) => e.name.toLowerCase() === q);

  async function create() {
    if (!query.trim()) return;
    setBusy(true);
    const created = await createReferenceable(targetHint ?? newKind, query.trim());
    setBusy(false);
    if (created) { onSelect(created); setQuery(""); }
  }

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={targetHint ? `Pick a ${targetHint}, or type a new thing…` : "Pick or create a thing…"}
        className={`${inputClass} w-full`}
      />
      {query.trim() && (
        <div className="mt-1 rounded-md border border-gray-200 bg-white">
          {matches.map((e) => (
            <button
              key={e.id}
              onClick={() => { onSelect({ id: e.id, name: e.name, kind: e.kind }); setQuery(""); }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
            >
              <span>{e.name}</span>
              <span className="text-xs text-gray-400">{kindLabel(e.kind)}</span>
            </button>
          ))}
          {!exactExists && targetHint && (
            <button onClick={create} disabled={busy} className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-left text-sm font-medium text-accent hover:bg-blue-50 disabled:opacity-50">
              + {busy ? "Creating…" : `Create "${query.trim()}" as a ${kindLabel(targetHint).toLowerCase()}`}
            </button>
          )}
          {!exactExists && !targetHint && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-3 py-1.5 text-sm">
              <span className="font-medium text-accent">+ Create &ldquo;{query.trim()}&rdquo; as a</span>
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value)}
                className="rounded border border-gray-300 px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {KIND_SUGGESTIONS.filter((s) => !s.seeded).map((s) => (
                  <option key={s.kind} value={s.kind}>{s.label}</option>
                ))}
                <option value="item">Item (unsorted)</option>
              </select>
              <button
                onClick={create}
                disabled={busy}
                className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
