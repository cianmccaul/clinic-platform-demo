/**
 * Step 1 of the booking page as dropdowns: the clinic's own menu, in its own
 * order and words, over the diary system's appointment types.
 *
 *   Physiotherapy → New Patient / Return Patient → the appointments
 *   Massage → New Patient / Return Patient → How long?
 *   Podiatry ↗ booked with a partner clinic
 *
 * MENU below is the clinic's list. Each line matches an appointment type by
 * name; the price and length shown always come from the diary system, so the
 * page can never show a different price from what's charged. A level with
 * only one choice is skipped. A type the list doesn't mention is never
 * hidden: it shows under "Other appointments" in its area and is returned in
 * `buildBookingMenu(...).other` so the clinic can see it.
 *
 * New / Return: the patient's answer (core/patient-kind.ts).
 *
 * Presentation only: what's bookable and every price are unchanged. Pure,
 * unit-tested in tests/core/booking-menu.test.ts.
 */
import { kindOfType, type PatientKind } from "./patient-kind.ts";

export type MenuType = {
  id: string;
  name: string;
  category: string | null;
  durationMinutes: number;
  fullPriceEUR: number | null;
  /** Staff only (reception's phone booking): hidden from online booking, e.g. the clinic director's own treatments. */
  notOnline?: boolean;
};

export type MenuBranch<T extends MenuType> = {
  kind: "branch";
  key: string;
  label: string;
  detail: string;
  /** Asked above this branch's children once it's open. */
  question: string;
  children: MenuNode<T>[];
  /** Set on the New / Return level: the patient's answer (core/patient-kind.ts). */
  patientKind?: PatientKind;
  fromEUR: number | null;
};
export type MenuLeaf<T extends MenuType> = {
  kind: "type";
  key: string;
  label: string;
  detail: string;
  type: T;
  /** A New / Return answer with only one appointment behind it is the leaf itself. */
  patientKind?: PatientKind;
};
export type MenuLink = { kind: "link"; key: string; label: string; detail: string; href: string };
export type MenuNode<T extends MenuType> = MenuBranch<T> | MenuLeaf<T> | MenuLink;

export type ExternalArea = { name: string; url: string; site: string };

// ------------------------------------------------------------- the clinic's list

export const PHYSIO = "Physiotherapy";
export const MASSAGE = "Massage";
export const AREA_ORDER = [PHYSIO, MASSAGE] as const;
/** Areas split into kinds first (none at this clinic; a bigger one has "General Physio", "Women's Health Physio"…). */
const SUB_ORDER: string[] = [];
export const OTHER_AREA = "Other";
export const OTHER_OPTION = "Other appointments";
/** Reception only: treatments that can't be booked online, grouped at the end of their area. */
export const PHONE_ONLY_OPTION = "Phone only (not bookable online)";

type Visit = "new" | "returning";
type Line = {
  /** Matched against the appointment type's name (leading "1. " numbering ignored). */
  name: RegExp;
  area: string;
  sub?: string;
  /** Who sees it. Left out: everyone (and no New / Return question for that list). */
  for?: Visit[];
  /** The dropdowns down to it, in the clinic's words. */
  path: string[];
  /** Left out of the area's "From" price (add-ons on their own). */
  notInFrom?: boolean;
  /** Its own choice next to New Patient / Return Patient, not inside them. */
  beside?: boolean;
};

const MACHINE = "Physio + Shockwave / Laser";
const SPORTS = "Sports Massage";
const NEW: Visit[] = ["new"];
const RET: Visit[] = ["returning"];
const BOTH: Visit[] = ["new", "returning"];

export const MENU: Line[] = [
  // Physiotherapy → New Patient
  { name: /^Physiotherapy - New Patient\b/i, area: PHYSIO, for: NEW, path: ["Physiotherapy assessment (60mins)"] },
  // Physiotherapy → Return Patient
  { name: /^Physiotherapy - Returning Patient$/i, area: PHYSIO, for: RET, path: ["Standard appointment (45mins)"] },
  { name: /^Physiotherapy - Returning Patient \(30/i, area: PHYSIO, for: RET, path: ["Shorter follow-up (30mins)"] },
  { name: /^Physiotherapy with Shockwave\b/i, area: PHYSIO, for: RET, path: [MACHINE, "Physio + Shockwave (45mins)"] },
  { name: /^Physiotherapy with Laser\b/i, area: PHYSIO, for: RET, path: [MACHINE, "Physio + Laser (45mins)"] },
  // For everyone, so it's listed under both answers
  { name: /^Running Assessment\b/i, area: PHYSIO, for: BOTH, path: ["Running assessment (60mins)"] },
  // Massage
  { name: /^Sports Massage - New Patient\b/i, area: MASSAGE, for: NEW, path: [SPORTS, "60mins"] },
  { name: /^Sports Massage - Returning Patient\b/i, area: MASSAGE, for: RET, path: [SPORTS, "60mins"] },
  { name: /^Sports Massage \(90/i, area: MASSAGE, for: BOTH, path: [SPORTS, "90mins"] },
];

/** The two answers offered (the third, "lapsed", is no longer asked). */
export const MENU_KINDS = ["new", "returning"] as const satisfies readonly PatientKind[];
const KIND_LABELS: Record<(typeof MENU_KINDS)[number], { label: string; detail: string }> = {
  new: { label: "New Patient", detail: "" },
  returning: { label: "Return Patient", detail: "" },
};

// For types the list doesn't mention: which area they belong to (by category).
const AREA_RULES: { area: string; test: RegExp }[] = [
  { area: PHYSIO, test: /physio|shockwave|laser/i },
  { area: MASSAGE, test: /massage/i },
];

// ------------------------------------------------------------- wording

/** "From €75" (whole euro), "From €62.50". */
export const fromText = (eur: number) => `From €${Number.isInteger(eur) ? eur : eur.toFixed(2)}`;
const priceText = (eur: number | null) => (eur == null ? "" : `€${Number.isInteger(eur) ? eur : eur.toFixed(2)}`);
/** Under each appointment: the price, plus the length when the name doesn't already say it (the diary system's figures). */
const leafDetail = (label: string, t: MenuType) =>
  (/\d+\s*mins?\b/i.test(label) ? [priceText(t.fullPriceEUR)] : [`${t.durationMinutes} min`, priceText(t.fullPriceEUR)]).filter(Boolean).join(" · ");

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const clean = (s: string | null | undefined) => (s ?? "").replace(/^\d+\.\s*/, "").trim();

/** New or return by the type's name; "Follow-up" counts as return. Null: for everyone. */
export function visitOf(name: string): Visit | null {
  return kindOfType(name) ?? (/\bfollow[\s-]?up\b/i.test(name) ? "returning" : null);
}

// ------------------------------------------------------------- placing the types

type Item<T extends MenuType> = { t: T; area: string; sub: string; for: Visit[] | null; path: string[]; notInFrom: boolean; beside: boolean; other: boolean; order: number };

function placeAll<T extends MenuType>(t: T): Item<T>[] {
  const name = clean(t.name);
  // Staff-only types (reception) never take a place in the clinic's list, even if the name is like one on it.
  const lines = t.notOnline ? [] : MENU.map((l, order) => ({ l, order })).filter(({ l }) => l.name.test(name));
  if (lines.length)
    return lines.map(({ l, order }) => ({ t, area: l.area, sub: l.sub ?? l.area, for: l.for ?? null, path: l.path, notInFrom: !!l.notInFrom, beside: !!l.beside, other: false, order }));
  // Not on the clinic's list: shown under "Other appointments" in its area, never hidden.
  const category = clean(t.category);
  const area = AREA_RULES.find((r) => r.test.test(category))?.area ?? OTHER_AREA;
  const sub = area;
  const v = visitOf(name);
  const bucket = t.notOnline ? PHONE_ONLY_OPTION : OTHER_OPTION;
  return [{ t, area, sub, for: v ? [v] : null, path: area === OTHER_AREA ? [name] : [bucket, name], notInFrom: true, beside: false, other: !t.notOnline, order: t.notOnline ? 20_000 : 10_000 }];
}

// ------------------------------------------------------------- building the tree

/** `headline`: the treatment cards (Physiotherapy, General Physio…) leave out add-ons on their own; inside the dropdowns every price counts. */
function fromOf<T extends MenuType>(items: Item<T>[], headline: boolean): number | null {
  const main = headline ? items.filter((i) => !i.notInFrom) : items;
  const prices = (main.length ? main : items).map((i) => i.t.fullPriceEUR).filter((p): p is number => p != null);
  return prices.length ? Math.min(...prices) : null;
}

function branch<T extends MenuType>(label: string, question: string, items: Item<T>[], children: MenuNode<T>[], headline = false): MenuBranch<T> {
  const fromEUR = fromOf(items, headline);
  return { kind: "branch", key: slug(label), label, detail: fromEUR == null ? "" : fromText(fromEUR), question, children, fromEUR };
}

const leaf = <T extends MenuType>(label: string, t: T): MenuLeaf<T> => ({ kind: "type", key: slug(label), label, detail: leafDetail(label, t), type: t });

const headlineFrom = <T extends MenuType>(items: Item<T>[]) => {
  const fromEUR = fromOf(items, true);
  return { fromEUR, detail: fromEUR == null ? "" : fromText(fromEUR) };
};

/** The dropdowns below `label`, following each item's path from `depth`; a level with one choice is skipped. */
function pathNode<T extends MenuType>(label: string, items: Item<T>[], depth: number): MenuNode<T> {
  // One appointment: it's the choice. A bucket (Other / Phone only) with one in it shows the appointment's own name.
  if (items.length === 1) return leaf(label === OTHER_OPTION || label === PHONE_ONLY_OPTION ? items[0].path.at(-1)! : label, items[0].t);
  const deeper = items.filter((i) => i.path.length > depth);
  if (deeper.length < items.length) {
    // Two types ended up with the same words: list each by its own name.
    return branch(label, "Which appointment?", items, items.map((i) => ({ ...leaf(clean(i.t.name), i.t), key: slug(`${clean(i.t.name)}-${i.t.id}`) })));
  }
  const groups = new Map<string, Item<T>[]>();
  for (const i of [...items].sort((a, b) => a.order - b.order)) groups.set(i.path[depth], [...(groups.get(i.path[depth]) ?? []), i]);
  if (groups.size === 1) return pathNode(label, items, depth + 1);
  const keys = [...groups.keys()];
  const question = keys.every((k) => /^\d+\s*mins?$/i.test(k)) ? "How long?" : depth === 0 ? "Which appointment?" : "Which one?";
  return branch(label, question, items, keys.map((k) => pathNode(k, groups.get(k)!, depth + 1)));
}

const fits = (i: { for: Visit[] | null }, k: Visit) => !i.for || i.for.includes(k);

/** A list with New / Return first when the clinic split it that way, then its appointments. */
function subNode<T extends MenuType>(label: string, items: Item<T>[]): MenuNode<T> {
  const beside = items.filter((i) => i.beside);
  const main = items.filter((i) => !i.beside);
  if (!main.some((i) => i.for)) {
    const n = pathNode(label, items, 0);
    return n.kind === "branch" ? { ...n, ...headlineFrom(items) } : n;
  }
  const kids = MENU_KINDS.map((k): MenuBranch<T> | MenuLeaf<T> | null => {
    const its = main.filter((i) => fits(i, k));
    if (!its.length) return null;
    const own = { key: k as string, patientKind: k };
    const n = pathNode(KIND_LABELS[k].label, its, 0);
    if (n.kind === "type") {
      // One appointment for this answer: the answer is the choice itself.
      const words = its[0].path.at(-1)!;
      return { ...n, ...own, label: words, detail: leafDetail(words, n.type) };
    }
    if (n.kind === "link") return null;
    return { ...n, ...own, label: KIND_LABELS[k].label, detail: KIND_LABELS[k].detail };
  }).filter((n): n is MenuBranch<T> | MenuLeaf<T> => !!n);
  // Only one answer has anything in it: skip the question, the answer is set by the choice itself.
  if (kids.length === 1 && !beside.length) return { ...kids[0], key: slug(label), label };
  // Choices next to New / Return, each its own dropdown.
  const besideNodes = [...new Set(beside.map((i) => i.path[0]))].map((k) => pathNode(k, beside.filter((i) => i.path[0] === k), 1));
  return branch(label, besideNodes.length ? "Which one?" : "Have you been to see us before?", items, [...kids, ...besideNodes], true);
}

function areaNode<T extends MenuType>(area: string, items: Item<T>[]): MenuNode<T> {
  const rank = (s: string) => (SUB_ORDER.indexOf(s) === -1 ? 99 : SUB_ORDER.indexOf(s));
  const subs = [...new Set(items.map((i) => i.sub))].sort((a, b) => rank(a) - rank(b));
  if (subs.length === 1) return subNode(area, items);
  return branch(area, area === PHYSIO ? "Which kind of physio?" : `Which kind of ${area.toLowerCase()}?`, items, subs.map((s) => subNode(s, items.filter((i) => i.sub === s))), true);
}

function stripInnerDetails<T extends MenuType>(n: MenuBranch<T>) {
  for (const c of n.children) if (c.kind === "branch") {
    c.detail = "";
    stripInnerDetails(c);
  }
}

export type BookingMenu<T extends MenuType> = { root: MenuBranch<T>; other: T[] };

/**
 * The whole menu from the online-bookable types. `external`: areas booked on
 * another site (Podiatry); a category of the same name is left out so it
 * never shows twice.
 */
export function buildBookingMenu<T extends MenuType>(types: T[], external: ExternalArea[] = []): BookingMenu<T> {
  const isExternal = (c: string | null) => external.some((e) => e.name.toLowerCase() === clean(c).toLowerCase());
  const items = types.filter((t) => !isExternal(t.category)).flatMap((t) => placeAll(t));
  const areas = [...new Set(items.map((i) => i.area))];
  const rank = (a: string) => (a === OTHER_AREA ? 999 : (AREA_ORDER as readonly string[]).indexOf(a));
  const children: MenuNode<T>[] = areas.filter((a) => a !== OTHER_AREA).sort((a, b) => rank(a) - rank(b)).map((a) => areaNode(a, items.filter((i) => i.area === a)));
  for (const e of external) children.push({ kind: "link", key: slug(e.name), label: e.name, detail: `Book on ${e.site}`, href: e.url });
  const otherItems = items.filter((i) => i.area === OTHER_AREA);
  if (otherItems.length) children.push(subNode(OTHER_AREA, otherItems));
  const root = branch("Choose a treatment", "Choose a treatment", items, children, true);
  // A "From" price only on the first page's cards (Physiotherapy From €55), none inside the dropdowns.
  for (const area of root.children) if (area.kind === "branch") stripInnerDetails(area);
  return { root, other: [...new Set(items.filter((i) => i.other).map((i) => i.t))] };
}

// ------------------------------------------------------------- walking the tree

/** The nodes along `path` (keys from the root down), stopping at the first key that isn't there. */
export function nodesAt<T extends MenuType>(root: MenuBranch<T>, path: string[]): MenuNode<T>[] {
  const out: MenuNode<T>[] = [];
  let here: MenuNode<T> = root;
  for (const key of path) {
    if (here.kind !== "branch") break;
    const next: MenuNode<T> | undefined = here.children.find((c) => c.key === key);
    if (!next) break;
    out.push(next);
    here = next;
  }
  return out;
}

/** Every appointment with its path. One type can appear under New and under Return. */
export function leaves<T extends MenuType>(node: MenuNode<T>, path: string[] = []): { path: string[]; node: MenuLeaf<T> }[] {
  if (node.kind === "type") return [{ path, node }];
  if (node.kind === "link") return [];
  return node.children.flatMap((c) => leaves(c, [...path, c.key]));
}

/** The path to a type (its key included), preferring the branch for this patient's answer. Null if it isn't in the menu. */
export function pathToType<T extends MenuType>(root: MenuBranch<T>, typeId: string, kind: PatientKind | null): string[] | null {
  const found = leaves(root).filter((l) => l.node.type.id === typeId);
  if (!found.length) return null;
  return (kind && found.find((l) => l.path.includes(kind))?.path) || found[0].path;
}

/** The patient's New / Return answer chosen along a path, if the path asks it. */
export function kindOnPath<T extends MenuType>(root: MenuBranch<T>, path: string[]): PatientKind | null {
  for (const n of nodesAt(root, path)) if (n.kind !== "link" && n.patientKind) return n.patientKind;
  return null;
}

/** The tree as indented text, to check against the clinic's list. */
export function menuText<T extends MenuType>(node: MenuNode<T>, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (node.kind === "link") return `${pad}- ${node.label} → ${node.href}`;
  if (node.kind === "type") return `${pad}- ${node.label} (${node.detail}) = ${clean(node.type.name)}`;
  const head = depth === 0 ? `${node.question}` : `${pad}- ${node.label}${node.detail ? ` [${node.detail}]` : ""} → ${node.question}`;
  return [head, ...node.children.map((c) => menuText(c, depth + 1))].join("\n");
}
