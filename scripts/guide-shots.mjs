/**
 * Captures every help-centre screenshot from the running DEMO (never from a
 * real clinic's system) and records where the numbered callouts go.
 *
 *   npm run dev            # in one terminal
 *   npm run guide-shots    # in another (needs Playwright with Chromium)
 *
 * Each picture is the demo's own page with the demo bar, sidebar and hint
 * card hidden. Writes public/guide-img/<id>.png and core/guides/shots.ts.
 * The callouts are drawn over the pictures by components/guides/GuideView.tsx
 * from the positions saved here, so they stay sharp at any size.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.DEMO_URL ?? "http://localhost:3000";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "guide-img");
const SIZES = { phone: { width: 390, height: 760 }, desktop: { width: 1040, height: 700 } };
const HIDE = ".demo-bar, .demo-hint, .demo-sidebar { display: none !important; } body { padding-left: 0 !important; } .site-header { position: static !important; }";
const JACK = "jack.murphy@example.com";
const HANNAH = "hannah.lynch@example.com";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const shots = {};
const problems = [];

/** A fresh visitor (their own freshly seeded clinic) at phone or desktop size. */
async function visit(device, run) {
  const context = await browser.newContext({ viewport: SIZES[device], deviceScaleFactor: 2, reducedMotion: "reduce" });
  await context.addInitScript((css) => {
    const add = () => document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css }));
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, HIDE);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await run(page, async (id, marks, opts = {}) => capture(page, device, id, marks, opts));
  } catch (err) {
    problems.push(`${device} flow stopped at ${page.url()}: ${String(err.message).split("\n").slice(0, 3).join(" ")}`);
  }
  await context.close();
}

/** Screenshot what's on screen, and save where each marked control is (as fractions of the picture). */
async function capture(page, device, id, marks, { top, bottom } = {}) {
  const anchor = top ?? marks[0]?.[0];
  if (bottom) {
    // Sit this control just above the bottom edge (the Pay button under a long summary).
    await bottom.first().evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 28)));
  } else if (anchor) {
    await anchor.first().evaluate((el, toTop) => {
      const y = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, y - (toTop ? 16 : 110)));
    }, !!top);
  } else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  const { width, height } = SIZES[device];
  const saved = [];
  for (const [locator, label, optional] of marks) {
    const box = await locator.first().boundingBox().catch(() => null);
    if (!box || box.y < 0 || box.y + box.height > height || box.x < 0 || box.x + box.width > width + 1) {
      if (!optional) problems.push(`${id}: "${label}" isn't fully on screen, so it has no callout`);
      continue;
    }
    const r = (n) => Math.round(n * 10_000) / 10_000;
    saved.push({ x: r(box.x / width), y: r(box.y / height), w: r(box.width / width), h: r(box.height / height), label });
  }
  await page.screenshot({ path: join(OUT, `${id}.png`) });
  shots[id] = { file: `${id}.png`, width: width * 2, height: height * 2, device, public: true, marks: saved };
  console.log(`  ${id} (${saved.length} callouts)`);
}

const button = (page, name) => page.getByRole("button", { name });

/** Steps 1 to 3 of a booking: Physiotherapy, Return Patient, Standard appointment, a therapist and a time. */
async function chooseTime(page, snap) {
  await page.goto(`${BASE}/`);
  await button(page, /^Physiotherapy/).first().click();
  await button(page, /^Return Patient/).click();
  if (snap) {
    await snap("book-treatment", [
      [button(page, /^Physiotherapy/), "Tap a treatment to open it"],
      [button(page, /^Return Patient/), "Say whether you've been before"],
      [button(page, /^Standard appointment/), "Choose the appointment"],
    ], { top: page.locator("h1") });
  }
  await button(page, /^Standard appointment/).click();
  const therapist = page.locator("button.option").filter({ hasText: /Chartered Physiotherapist/ }).first();
  await therapist.waitFor();
  if (snap) await snap("book-practitioner", [[therapist, "Pick a practitioner: each shows their next free time"]], { top: page.locator("h1") });
  await therapist.click();
  await page.locator("button.slot").first().waitFor();
  await page.locator("button.slot").first().click();
  if (snap) await snap("book-time", [[page.locator('button.slot[aria-pressed="true"]'), "Choose a time"], [button(page, /^Continue/), "Continue"]]);
  await button(page, /^Continue/).first().click();
}

/** Step 4 as a returning patient: the emailed code instead of the form. */
async function detailsOnFile(page, email, snap) {
  await button(page, "Use my details on file").click();
  await page.locator("#returning-email").fill(email);
  await page.locator("#returning-email").press("Enter");
  await page.locator(".demo-notify-main").click();
  await page.locator('input[autocomplete="one-time-code"]').press("Enter");
  await page.locator(".notice.is-success").first().waitFor();
  if (snap) await snap("book-details-found", [[page.locator(".notice.is-success").first(), "Your details are already on file"], [button(page, /^Continue/).last(), "Continue to pay"]], { top: page.locator("h1") });
  await button(page, /^Continue/).last().click();
  await page.locator('input[type="checkbox"]').first().waitFor();
}

async function tickBoxes(page) {
  for (const box of await page.locator('main input[type="checkbox"]').all()) if (!(await box.isChecked())) await box.check().catch(() => {});
}

console.log("Patient guides (phone)");

await visit("phone", async (page, snap) => {
  await chooseTime(page, snap);
  await snap("book-details", [[button(page, "Use my details on file"), "Been before? Skip the form with an emailed code"]], { top: page.locator("h1") });
  await detailsOnFile(page, HANNAH, snap);
  await tickBoxes(page);
  await snap("book-pay", [[page.locator("summary", { hasText: "Have a gift voucher" }), "Gift voucher? Type its code here"], [page.locator('main input[type="checkbox"]').first().locator("xpath=ancestor::label[1]"), "Agree to the cancellation policy", true], [button(page, /^Pay/), "Pay to confirm", true]]);
  await button(page, /^Pay/).click();
  await page.waitForURL(/demo-checkout/);
  await button(page, /^Pay/).waitFor();
  await snap("checkout-problems", [[page.locator("fieldset.radio-list"), "Demo only: choose what goes wrong"], [button(page, /^Pay/), "Pay"]]);
  await button(page, /^Pay/).click();
  await page.waitForURL(/confirmed/);
  await page.locator("h1").waitFor();
  await page.waitForTimeout(1200);
  await snap("book-confirmed", [[page.locator("h1"), "You're booked: an email follows"]], { top: page.locator("h1") });
});

await visit("phone", async (page, snap) => {
  await page.goto(`${BASE}/manage`);
  await page.locator("#manage-email").fill(JACK);
  await snap("manage-email", [[page.locator("#manage-email"), "The email you booked with"], [button(page, "Send code"), "Send the code"]], { top: page.locator("h1") });
  await button(page, "Send code").click();
  await page.locator(".demo-notify").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await snap("manage-code", [
    [page.locator(".demo-notify"), "The 6-digit code arrives (shown as a notification in this demo)"],
    [page.locator('input[autocomplete="one-time-code"]'), "Type it here"],
    [page.locator("main button.btn-primary").first(), "Continue"],
  ], { top: page.locator("body") });
  await page.locator(".demo-notify-main").click();
  await page.locator('input[autocomplete="one-time-code"]').press("Enter");
  await page.locator("#past-payments").waitFor();
  await snap("manage-bookings", [[button(page, "Change time").first(), "Move it to another time"], [button(page, "Cancel booking").first(), "Or cancel it"]], { top: page.locator("h1") });
  await snap("manage-payments", [[page.locator(".payment-row").first(), "Each payment: what, when and which card"], [page.locator(".payment-row .badge").first(), "Refunds are marked"]], { top: page.locator("#past-payments") });
});

await visit("phone", async (page, snap) => {
  await page.goto(`${BASE}/vouchers`);
  await page.locator("#v-send-me").waitFor();
  await page.getByText("€50", { exact: true }).first().click();
  await snap("voucher-amount", [[page.getByText("€50", { exact: true }).first(), "Choose an amount"], [page.locator("#v-send-me"), "Email it to you, or straight to them"]]);
  await page.locator("#v-send-me").check();
  await page.locator("#v-bname").fill("Orla Brennan");
  await page.locator("#v-bemail").fill("orla@example.com");
  await snap("voucher-pay", [[page.locator("#v-bemail"), "Where the voucher is emailed"], [page.locator('main button[type="submit"]'), "Pay by card"]]);
  await page.locator('main button[type="submit"]').click();
  await page.waitForURL(/demo-checkout/);
  await button(page, /^Pay/).click();
  await page.waitForURL(/thanks/);
  const code = await page.evaluate(() => JSON.parse(localStorage.getItem("northbank-demo:v5")).vouchers.at(-1).code);
  await page.goto(`${BASE}/vouchers/balance`);
  await page.locator("#b-code").fill(code);
  await button(page, "Check").last().click();
  await page.locator(".notice.is-success").waitFor();
  await snap("voucher-balance", [[page.locator("#b-code"), "The code from the voucher"], [page.locator(".notice.is-success"), "What's left, and until when"]], { top: page.locator("h1") });
  // Use it when booking: Jack has a saved card, so the voucher comes off first and the card pays the rest.
  await chooseTime(page);
  await detailsOnFile(page, JACK);
  await page.locator("summary", { hasText: "Have a gift voucher" }).click();
  await page.locator("#voucher-code").fill(code);
  await button(page, "Apply").click();
  await page.locator(".voucher-applied").waitFor();
  await snap("voucher-use", [[page.locator(".voucher-applied"), "The voucher's part comes off the fee"], [button(page, /^Pay/), "The card pays only the rest", true]]);
});

console.log("Staff guides (desktop)");

await visit("desktop", async (page, snap) => {
  await page.goto(`${BASE}/dashboard`);
  const tile = (name) => page.locator("a.option").filter({ hasText: name }).first();
  await tile("Appointments").waitFor();
  await snap("dashboard-home", [[tile("Appointments"), "Find a patient and their appointments"], [tile("Online bookings"), "Payments, refunds and no-shows"], [tile("Waitlist"), "Who is waiting for a time"]], { top: page.locator("h1") });

  await page.goto(`${BASE}/dashboard/appointments`);
  await page.locator("#appt-q").fill("Murphy");
  await page.locator("#appt-q").press("Enter");
  const result = page.locator("button.option").filter({ hasText: "Jack Murphy" }).first();
  await result.waitFor();
  await snap("lookup-search", [[page.locator("#appt-q"), "Surname, full name or date of birth"], [result, "Pick the patient"]], { top: page.locator("#find-h") });
  await result.click();
  await button(page, "Move").first().waitFor();
  await snap("lookup-appointments", [[button(page, "Move").first(), "Move it to another time"], [button(page, "Cancel").first(), "Cancel it, under the 24-hour rule"], [page.getByRole("link", { name: "Book a new appointment" }), "Or book them in again"]], { top: page.locator("#pt-h") });

  await page.goto(`${BASE}/dashboard/bookings`);
  await button(page, "Charge an extra…").first().waitFor();
  await snap("bookings-day", [[page.locator("#admin-date"), "Pick a day"], [page.locator("#admin-email"), "Or search by the patient's email"], [button(page, "Pause online booking"), "Stop new online bookings in an emergency"]], { top: page.locator("h1") });
  const first = page.locator("section.panel, .panel").filter({ has: button(page, "Charge an extra…") }).first();
  await snap("bookings-actions", [[first.getByRole("button", { name: "Refund or waive…" }), "Refund, or waive a fee"], [first.getByRole("button", { name: "Charge an extra…" }), "Charge an extra the patient agreed to"], [first.getByRole("button", { name: "Cancel & refund" }), "Cancel and refund in full"]], { top: first });

  await page.goto(`${BASE}/dashboard/waitlist`);
  await button(page, "Look for times now").waitFor();
  await snap("waitlist-board", [[button(page, "Look for times now"), "Offer any free times that fit"], [button(page, "Add a patient"), "Add someone who rang"], [button(page, "Offer a time…").first(), "Offer one patient a time by hand"]], { top: page.locator("h1") });

  await page.goto(`${BASE}/dashboard/vouchers`);
  const row = page.locator("table button.link-button").first();
  await row.waitFor();
  await row.click();
  await button(page, "Use for a treatment").waitFor();
  await snap("vouchers-desk", [[page.locator("#v-code"), "Look the code up"], [button(page, "Use for a treatment"), "Take the treatment off the voucher"]], { top: page.locator("h1") });

  await page.goto(`${BASE}/dashboard/kpis`);
  await page.locator("main table, main .kpi-card, main .panel").first().waitFor();
  await page.waitForTimeout(800);
  await snap("kpis", [], { top: page.locator("h1") });
});

await visit("desktop", async (page, snap) => {
  await page.goto(`${BASE}/dashboard/book`);
  await page.locator("#patient-lookup").fill("Hannah Lynch");
  const found = page.locator("main button").filter({ hasText: "Hannah Lynch" }).first();
  await found.waitFor();
  await snap("phone-lookup", [[page.locator("#patient-lookup"), "Look the caller up first"], [found, "Their details are filled in for you"]]);
  await found.click();
  await button(page, /^Physiotherapy/).first().click();
  await button(page, /^Return Patient/).click();
  await button(page, /^Standard appointment/).click();
  await page.locator("button.option").filter({ hasText: /Chartered Physiotherapist/ }).first().click();
  await page.locator("button.slot").first().click();
  await button(page, /^Continue/).first().click();
  await page.getByRole("heading", { name: /details/i }).first().waitFor();
  await page.waitForTimeout(600);
  await snap("phone-details", [[button(page, /^Continue/).last(), "Check the details with the caller, then continue"]], { bottom: button(page, /^Continue/).last() });
  await button(page, /^Continue/).last().click();
  const text = page.locator("label.radio").filter({ hasText: /text/i }).first();
  await text.waitFor();
  await text.locator("input").check();
  await snap("phone-pay", [[text, "Send the payment link by text, or by email"], [page.locator("main button.btn-primary").last(), "Send it: the time is held for two hours"]], { top: page.locator("h1") });
});

await visit("phone", async (page, snap) => {
  // The seeded patient whose time went while she paid: her payment was kept.
  await page.goto(`${BASE}/`);
  // The demo saves itself after the first change, so make one, then read the link she was emailed.
  await page.evaluate(() => fetch("/api/manage/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com" }) }));
  await page.waitForFunction(() => !!localStorage.getItem("northbank-demo:v5"));
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("northbank-demo:v5") ?? "{}").rebooks?.[0]?.token);
  if (!token) return problems.push("rebook: no seeded rebook to photograph");
  await page.goto(`${BASE}/rebook/${token}`);
  await page.locator("button.slot").first().waitFor();
  await snap("rebook", [[page.locator("button.slot").first(), "Pick another time: no need to pay again"]], { top: page.locator("h1") });
});

await browser.close();

const body = Object.entries(shots)
  .map(([id, s]) => `  ${JSON.stringify(id)}: ${JSON.stringify(s)},`)
  .join("\n");
writeFileSync(
  join(ROOT, "core", "guides", "shots.ts"),
  `import type { ShotData } from "./types.ts";\n\n/**\n * Written by scripts/guide-shots.mjs: every picture was captured from this demo, with made-up\n * patients. Don't edit by hand; run \`npm run guide-shots\` against the running demo.\n */\nexport const SHOTS: Record<string, ShotData> = {\n${body}\n};\n`,
);
console.log(`\n${Object.keys(shots).length} screenshots written to public/guide-img`);
if (problems.length) {
  console.log(`\n${problems.length} to look at:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}
