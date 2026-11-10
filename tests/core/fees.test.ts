import { test } from "vitest";
import assert from "node:assert/strict";
import { applicationFeeMinor, parseFeePercent } from "../../core/fees.ts";

test("REQ-PAY-006 clinic fee is server-side, bounded, in cents", () => {
  assert.equal(applicationFeeMinor(8000, 0), 0);
  assert.equal(applicationFeeMinor(8000, 10), 800);
  assert.equal(applicationFeeMinor(2001, 12.5), 250);
  assert.equal(applicationFeeMinor(8000, 150), 8000);
  assert.equal(applicationFeeMinor(8000, NaN), 0);
  assert.equal(parseFeePercent(undefined), 0);
  assert.equal(parseFeePercent("15"), 15);
  assert.equal(parseFeePercent("-3"), 0);
  assert.equal(parseFeePercent("abc"), 0);
});
