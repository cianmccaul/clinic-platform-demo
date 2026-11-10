/**
 * "Add several people" on the Team page: paste one person per line, check,
 * then add them all. Pure and unit-tested; lib/staff.ts does the adding.
 *
 * A line is "Name, email, role" (commas, tabs or " - " between them). The
 * email can also sit anywhere in the line, e.g. "Sarah Byrne: sarah@x.ie
 * (therapist)" or a Markdown "[a@x.ie](mailto:a@x.ie)" link pasted from a doc.
 */
import type { Role } from "./roles.ts";

export type ImportLine = {
  line: number;
  name: string;
  email: string;
  role: Role | null;
  problem?: string;
};

const ROLE_WORDS: Array<[RegExp, Role]> = [
  [/\bsuper\s*-?\s*admin\b/i, "superadmin"],
  [/\bowner\b/i, "owner"],
  [/\b(reception(ist)?|admin(istrator)?|front\s*desk)\b/i, "admin"],
  [/\b(therapist|physio(therapist)?|practitioner|psychologist|clinician)\b/i, "therapist"],
];

const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function parseStaffLines(text: string, defaultRole: Role | null = null): ImportLine[] {
  const out: ImportLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    // Markdown links from a pasted doc: "[a@x.ie](mailto:a@x.ie)" → "a@x.ie"
    const line = raw.replace(/\[([^\]]*)\]\(mailto:[^)]*\)/gi, "$1").trim();
    if (!line) return;
    const m = line.match(EMAIL);
    if (!m) {
      // A heading such as "Staff Emails and Roles" is skipped quietly.
      if (!/[,\t]/.test(line)) return;
      out.push({ line: i + 1, name: line, email: "", role: null, problem: "No email address on this line." });
      return;
    }
    const email = m[0].toLowerCase();
    const before = line.slice(0, m.index).replace(/[\s,:;\t<(-]+$/, "").trim();
    const after = line.slice((m.index ?? 0) + m[0].length);
    const roleText = after.replace(/[()>\[\]]/g, " ");
    let role: Role | null = null;
    for (const [re, r] of ROLE_WORDS) {
      if (re.test(roleText)) {
        role = r;
        break;
      }
    }
    role ??= defaultRole;
    const name = before.replace(/^[-*•\d.)\s]+/, "").replace(/\s+/g, " ").trim();
    const item: ImportLine = { line: i + 1, name, email, role };
    if (!name) item.problem = "No name before the email.";
    else if (!role) item.problem = "No role: add therapist, reception, owner or super admin.";
    out.push(item);
  });
  // The same email twice in one paste.
  const seen = new Set<string>();
  for (const item of out) {
    if (!item.email) continue;
    if (seen.has(item.email)) item.problem ??= "This email is on another line too.";
    seen.add(item.email);
  }
  return out;
}

/** Lower case, no accents or titles, single spaces: "Dr. Anna Kowalska" → "anna kowalska". */
export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|miss|prof)\b\.?/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds the therapist's Cliniko practitioner by name: the full name, or
 * first + last name (ignoring middle names and titles). Never by surname
 * alone: a new "Sarah Doyle" must not be linked to Joan Doyle's diary.
 * Returns null rather than guess; the Team page then asks.
 */
export function matchPractitioner(name: string, practitioners: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const want = normaliseName(name);
  if (!want) return null;
  const list = practitioners.map((p) => ({ ...p, n: normaliseName(p.name) }));
  const exact = list.filter((p) => p.n === want);
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name };
  const firstLast = (n: string) => {
    const w = n.split(" ");
    return `${w[0]} ${w[w.length - 1]}`;
  };
  const fl = list.filter((p) => firstLast(p.n) === firstLast(want));
  if (fl.length === 1) return { id: fl[0].id, name: fl[0].name };
  return null;
}

/**
 * The first accounts, from BOOTSTRAP_OWNER_EMAILS (used only while there are
 * no staff at all). Either plain emails, "clare@northbank.example,cian@x.ie" (all
 * owners), or people separated by semicolons with an optional name and role:
 * "Clare Morgan <clare@northbank.example> owner; Cian McCaul <cian@x.ie> super admin".
 * At least one owner is always made: if none is named, the first person is.
 */
export function bootstrapPeople(value: string): Array<{ name: string; email: string; role: Role }> {
  const segments = value
    .split(/[;\n]/)
    .flatMap((seg) => (/^\s*[^\s,<>]+@[^\s,<>]+(\s*,\s*[^\s,<>]+@[^\s,<>]+)+\s*$/.test(seg) ? seg.split(",") : [seg]))
    .map((seg) => seg.trim())
    .filter(Boolean);
  const people: Array<{ name: string; email: string; role: Role }> = [];
  for (const seg of segments) {
    const [p] = parseStaffLines(seg, "owner");
    if (!p?.email || people.some((x) => x.email === p.email)) continue;
    const local = p.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, "").trim();
    const name = p.name.replace(/[<>]/g, "").trim() || local.replace(/\b\w/g, (c) => c.toUpperCase()) || p.email;
    people.push({ name, email: p.email, role: p.role ?? "owner" });
  }
  if (people.length && !people.some((p) => p.role === "owner")) people[0].role = "owner";
  return people;
}
