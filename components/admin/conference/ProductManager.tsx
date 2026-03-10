"use client";

import { useEffect, useState } from "react";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  getProducts,
  getRules,
  createRule,
  deleteRule,
} from "@/lib/actions/conference-products";
import { updateProductLinkages } from "@/lib/actions/conference-product-linkage";
import type { Database } from "@/lib/database.types";

type ProductRow = Database["public"]["Tables"]["conference_products"]["Row"];
type RuleRow = Database["public"]["Tables"]["conference_product_rules"]["Row"];
type ConferenceScheduleModuleRow = {
  id: string;
  conference_id: string;
  module_key:
    | "meetings"
    | "trade_show"
    | "education"
    | "meals"
    | "offsite"
    | "custom"
    | "registration_ops"
    | "communications"
    | "sponsorship_ops"
    | "logistics"
    | "travel_accommodation"
    | "content_capture"
    | "lead_capture"
    | "compliance_safety"
    | "staffing"
    | "post_event"
    | "virtual_hybrid"
    | "expo_floor_plan";
  enabled: boolean;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const MODULE_ACCESS_KEYS = [
  "meetings",
  "trade_show",
  "education",
  "meals",
  "travel_accommodation",
] as const;
type ModuleAccessKey = (typeof MODULE_ACCESS_KEYS)[number];

interface ProductManagerProps {
  conferenceId: string;
  initialProducts: ProductRow[];
  initialScheduleModules: ConferenceScheduleModuleRow[];
  onProductsChange?: (products: ProductRow[]) => void;
}

export default function ProductManager({
  conferenceId,
  initialProducts,
  initialScheduleModules,
  onProductsChange,
}: ProductManagerProps) {
  const [products, setProducts] = useState(initialProducts);
  const [scheduleModules, setScheduleModules] = useState(initialScheduleModules);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesByProduct, setRulesByProduct] = useState<Record<string, RuleRow[]>>({});
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [linkingProductId, setLinkingProductId] = useState<string | null>(null);
  const [linkEditorByProduct, setLinkEditorByProduct] = useState<
    Record<string, { moduleKeys: ModuleAccessKey[]; optionIds: string[]; standaloneAllowed: boolean }>
  >({});

  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);
  useEffect(() => {
    setScheduleModules(initialScheduleModules);
  }, [initialScheduleModules]);

  const registrationOpsRow = scheduleModules.find((module) => module.module_key === "registration_ops");
  const registrationOptions = Array.isArray(registrationOpsRow?.config_json?.registration_options)
    ? (registrationOpsRow?.config_json?.registration_options as Array<Record<string, unknown>>).map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : "",
        name: typeof entry.name === "string" ? entry.name : "Registration Option",
        registrationType:
          typeof entry.registration_type === "string" ? entry.registration_type : "",
        linkedProductIds: Array.isArray(entry.linked_product_ids)
          ? (entry.linked_product_ids.filter((id): id is string => typeof id === "string") ?? [])
          : [],
        entitlements:
          entry.entitlements && typeof entry.entitlements === "object" && !Array.isArray(entry.entitlements)
            ? (entry.entitlements as Record<string, unknown>)
            : {},
      }))
    : [];
  const moduleAccessRows = scheduleModules.filter(
    (module): module is ConferenceScheduleModuleRow & { module_key: ModuleAccessKey } =>
      MODULE_ACCESS_KEYS.includes(module.module_key as ModuleAccessKey)
  );
  const enabledModuleRows = moduleAccessRows.filter((module) => module.enabled);
  const moduleLabels: Record<ModuleAccessKey, string> = {
    meetings: "Meetings",
    trade_show: "Trade Show",
    education: "Education",
    meals: "Meals",
    travel_accommodation: "Travel + Accommodation",
  };
  const purchaseRequiredModuleKeys = new Set<ModuleAccessKey>(
    registrationOptions.flatMap((option) =>
      MODULE_ACCESS_KEYS.filter(
        (key) => option.entitlements?.[key] === "purchase_required"
      )
    )
  );

  const ensureLinkEditorState = (product: ProductRow) => {
    setLinkEditorByProduct((current) => {
      if (current[product.id]) return current;
      const moduleKeys = enabledModuleRows
        .filter(
          (module) =>
            purchaseRequiredModuleKeys.has(module.module_key) &&
            typeof module.config_json?.access_product_id === "string" &&
            module.config_json.access_product_id === product.id
        )
        .map((module) => module.module_key);
      const optionIds = registrationOptions
        .filter((option) => option.linkedProductIds.includes(product.id))
        .map((option) => option.id)
        .filter(Boolean);
      const standaloneAllowed = Boolean(
        product.metadata &&
          typeof product.metadata === "object" &&
          !Array.isArray(product.metadata) &&
          (product.metadata as Record<string, unknown>).standalone_allowed
      );
      return {
        ...current,
        [product.id]: { moduleKeys, optionIds, standaloneAllowed },
      };
    });
  };

  const reloadProducts = async () => {
    const result = await getProducts(conferenceId);
    if (!result.success || !result.data) {
      setError(result.error ?? "Failed to refresh products");
      return;
    }
    setProducts(result.data);
    onProductsChange?.(result.data);
  };

  const loadRules = async (productId: string) => {
    const result = await getRules(productId);
    if (result.success) {
      setRulesByProduct((current) => ({ ...current, [productId]: result.data ?? [] }));
      setError(null);
    } else {
      setError(result.error ?? "Failed to load rules");
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-gray-700">{products.length} products</h3>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001]"
        >
          Add Product
        </button>
      </div>

      {showAdd && (
        <ProductEditor
          onSave={async (data) => {
            const result = await createProduct({ ...data, conference_id: conferenceId } as Parameters<typeof createProduct>[0]);
            if (result.success && result.data) {
              await reloadProducts();
              setShowAdd(false);
              setError(null);
            } else {
              setError(result.error ?? "Failed to create product");
            }
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.id} className="bg-white border border-gray-200 rounded-lg p-4">
            {editingId === p.id ? (
              <ProductEditor
                product={p}
                onSave={async (data) => {
                  const result = await updateProduct(p.id, data);
                  if (result.success && result.data) {
                    await reloadProducts();
                    setEditingId(null);
                    setError(null);
                  } else {
                    setError(result.error ?? "Failed to update product");
                  }
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-sm text-gray-900">{p.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {p.slug} &middot; ${(p.price_cents / 100).toFixed(2)} {p.currency}
                    {p.capacity ? ` &middot; ${p.current_sold}/${p.capacity} sold` : ""}
                    {!p.is_active && " &middot; Inactive"}
                  </div>
                  {p.description && <div className="text-xs text-gray-400 mt-1">{p.description}</div>}
                  <div className="mt-2 text-[11px] text-gray-600">
                    {(() => {
                      const connectedModules = moduleAccessRows
                        .filter(
                          (module) =>
                            purchaseRequiredModuleKeys.has(module.module_key) &&
                            typeof module.config_json?.access_product_id === "string" &&
                            module.config_json.access_product_id === p.id
                        )
                        .map((module) => ({
                          label: moduleLabels[module.module_key],
                          enabled: module.enabled,
                        }));
                      const connectedOptions = registrationOptions.filter((option) =>
                        option.linkedProductIds.includes(p.id)
                      );
                      const moduleDetail =
                        connectedModules.length > 0
                          ? connectedModules
                              .map((module) =>
                                module.enabled ? module.label : `${module.label} (disabled)`
                              )
                              .join(", ")
                          : "none";
                      return (
                        <>
                          <span className="font-medium">Connected:</span>{" "}
                          {connectedModules.length > 0
                            ? `${connectedModules.length} add-on module default(s)`
                            : "no add-on module defaults"}{" "}
                          ·{" "}
                          {connectedOptions.length > 0
                            ? `${connectedOptions.length} registration path(s)`
                            : "no registration paths"}
                          <br />
                          <span className="font-medium">Add-on modules:</span> {moduleDetail}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      const shouldOpen = linkingProductId !== p.id;
                      setLinkingProductId(shouldOpen ? p.id : null);
                      if (shouldOpen) ensureLinkEditorState(p);
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Linkages
                  </button>
                  <button
                    onClick={async () => {
                      const shouldExpand = expandedProductId !== p.id;
                      setExpandedProductId(shouldExpand ? p.id : null);
                      if (shouldExpand && !rulesByProduct[p.id]) {
                        await loadRules(p.id);
                      }
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Rules
                  </button>
                  <button onClick={() => setEditingId(p.id)} className="text-xs text-[#D60001] hover:underline">Edit</button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Delete product "${p.name}"? This cannot be undone.`)) return;
                      const result = await deleteProduct(p.id);
                      if (result.success) {
                        await reloadProducts();
                      } else {
                        setError(result.error ?? "Failed to delete");
                      }
                    }}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
            {linkingProductId === p.id && linkEditorByProduct[p.id] && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <h4 className="text-xs font-semibold text-gray-600 uppercase">Product Linkages</h4>
                <p className="mt-1 text-xs text-gray-500">
                  Link this product to registration paths, and optionally map it as the default add-on product for purchase-required module access.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-gray-700">Default add-on module mapping</p>
                    <div className="mt-2 space-y-1">
                      {enabledModuleRows
                        .filter((module) => purchaseRequiredModuleKeys.has(module.module_key))
                        .map((module) => {
                        const checked = linkEditorByProduct[p.id].moduleKeys.includes(module.module_key);
                        return (
                          <label
                            key={`${p.id}-module-link-${module.module_key}`}
                            className="flex items-center gap-2 text-xs text-gray-700"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const checkedValue = event.target.checked;
                                setLinkEditorByProduct((current) => {
                                  const existing = current[p.id];
                                  if (!existing) return current;
                                  const nextSet = new Set(existing.moduleKeys);
                                  if (checkedValue) nextSet.add(module.module_key);
                                  else nextSet.delete(module.module_key);
                                  return {
                                    ...current,
                                    [p.id]: {
                                      ...existing,
                                      moduleKeys: [...nextSet] as ModuleAccessKey[],
                                    },
                                  };
                                });
                              }}
                            />
                            {moduleLabels[module.module_key]}
                          </label>
                        );
                        })}
                      {enabledModuleRows.filter((module) => purchaseRequiredModuleKeys.has(module.module_key)).length === 0 && (
                        <p className="text-xs text-gray-500">
                          No modules currently use purchase-required entitlements.
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-700">Registration paths</p>
                    <div className="mt-2 max-h-44 overflow-auto space-y-1 pr-1">
                      {registrationOptions.map((option) => {
                        const checked = linkEditorByProduct[p.id].optionIds.includes(option.id);
                        return (
                          <label
                            key={`${p.id}-option-link-${option.id}`}
                            className="flex items-center gap-2 text-xs text-gray-700"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const checkedValue = event.target.checked;
                                setLinkEditorByProduct((current) => {
                                  const existing = current[p.id];
                                  if (!existing) return current;
                                  const nextSet = new Set(existing.optionIds);
                                  if (checkedValue) nextSet.add(option.id);
                                  else nextSet.delete(option.id);
                                  return {
                                    ...current,
                                    [p.id]: {
                                      ...existing,
                                      optionIds: [...nextSet],
                                    },
                                  };
                                });
                              }}
                            />
                            {option.name}
                            {option.registrationType ? (
                              <span className="text-[10px] text-gray-500">
                                ({option.registrationType})
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={linkEditorByProduct[p.id].standaloneAllowed}
                    onChange={(event) => {
                      const checkedValue = event.target.checked;
                      setLinkEditorByProduct((current) => {
                        const existing = current[p.id];
                        if (!existing) return current;
                        return {
                          ...current,
                          [p.id]: {
                            ...existing,
                            standaloneAllowed: checkedValue,
                          },
                        };
                      });
                    }}
                  />
                  Allow standalone purchase
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const editor = linkEditorByProduct[p.id];
                      if (!editor) return;
                      const result = await updateProductLinkages({
                        conferenceId,
                        productId: p.id,
                        moduleAccessKeys: editor.moduleKeys,
                        registrationOptionIds: editor.optionIds,
                        standaloneAllowed: editor.standaloneAllowed,
                      });
                      if (!result.success || !result.data) {
                        setError(result.error ?? "Failed to update product linkages.");
                        return;
                      }
                      setScheduleModules(result.data.modules);
                      await reloadProducts();
                      setError(null);
                      setLinkingProductId(null);
                    }}
                    className="rounded-md bg-[#D60001] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
                  >
                    Save Linkages
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinkingProductId(null)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {expandedProductId === p.id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <ProductRulesEditor
                  productId={p.id}
                  rules={rulesByProduct[p.id] ?? []}
                  onReload={async () => loadRules(p.id)}
                  onError={setError}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductRulesEditor({
  productId,
  rules,
  onReload,
  onError,
}: {
  productId: string;
  rules: RuleRow[];
  onReload: () => Promise<void>;
  onError: (value: string | null) => void;
}) {
  const [ruleType, setRuleType] = useState("requires_product");
  const [ruleConfig, setRuleConfig] = useState("{\"product_slug\":\"partner_meeting_time\"}");
  const [errorMessage, setErrorMessage] = useState("Eligibility rule failed");
  const [isSaving, setIsSaving] = useState(false);

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-600 uppercase">Eligibility Rules</h4>
      {rules.length === 0 ? (
        <p className="text-xs text-gray-500">No rules configured.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-start justify-between rounded border border-gray-200 p-2">
              <div>
                <div className="text-xs font-medium text-gray-700">{rule.rule_type}</div>
                <pre className="text-[11px] text-gray-500 whitespace-pre-wrap">
                  {JSON.stringify(rule.rule_config, null, 2)}
                </pre>
                <div className="text-[11px] text-gray-500">{rule.error_message}</div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const result = await deleteRule(rule.id);
                  if (result.success) {
                    await onReload();
                  } else {
                    onError(result.error ?? "Failed to delete rule");
                  }
                }}
                className="text-xs text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select
          value={ruleType}
          onChange={(event) => setRuleType(event.target.value)}
          className="px-2 py-1.5 border border-gray-300 rounded text-xs"
        >
          <option value="requires_product">requires_product</option>
          <option value="requires_org_type">requires_org_type</option>
          <option value="requires_registration">requires_registration</option>
          <option value="max_quantity">max_quantity</option>
          <option value="custom">custom</option>
        </select>
        <input
          value={errorMessage}
          onChange={(event) => setErrorMessage(event.target.value)}
          className="px-2 py-1.5 border border-gray-300 rounded text-xs"
          placeholder="Rule failure message"
        />
        <button
          type="button"
          disabled={isSaving}
          onClick={async () => {
            setIsSaving(true);
            onError(null);
            try {
              const parsedConfig = JSON.parse(ruleConfig);
              const result = await createRule({
                product_id: productId,
                rule_type: ruleType,
                rule_config: parsedConfig,
                error_message: errorMessage || "Eligibility rule failed",
              });
              if (result.success) {
                await onReload();
              } else {
                onError(result.error ?? "Failed to add rule");
              }
            } catch {
              onError("Rule config must be valid JSON");
            }
            setIsSaving(false);
          }}
          className="px-3 py-1.5 text-xs font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001] disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Add Rule"}
        </button>
      </div>
      <textarea
        value={ruleConfig}
        onChange={(event) => setRuleConfig(event.target.value)}
        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
        rows={3}
      />
    </div>
  );
}

function ProductEditor({
  product,
  onSave,
  onCancel,
}: {
  product?: ProductRow;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [priceCents, setPriceCents] = useState(product?.price_cents?.toString() ?? "");
  const [capacity, setCapacity] = useState(product?.capacity?.toString() ?? "");
  const [maxPerAccount, setMaxPerAccount] = useState(product?.max_per_account?.toString() ?? "");
  const [isTaxable, setIsTaxable] = useState(product?.is_taxable ?? true);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [displayOrder, setDisplayOrder] = useState(product?.display_order ?? 0);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      slug,
      name,
      description: description || null,
      price_cents: parseInt(priceCents),
      capacity: capacity ? parseInt(capacity) : null,
      max_per_account: maxPerAccount ? parseInt(maxPerAccount) : null,
      is_taxable: isTaxable,
      is_active: isActive,
      display_order: displayOrder,
    });
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Slug *</label>
          <input type="text" required value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Name *</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Description</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Price (cents) *</label>
          <input type="number" required value={priceCents} onChange={(e) => setPriceCents(e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Capacity</label>
          <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Unlimited" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Max per Account</label>
          <input type="number" value={maxPerAccount} onChange={(e) => setMaxPerAccount(e.target.value)} placeholder="Unlimited" className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Display Order</label>
          <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(parseInt(e.target.value))} className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isTaxable} onChange={(e) => setIsTaxable(e.target.checked)} className="rounded border-gray-300" />
          Taxable
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded border-gray-300" />
          Active
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001] disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
