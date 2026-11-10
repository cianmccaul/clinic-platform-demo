/**
 * The guides' inline text: **bold**, `code` and [link text](href), nothing else.
 * Pure and unit-tested (tests/guides.test.ts). Links are only kept when they
 * point somewhere safe (our own pages, https, mailto: or tel:); anything else
 * is shown as plain text.
 *
 * `book:/manage` means a page on the booking site. Guides are also shown on
 * help.northbank.example and dashboard.northbank.example, where "/manage" would be a
 * different page, so these are made absolute when shown (bookUrl).
 */

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

const TOKEN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

export function safeHref(href: string): boolean {
  return /^(\/(?!\/)|book:\/(?!\/)|https:\/\/|mailto:|tel:)/.test(href);
}

/** A guide link as the browser should see it. */
export function resolveHref(href: string, bookUrl: string): string {
  return href.startsWith("book:/") ? `${bookUrl.replace(/\/+$/, "")}${href.slice(5)}` : href;
}

/** A heading's anchor, from its words, so links to "#section" survive edits elsewhere in the guide. */
export function anchorFor(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

export function parseInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: src.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[4] !== undefined) out.push({ kind: "code", text: m[4] });
    else if (safeHref(m[3])) out.push({ kind: "link", text: m[2], href: m[3] });
    else out.push({ kind: "text", text: m[2] });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

/** The words only, for search and for checking content (no markup). */
export function plainText(src: string): string {
  return parseInline(src)
    .map((t) => t.text)
    .join("");
}
