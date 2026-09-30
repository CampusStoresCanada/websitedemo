"use client";

import { EMPLOYMENT_TYPES } from "@/lib/benchmarking/systems";
import Explain from "./Explain";

/**
 * §6 pay, as a grid: one row per employment type, wages and benefits side by side.
 *
 * Whether benefits are in a staff cost figure depends on something the store
 * does not control. Some institutions carry them centrally and the store never
 * sees the number; others charge them back in full. Two stores with identical
 * payroll can differ by a quarter on that alone, and one combined figure hides
 * it completely.
 *
 * The benefits column only appears once the store says it pays some. Asking a
 * store whose institution carries them to fill four boxes it has no numbers for
 * is how a survey teaches people to guess.
 */

/** Wage and benefit columns, in the order the grid shows them. */
const ROWS = EMPLOYMENT_TYPES.map((t) => ({
  value: t.value,
  label: t.label,
  wageField: `wages_${t.value}`,
  benefitField: `benefits_${t.value}`,
}));

const PAYS_SOMETHING = [
  "The store pays them",
  "Split between the store and the institution",
];

export default function WagesAndBenefits({
  formData,
  onFieldChange,
  isReadOnly,
}: {
  formData: Record<string, unknown>;
  onFieldChange: (field: string, value: string | number | null) => void;
  isReadOnly: boolean;
}) {
  const paidBy = formData.benefits_paid_by;
  const showBenefits =
    typeof paidBy === "string" && PAYS_SOMETHING.includes(paidBy);

  const num = (key: string) => {
    const v = formData[key];
    return typeof v === "number" ? v : "";
  };

  const total = (suffix: "wages" | "benefits") =>
    ROWS.reduce((sum, r) => {
      const v = formData[suffix === "wages" ? r.wageField : r.benefitField];
      return sum + (typeof v === "number" ? v : 0);
    }, 0);

  const money = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

  return (
    <div className="mb-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-1 pr-3 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Employment type
              </th>
              <th className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                <Explain text="Gross pay for the year, before any benefit cost. Include overtime and premiums; include the employer's share of payroll taxes only if you do not separate it.">
                  Wages ($)
                </Explain>
              </th>
              {showBenefits && (
                <th className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  <Explain text="What YOUR store pays toward benefits for this group. Leave a row blank where the institution carries it. If you genuinely cannot split benefits by employment type, put the whole figure on the row where most of it lands and say so in the notes.">
                    Benefits ($)
                  </Explain>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.value}>
                <td className="py-1 pr-3 text-sm text-gray-700">{row.label}</td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    value={num(row.wageField)}
                    disabled={isReadOnly}
                    id={`field-${row.wageField}`}
                    aria-label={`${row.label} wages`}
                    onFocus={(e) => {
                      const el = e.currentTarget;
                      requestAnimationFrame(() => el.select());
                    }}
                    onChange={(e) =>
                      onFieldChange(
                        row.wageField,
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </td>
                {showBenefits && (
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={num(row.benefitField)}
                      disabled={isReadOnly}
                      id={`field-${row.benefitField}`}
                      aria-label={`${row.label} benefits`}
                      onFocus={(e) => {
                        const el = e.currentTarget;
                        requestAnimationFrame(() => el.select());
                      }}
                      onChange={(e) =>
                        onFieldChange(
                          row.benefitField,
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t border-gray-300">
              <td className="py-1.5 pr-3 text-sm font-medium text-gray-900">Total</td>
              <td className="px-1 py-1.5 text-sm font-semibold tabular-nums text-gray-900">
                {money(total("wages"))}
              </td>
              {showBenefits && (
                <td className="px-1 py-1.5 text-sm font-semibold tabular-nums text-gray-900">
                  {money(total("benefits"))}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {!showBenefits && (
        <p className="mt-2 text-xs text-gray-500">
          Wages only. Say above that your store pays some benefits and a second column
          appears beside these.
        </p>
      )}
    </div>
  );
}
