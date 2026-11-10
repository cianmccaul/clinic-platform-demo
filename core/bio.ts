/**
 * Turns a practitioner's Cliniko bio (plain text typed into a textarea) into
 * simple blocks the booking page can lay out: paragraphs, bullet lists, a
 * line of specialties, a "What patients say" heading and quotes.
 *
 * Text only, never HTML: the page renders each block as React text, so
 * nothing typed in Cliniko can inject markup. Pure, no I/O, unit-tested in
 * tests/bio.test.ts.
 */

export type Inline = { text: string; strong?: boolean };
export type BioBlock =
  | { kind: "tags"; items: string[] }
  | { kind: "p"; parts: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "heading"; text: string }
  | { kind: "quote"; text: string; by: string | null };

// "* ", "- ", "• ", "👉🏼 " (any pictograph, with or without a skin tone) at the start of a line.
const BULLET = /^(?:[*•·–-]\s+|(?:\p{Extended_Pictographic}️?[\u{1F3FB}-\u{1F3FF}]?\s*)+)/u;
const TESTIMONIALS = /^(testimonials?|what (?:patients|clients) say)\s*:?$/i;
const QUOTE_OPEN = /^["“”'‘]/;
// “Quote text.” Kate   |   “Quote text.” – Kate, Dublin
const QUOTE_WITH_NAME = /^["“](.+?)["”]\s*[-–—]?\s*([^"“”]{1,80})?$/s;

/** "**bold** text" → parts. Stray asterisks are dropped. */
export function inline(text: string): Inline[] {
  const parts: Inline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[1], strong: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.map((p) => ({ ...p, text: p.text.replace(/\*\*/g, "") })).filter((p) => p.text);
}

const tidy = (s: string) =>
  s
    .replace(/[ \t ]+/g, " ")
    .replace(/\s+([,.;:!?])(?=\s|$)/g, "$1")
    .replace(/,$/, "")
    .trim();

const stripQuotes = (s: string) => s.replace(/^["“”'‘]+|["“”'’]+$/g, "").trim();

/** Short lines with no full stop read as a list (e.g. a list of qualifications typed without bullets). */
const looksLikeListLines = (lines: string[]) =>
  lines.length >= 3 && lines.every((l) => l.length <= 70 && !/[.!?]["”]?$/.test(l));

export function parseBio(raw: string | null | undefined): BioBlock[] {
  if (!raw) return [];
  const paragraphs = raw
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map(tidy).filter(Boolean))
    .filter((lines) => lines.length);

  const blocks: BioBlock[] = [];
  let inTestimonials = false;

  paragraphs.forEach((lines, index) => {
    const joined = lines.join(" ");

    // First paragraph "Scoliosis | Neck & Back Pain | Dry Needling" → specialty tags.
    if (index === 0 && lines.length === 1 && (joined.match(/\|/g) ?? []).length >= 2 && joined.length <= 240) {
      blocks.push({ kind: "tags", items: joined.split("|").map((s) => s.trim()).filter(Boolean) });
      return;
    }

    // "TESTIMONIALS" on its own line, possibly with quotes underneath.
    if (TESTIMONIALS.test(lines[0])) {
      inTestimonials = true;
      blocks.push({ kind: "heading", text: "What patients say" });
      lines = lines.slice(1);
      if (!lines.length) return;
    }

    if (inTestimonials) {
      for (const line of lines) {
        const m = QUOTE_OPEN.test(line) ? line.match(QUOTE_WITH_NAME) : null;
        const prev = blocks[blocks.length - 1];
        if (m) {
          blocks.push({ kind: "quote", text: stripQuotes(m[1]), by: m[2] ? tidy(m[2]) : null });
        } else if (prev?.kind === "quote" && !prev.by && line.length <= 120) {
          prev.by = stripQuotes(line); // "Liam, Dublin" on the line after the quote
        } else {
          blocks.push({ kind: "quote", text: stripQuotes(line), by: null });
        }
      }
      return;
    }

    // Lines that start with a bullet, or a run of short lines, become a list.
    // A lead-in line ("Lucy's qualifications include:") stays a paragraph.
    let lead: string[] = [];
    let rest = lines;
    const bulletAt = lines.findIndex((l) => BULLET.test(l));
    if (bulletAt > 0) {
      lead = lines.slice(0, bulletAt);
      rest = lines.slice(bulletAt);
    } else if (bulletAt === -1 && lines.length >= 4 && /:$/.test(lines[0]) && looksLikeListLines(lines.slice(1))) {
      lead = [lines[0]];
      rest = lines.slice(1);
    }
    if (lead.length) blocks.push({ kind: "p", parts: inline(lead.join(" ")) });

    const isList = rest.some((l) => BULLET.test(l)) || (lead.length > 0 && looksLikeListLines(rest));
    if (isList) {
      const bulleted = rest.some((l) => BULLET.test(l));
      const items: string[] = [];
      const after: string[] = [];
      for (const l of rest) {
        // With bullets, the first line without one ends the list (". . . and much more!").
        if (!after.length && (!bulleted || BULLET.test(l))) items.push(tidy(l.replace(BULLET, "")));
        else after.push(l);
      }
      // Items typed with and without full stops look uneven in a list: drop them.
      blocks.push({ kind: "list", items: items.map((i) => i.replace(/(?<!\.)\.$/, "")).filter(Boolean).map(inline) });
      // ". . . . and much more!" after a list
      const tail = tidy(after.join(" ").replace(/^(?:\.\s*)+/, "… "));
      if (tail) blocks.push({ kind: "p", parts: inline(tail) });
      return;
    }

    blocks.push({ kind: "p", parts: inline(joined) });
  });

  return blocks;
}

/** The first paragraph, for the collapsed row. */
export function bioSummary(blocks: BioBlock[]): Inline[] | null {
  const p = blocks.find((b) => b.kind === "p");
  return p && p.kind === "p" ? p.parts : null;
}

/** Whether there's more than the summary to show behind "Read more". */
export function bioHasMore(blocks: BioBlock[]): boolean {
  const ps = blocks.filter((b) => b.kind !== "tags");
  if (ps.length > 1) return true;
  const only = ps[0];
  return !!only && only.kind === "p" && only.parts.reduce((n, x) => n + x.text.length, 0) > 160;
}
