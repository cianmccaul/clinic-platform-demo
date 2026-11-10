import { test } from "vitest";
import assert from "node:assert/strict";
import { bookableOnline, isPhoneOnly, phoneOnlyIds } from "../../core/phone-only.ts";

const CLARE = "105";

test("Clare is phone only; others aren't unless added", () => {
  assert.equal(isPhoneOnly(CLARE, {}), true);
  assert.equal(isPhoneOnly("101", {}), false);
  assert.equal(isPhoneOnly("55", { PHONE_ONLY_PRACTITIONER_IDS: " 55 , x, 66" }), true);
  assert.deepEqual([...phoneOnlyIds({ PHONE_ONLY_PRACTITIONER_IDS: "abc" })], [CLARE]);
});

test("a treatment only Clare offers isn't bookable online; one someone else offers online is", () => {
  assert.equal(bookableOnline([{ id: CLARE, show_in_online_bookings: true }], {}), false);
  assert.equal(bookableOnline([{ id: CLARE, show_in_online_bookings: true }, { id: "2", show_in_online_bookings: false }], {}), false);
  assert.equal(bookableOnline([{ id: CLARE, show_in_online_bookings: true }, { id: "2", show_in_online_bookings: true }], {}), true);
  assert.equal(bookableOnline([], {}), false);
});
