import { test } from "vitest";
import assert from "node:assert/strict";
import { formatCardLine, removedCardLine, withCardLine } from "../../core/card-line.ts";

const visa = formatCardLine({ brand: "visa", last4: "4242", exp_month: 8, exp_year: 2028 });
const mc = formatCardLine({ brand: "mastercard", last4: "5555", exp_month: 12, exp_year: 2029 });

test("REQ-CARD-001 line shows brand, last 4 and expiry only", () => {
  assert.equal(visa, "Card on file (Stripe): Visa •••• 4242, exp 08/28 — charge via Northbank admin");
  assert.doesNotMatch(visa, /\d{5,}/, "never more than 4 consecutive card digits");
});

test("REQ-CARD-001 odd input never leaks more than last 4", () => {
  assert.equal(
    formatCardLine({ brand: "weird", last4: "4242424242424242" }),
    "Card on file (Stripe): Card •••• ???? — charge via Northbank admin"
  );
});

test("REQ-CARD-002 appends to existing notes and keeps them", () => {
  assert.equal(withCardLine(null, visa), visa);
  assert.equal(withCardLine("", visa), visa);
  assert.equal(withCardLine("GP: Dr X\n", visa), `GP: Dr X\n${visa}`);
});

test("REQ-CARD-003 replaces in place, never duplicates", () => {
  const notes = `GP: Dr X\n${visa}\nPrefers mornings`;
  const next = withCardLine(notes, mc);
  assert.equal(next, `GP: Dr X\n${mc}\nPrefers mornings`);
  assert.equal(next.split("Card on file").length - 1, 1);
});

test("REQ-CARD-004 removed line", () => {
  assert.equal(removedCardLine(new Date("2026-10-01T12:00:00Z")), "Card on file (Stripe): none — card removed 1 Oct 2026");
});
