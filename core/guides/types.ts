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

/** A screenshot shown under a step, with the part to press circled. */
export type ShotRef = {
  /** Key in core/guides/shots.json (made by scripts/guides/capture.mjs). */
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
  | { type: "picture"; shot: ShotRef; caption?: string }
  /**
   * A video with its chapter list. Either our own file in public/guide-video/
   * (`src` "/guide-video/x.mp4", optional `poster` image), or a Loom video
   * (`loomId`, the 32-character id after loom.com/share/; staff guides only,
   * because only the dashboard's CSP allows Loom frames). With neither, the
   * block shows "Video coming soon".
   */
  | { type: "video"; title: string; minutes: number; chapters: string[]; src?: string; poster?: string; loomId?: string };

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

/** A captured screenshot (core/guides/shots.json). Marks are fractions of the picture (0–1). */
export type ShotData = {
  file: string;
  width: number;
  height: number;
  device: "phone" | "desktop";
  /** true: in public/guide-img (patient guides). false: content/staff-guide-images, sent only to signed-in staff. */
  public: boolean;
  marks: { x: number; y: number; w: number; h: number }[];
};

/** A screenshot ready to show: where to load it from, plus its size and marks. */
export type ResolvedShot = ShotData & { src: string };
