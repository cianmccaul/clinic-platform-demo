import { test } from "vitest";
import assert from "node:assert/strict";
import { parseEuroToMinor, planRefund } from "../../core/refunds.ts";

const fee = { paymentIntentId: "pi_fee", amountMinor: 6500, refundedMinor: 0, at: "2026-10-19T09:00:00Z" };
const extra = { paymentIntentId: "pi_extra", amountMinor: 3000, refundedMinor: 0, at: "2026-10-20T11:00:00Z" };

test("a full refund gives back every payment", () => {
  assert.deepEqual(planRefund([fee, extra], 9500), [
    { paymentIntentId: "pi_extra", amountMinor: 3000 },
    { paymentIntentId: "pi_fee", amountMinor: 6500 },
  ]);
});

test("a part refund comes off the newest payment first", () => {
  assert.deepEqual(planRefund([fee, extra], 2000), [{ paymentIntentId: "pi_extra", amountMinor: 2000 }]);
  assert.deepEqual(planRefund([fee, extra], 4000), [
    { paymentIntentId: "pi_extra", amountMinor: 3000 },
    { paymentIntentId: "pi_fee", amountMinor: 1000 },
  ]);
});

test("never refunds more than is left on a payment, or in total", () => {
  const partlyRefunded = { ...fee, refundedMinor: 6000 };
  assert.deepEqual(planRefund([partlyRefunded], 9999), [{ paymentIntentId: "pi_fee", amountMinor: 500 }]);
  assert.deepEqual(planRefund([{ ...fee, refundedMinor: 6500 }], 100), []);
  assert.deepEqual(planRefund([fee], 0), []);
  assert.deepEqual(planRefund([fee], -5), []);
});

test("euro amounts typed by staff", () => {
  assert.equal(parseEuroToMinor("45"), 4500);
  assert.equal(parseEuroToMinor("45.5"), 4550);
  assert.equal(parseEuroToMinor("€45.50"), 4550);
  assert.equal(parseEuroToMinor(" 1,045.10 "), 104510);
  assert.equal(parseEuroToMinor("0"), null);
  assert.equal(parseEuroToMinor("45.555"), null);
  assert.equal(parseEuroToMinor("-5"), null);
  assert.equal(parseEuroToMinor("abc"), null);
});
