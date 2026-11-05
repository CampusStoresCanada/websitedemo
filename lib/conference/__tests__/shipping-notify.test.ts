import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sent = vi.hoisted(() => ({
  emails: [] as Array<{ to: string; variables: Record<string, unknown> }>,
  dms: [] as Array<{ to: string; text: string }>,
}));

vi.mock("@/lib/comms/send", () => ({
  sendTransactional: async (o: { to: string; variables: Record<string, unknown> }) => {
    sent.emails.push({ to: o.to, variables: o.variables });
    return { success: true };
  },
}));
vi.mock("@/lib/ghosts/butler-dm", () => ({
  dmText: (text: string) => ({ text }),
  dmLink: (label: string, href: string) => ({ text: `${label} <${href}>` }),
  dmPara: (...nodes: Array<{ text: string }>) => ({ text: nodes.map((n) => n.text).join("") }),
  helpfulGhostDm: async (to: string, content: Array<{ text: string }>) => {
    sent.dms.push({ to, text: content.map((c) => c.text).join("\n") });
    return true;
  },
}));
vi.mock("@/lib/supabase/user-lookup", () => ({
  resolveOrgAdminEmails: async () => ["admin@ucalgary.ca", "Pat.Lee@ucalgary.ca"],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = async () => {
        if (table === "conference_shipments") {
          return {
            data: {
              reference: "CSC27-ABCDE",
              billing_mode: "csc_rebill",
              service_id: "PurolatorGround",
              receiver_city: "Calgary",
              receiver_province: "AB",
              quote: { totalCents: 21989 },
              organization_id: "org-1",
              conference_person_id: "person-1",
              conference_shipment_packages: [
                { piece_number: 2, package_pin: "P2" },
                { piece_number: 1, package_pin: "P1" },
              ],
            },
          };
        }
        if (table === "conference_people") return { data: { display_name: "Pat Lee", contact_email: "pat.lee@ucalgary.ca" } };
        if (table === "organizations") return { data: { name: "University of Calgary", slug: "ucalgary" } };
        return { data: null };
      };
      return b;
    },
  }),
}));

const { notifyShipmentBooked, shipmentRecipients } = await import("../shipping-notify");

beforeEach(() => {
  sent.emails = [];
  sent.dms = [];
  vi.stubEnv("DEV_EMAIL_INTERCEPT", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://campusstores.ca");
});

describe("shipmentRecipients", () => {
  it("tells the shipper and each admin once, the shipper first", () => {
    const r = shipmentRecipients({
      shipperEmail: "pat@x.ca",
      shipperName: "Pat Lee",
      adminEmails: ["boss@x.ca", "PAT@x.ca"],
      orgName: "X U",
      meUrl: "/me",
      orgUrl: "/org/x",
    });
    expect(r).toEqual([
      { email: "pat@x.ca", name: "Pat", url: "/me" },
      { email: "boss@x.ca", name: "X U team", url: "/org/x" },
    ]);
  });
});

describe("notifyShipmentBooked", () => {
  it("emails and messages the shipper and their org admins, with the estimate labelled", async () => {
    await notifyShipmentBooked("ship-1");

    expect(sent.emails.map((e) => e.to)).toEqual(["pat.lee@ucalgary.ca", "admin@ucalgary.ca"]);
    expect(sent.emails[0].variables).toMatchObject({
      contact_name: "Pat",
      shipper_name: "Pat Lee",
      reference: "CSC27-ABCDE",
      service: "Ground",
      box_count: "2",
      tracking: "P1, P2",
      estimate: "$219.89",
      shipments_url: "https://campusstores.ca/me#conference_checklist",
    });
    expect(String(sent.emails[0].variables.billing_line)).toMatch(/invoices University of Calgary what Purolator actually charges/);
    expect(sent.emails[1].variables.shipments_url).toBe("https://campusstores.ca/org/ucalgary#conference_checklist");

    expect(sent.dms.map((d) => d.to)).toEqual(["pat.lee@ucalgary.ca", "admin@ucalgary.ca"]);
    expect(sent.dms[0].text).toMatch(/estimate: \$219\.89, tax included/);
  });

  it("sends Circle messages to the dev address when email is intercepted", async () => {
    vi.stubEnv("DEV_EMAIL_INTERCEPT", "dev@example.com");
    await notifyShipmentBooked("ship-1");
    expect(sent.dms.every((d) => d.to === "dev@example.com")).toBe(true);
    expect(sent.dms[0].text).toMatch(/would have gone to pat\.lee@ucalgary\.ca/);
  });
});
