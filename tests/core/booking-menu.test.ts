/** The booking menu (core/booking-menu.ts) over the demo clinic's appointment types. */
import { describe, expect, test } from "vitest";
import { buildBookingMenu, kindOnPath, leaves, menuText, nodesAt, pathToType, type MenuType } from "@/core/booking-menu";
import { TYPES } from "@/demo/server/clinic";

const types: MenuType[] = TYPES.map((t) => ({ id: t.id, name: t.name, category: t.category, durationMinutes: t.duration_in_minutes, fullPriceEUR: t.priceEUR }));
const menu = buildBookingMenu(types, [{ name: "Podiatry", url: "https://example.com", site: "our partner clinic" }]);
const labels = (path: string[]) => {
  const node = nodesAt(menu.root, path).at(-1)!;
  return node.kind === "branch" ? node.children.map((c) => c.label) : [];
};

describe("booking menu", () => {
  test("the first page is the areas, then the partner clinic's link", () => {
    expect(menu.root.children.map((c) => `${c.kind}:${c.label}`)).toEqual(["branch:Physiotherapy", "branch:Massage", "link:Podiatry"]);
  });

  test("an area's From price is its cheapest appointment, and is only shown on the first page", () => {
    const [physio, massage] = menu.root.children;
    expect(physio.detail).toBe("From €55");
    expect(massage.detail).toBe("From €70");
    const inner = nodesAt(menu.root, ["physiotherapy", "returning"]).at(-1)!;
    expect(inner.detail).toBe("");
  });

  test("Physiotherapy asks New or Return, then lists that patient's appointments in the clinic's order", () => {
    expect(labels(["physiotherapy"])).toEqual(["New Patient", "Return Patient"]);
    expect(labels(["physiotherapy", "new"])).toEqual(["Physiotherapy assessment (60mins)", "Running assessment (60mins)"]);
    expect(labels(["physiotherapy", "returning"])).toEqual(["Standard appointment (45mins)", "Shorter follow-up (30mins)", "Physio + Shockwave / Laser", "Running assessment (60mins)"]);
    expect(labels(["physiotherapy", "returning", "physio-shockwave-laser"])).toEqual(["Physio + Shockwave (45mins)", "Physio + Laser (45mins)"]);
  });

  test("a level with one choice is skipped: Massage goes from New / Return straight to How long?", () => {
    const node = nodesAt(menu.root, ["massage", "new"]).at(-1)!;
    expect(node.kind === "branch" && node.question).toBe("How long?");
    expect(labels(["massage", "new"])).toEqual(["60mins", "90mins"]);
  });

  test("every bookable type is in the menu, with the diary's own price", () => {
    const all = leaves(menu.root);
    for (const t of types) expect(all.some((l) => l.node.type.id === t.id), t.name).toBe(true);
    for (const l of all) expect(l.node.detail).toContain(`€${l.node.type.fullPriceEUR}`);
    expect(menu.other).toEqual([]);
  });

  test("a type the list doesn't mention is never hidden: it shows under Other appointments", () => {
    const extra = { id: "999", name: "Hand Therapy", category: "Physiotherapy", durationMinutes: 30, fullPriceEUR: 60 };
    const m = buildBookingMenu([...types, extra]);
    expect(m.other).toEqual([extra]);
    expect(menuText(m.root)).toContain("Hand Therapy");
  });

  test("the New / Return answer comes from the path taken", () => {
    expect(kindOnPath(menu.root, ["physiotherapy", "returning", "standard-appointment-45mins"])).toBe("returning");
    expect(kindOnPath(menu.root, ["physiotherapy", "new", "running-assessment-60mins"])).toBe("new");
  });

  test("Change reopens the dropdowns an appointment was picked from, preferring the patient's own answer", () => {
    expect(pathToType(menu.root, "205", "returning")).toEqual(["physiotherapy", "returning", "physio-shockwave-laser", "physio-shockwave-45mins"]);
    expect(pathToType(menu.root, "209", "returning")?.slice(0, 2)).toEqual(["physiotherapy", "returning"]);
    expect(pathToType(menu.root, "209", "new")?.slice(0, 2)).toEqual(["physiotherapy", "new"]);
    expect(pathToType(menu.root, "nope", null)).toBeNull();
  });

  test("staff-only types sit in their own group and never in the patients' list", () => {
    const staffOnly = (id: string, name: string) => ({ id, name, category: "Physiotherapy", durationMinutes: 60, fullPriceEUR: 120, notOnline: true });
    const m = buildBookingMenu([...types, staffOnly("300", "Physiotherapy - New Patient"), staffOnly("301", "Director's review - New Patient")]);
    expect(menuText(m.root)).toContain("Phone only (not bookable online)");
    expect(leaves(m.root).filter((l) => l.node.label === "Physiotherapy assessment (60mins)")).toHaveLength(1);
    expect(m.other).toEqual([]);
  });
});
