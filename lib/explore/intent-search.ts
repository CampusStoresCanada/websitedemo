import { NACS_DEPARTMENTS, NACS_CLASSES_BY_DEPARTMENT } from "@/lib/publication/categories";
import { boothsMatch } from "./org-search";

/**
 * Answering what someone MEANT, and admitting when we guessed.
 *
 * A member standing on the floor types "hoodies". Nobody's `primary_category`
 * says "hoodies" — the taxonomy says Apparel, and its classes say Activewear
 * and Men's / Unisex. A literal search returns nothing and the reader concludes
 * the show has no hoodies, which is false and unhelpable.
 *
 * So a query is resolved to taxonomy terms first, and every match carries a
 * REASON. That distinction is the point: "Booth 402" and "we think they do
 * that" are different claims, and showing them identically would make the
 * inference look like a fact. CSC populated many partner categories by
 * guessing, so a category hit is already softer evidence than a name hit —
 * stacking a synonym on top of it without saying so would be two guesses
 * presented as an answer.
 */

export type MatchReason =
  /** The company's own name. */
  | "name"
  /** A booth number they hold. */
  | "booth"
  /** Their own words, from their profile description. */
  | "describes"
  /** A category they chose. */
  | "category"
  /** A person listed at that company. */
  | "person"
  /** We mapped the words to a category. Softest evidence we have. */
  | "guess";

export type SearchSubject = {
  name: string;
  description: string | null;
  /** Departments and classes the org selected, already parsed. */
  departments: string[];
  classes: string[];
  booths: string[];
  /**
   * People listed at this org who have consented to appear.
   *
   * ⚠️ The caller is responsible for having filtered these by
   * `directory_visibility` BEFORE handing them over. Consent to be listed is
   * per person; making someone findable by name is publishing them, and this
   * module cannot tell whether that gate was applied.
   */
  people: string[];
};

/**
 * Everyday words → taxonomy terms.
 *
 * Deliberately hand-written and short rather than clever. These are the words
 * campus store buyers actually use for things the taxonomy names differently;
 * anything that IS a taxonomy word already matches without help. Adding to
 * this is a two-minute edit, which is the point — it should be cheaper to add
 * a synonym than to argue about a matching algorithm.
 */
/**
 * Exported so callers can consult the map DIRECTLY.
 *
 * ⚠️ `resolveIntent` short-circuits on its substring match before reaching here,
 * so a word like "gowns" comes back as a direct hit on "Caps & Gowns" and its
 * synonym entry is never seen. That is right for a search box and wrong for
 * anything that needs to distinguish a curated translation from a substring
 * coincidence — see lib/signals/resolve.ts, which needs exactly that.
 */
export const SYNONYMS: Record<string, string[]> = {
  hoodie: ["Apparel", "Activewear"],
  hoodies: ["Apparel", "Activewear"],
  sweatshirt: ["Apparel", "Activewear"],
  sweatshirts: ["Apparel", "Activewear"],
  sweatpants: ["Apparel", "Activewear"],
  tee: ["Apparel"],
  tees: ["Apparel"],
  "t-shirt": ["Apparel"],
  "t-shirts": ["Apparel"],
  shirts: ["Apparel"],
  hat: ["Headwear", "Apparel"],
  hats: ["Headwear", "Apparel"],
  caps: ["Headwear", "Apparel"],
  toque: ["Headwear", "Apparel"],
  toques: ["Headwear", "Apparel"],
  socks: ["Apparel", "Accessories"],

  pen: ["Office Supplies", "Stationery", "School Office & Lab Supplies"],
  pens: ["Office Supplies", "Stationery", "School Office & Lab Supplies"],
  pencil: ["Office Supplies", "Stationery", "School Office & Lab Supplies"],
  pencils: ["Office Supplies", "Stationery", "School Office & Lab Supplies"],
  notebook: ["Stationery", "Office Supplies"],
  notebooks: ["Stationery", "Office Supplies"],
  binders: ["Office Supplies", "School Office & Lab Supplies"],
  planner: ["Planners & Agendas"],
  planners: ["Planners & Agendas"],

  mug: ["Drinkware", "Accessories"],
  mugs: ["Drinkware", "Accessories"],
  bottle: ["Drinkware", "Accessories"],
  bottles: ["Drinkware", "Accessories"],
  tumbler: ["Drinkware", "Accessories"],
  backpack: ["Bags & Backpacks", "Accessories"],
  backpacks: ["Bags & Backpacks", "Accessories"],
  bag: ["Bags & Backpacks", "Accessories"],
  bags: ["Bags & Backpacks", "Accessories"],
  lanyard: ["Lanyards & Badges", "Accessories"],
  lanyards: ["Lanyards & Badges", "Accessories"],

  gown: ["Caps & Gowns", "Graduation & Regalia"],
  gowns: ["Caps & Gowns", "Graduation & Regalia"],
  grad: ["Graduation & Regalia"],
  graduation: ["Graduation & Regalia"],
  diploma: ["Diploma Frames", "Graduation & Regalia"],
  frames: ["Diploma Frames"],
  ring: ["Class Rings", "Graduation & Regalia"],
  rings: ["Class Rings", "Graduation & Regalia"],

  textbook: ["Textbooks", "Books"],
  textbooks: ["Textbooks", "Books"],
  ebook: ["eBooks", "Books"],
  ebooks: ["eBooks", "Books"],

  pos: ["Point of Sale Systems", "Store Operations"],
  till: ["Point of Sale Systems", "Store Operations"],
  tills: ["Point of Sale Systems", "Store Operations"],
  shelving: ["Shelving & Displays", "Store Fixtures & Equipment"],
  signage: ["Signage & Wayfinding", "Store Fixtures & Equipment"],
  laptop: ["Computers & Tablets", "Technology & Electronics"],
  laptops: ["Computers & Tablets", "Technology & Electronics"],
  calculator: ["Calculators", "Technology & Electronics"],
  calculators: ["Calculators", "Technology & Electronics"],
  snacks: ["Snacks", "Food & Beverages"],
  coffee: ["Beverages", "Food & Beverages"],
  bedding: ["Bedding", "Campus Living"],
};

/** Every taxonomy term, lowercased, for direct hits without a synonym. */
const TAXONOMY_TERMS: string[] = [
  ...NACS_DEPARTMENTS,
  ...Object.values(NACS_CLASSES_BY_DEPARTMENT).flatMap((v) => [...(v ?? [])]),
].map((t) => t.toLowerCase());

/**
 * Taxonomy terms this query implies, and whether we had to infer them.
 *
 * `inferred` is false when the reader typed a real taxonomy word ("apparel")
 * and true when we translated ("hoodies"), so the caller can report a category
 * hit and a guess differently.
 */
export function resolveIntent(rawQuery: string): { terms: string[]; inferred: boolean } {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return { terms: [], inferred: false };

  const direct = TAXONOMY_TERMS.filter((t) => t.includes(q));
  if (direct.length > 0) return { terms: direct, inferred: false };

  // Whole words only: "pen" must not fire on "pending" or "happen".
  const words = q.split(/[^a-z0-9-]+/).filter(Boolean);
  const mapped = new Set<string>();
  for (const w of words) {
    for (const term of SYNONYMS[w] ?? []) mapped.add(term.toLowerCase());
  }
  return { terms: [...mapped], inferred: mapped.size > 0 };
}

/** Digits, optionally with a single leading/trailing letter — i.e. a booth. */
const LOOKS_NUMERIC = /^[a-z]?\d+[a-z]?$/i;

/** Why this subject matched, or null. Strongest evidence wins. */
export function explainMatch(subject: SearchSubject, rawQuery: string): MatchReason | null {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return null;

  if (subject.name.toLowerCase().includes(q)) return "name";
  if (boothsMatch(subject.booths, rawQuery)) return "booth";
  if (subject.people.some((p) => p.toLowerCase().includes(q))) return "person";

  const own = [...subject.departments, ...subject.classes].map((c) => c.toLowerCase());
  const { terms, inferred } = resolveIntent(rawQuery);
  if (terms.length > 0 && own.some((c) => terms.includes(c))) {
    return inferred ? "guess" : "category";
  }

  // A number typed into a floor-plan search is a booth number, not a word.
  // Without this, "40" matched a company whose description says "over 40
  // years" — defeating the whole-token booth rule by the back door, and
  // handing back exactly the noise that rule exists to prevent.
  if (LOOKS_NUMERIC.test(q)) return null;

  if ((subject.description ?? "").toLowerCase().includes(q)) return "describes";
  return null;
}
