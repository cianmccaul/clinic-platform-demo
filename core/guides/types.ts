/**
 * The help centre's guides: plain data, no I/O (docs/guides.md).
 *
 * Who sees what (decision 9 Oct 2026):
 * - patient guides are public on help.northbank.example;
 * - staff guides are only sent by /api/staff/guides*, which checks the
 *   signed-in person's role on every request. Staff guide files must never
 *   be imported by a public page or a client component (tests/guides.test.ts).
 *
 * Text uses a tiny inline syntax (core/guides/inline.ts): **bold** and
 * [link text](/path).
 */

export const AUDIENCES = ["patient", "therapist", "admin", "owner"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  patient: "For patients",
  therapist: "For all staff and therapists",
  admin: "For reception",
  owner: "For owners",
};

/** A screenshot shown under a step, with the parts to press boxed and numbered. */
export type ShotRef = {
  /** Key in core/guides/shots.ts (written by scripts/guide-shots.mjs, which captures them from the running demo). */
  id: string;
  /** What the picture shows and what's circled, for screen readers. */
  alt: string;
};

export type GuideStep = {
  /** What to do, in one or two sentences. */
  text: string;
  /** Optional extra lines under the step. */
  more?: string[];
  shot?: ShotRef;
};

export type Block =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "steps"; steps: GuideStep[] }
  | { type: "list"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "callout"; tone: "info" | "warning" | "error" | "success"; title: string; text?: string; items?: string[] }
  | { type: "picture"; shot: ShotRef; caption?: string };

export type Guide = {
  slug: string;
  audience: Audience;
  title: string;
  /** One sentence: when you'd use this guide. */
  summary: string;
  /** ISO date of the last real change to the content. */
  updated: string;
  blocks: Block[];
};

/**
 * A captured screenshot (core/guides/shots.ts). Marks are fractions of the picture (0–1): each is a
 * highlight box with a numbered callout, and its label is listed under the picture.
 */
export type ShotData = {
  file: string;
  width: number;
  height: number;
  device: "phone" | "desktop";
  /** true: in public/guide-img. (Production keeps staff screenshots private; the demo's are all of made-up data.) */
  public: boolean;
  marks: { x: number; y: number; w: number; h: number; label?: string }[];
};

/** A screenshot ready to show: where to load it from, plus its size and marks. */
export type ResolvedShot = ShotData & { src: string };
