import { test } from "vitest";
import assert from "node:assert/strict";
import { PAY_LINK_HOLD_SECONDS, effectiveStatus, holdSecondsOnOpen, payLinkSms, toE164, ownBookingRefusal } from "../../core/phone-booking.ts";

test("REQ-PHONE-001 a payment link holds the slot for 2 hours", () => {
  assert.equal(PAY_LINK_HOLD_SECONDS, 7200);
});

test("REQ-PHONE-001 an unpaid link lapses when its time is up", () => {
  const now = Date.parse("2026-10-19T10:00:00Z");
  assert.equal(effectiveStatus({ status: "pending", expiresAt: "2026-10-19T10:00:01Z" }, now), "pending");
  assert.equal(effectiveStatus({ status: "pending", expiresAt: "2026-10-19T10:00:00Z" }, now), "expired");
  assert.equal(effectiveStatus({ status: "paid", expiresAt: "2026-10-19T09:00:00Z" }, now), "paid");
});

test("opening a link late keeps the slot held while the Stripe page is open", () => {
  const now = Date.parse("2026-10-19T10:00:00Z");
  assert.equal(holdSecondsOnOpen("2026-10-19T11:30:00Z", 31 * 60, now), 5400);
  assert.equal(holdSecondsOnOpen("2026-10-19T10:05:00Z", 31 * 60, now), 31 * 60 + 60);
});

test("REQ-PHONE-002 mobile numbers for Twilio", () => {
  assert.equal(toE164("087 123 4567"), "+353871234567");
  assert.equal(toE164("(087) 123-4567"), "+353871234567");
  assert.equal(toE164("+353 87 123 4567"), "+353871234567");
  assert.equal(toE164("00353871234567"), "+353871234567");
  assert.equal(toE164("+44 7700 900123"), "+447700900123");
  assert.equal(toE164("01 555 0100"), null); // landline
  assert.equal(toE164("+353 1 555 0100"), null); // Irish landline in + form
  assert.equal(toE164("12345"), null);
});

test("REQ-PHONE-002 the text has the link and date, never the treatment", () => {
  const sms = payLinkSms({
    url: "https://book.northbank.example/pay/abc",
    startsAtISO: "2026-10-20T09:30:00Z",
    expiresAtISO: "2026-10-19T12:00:00Z",
    phone: "01 555 0100",
  });
  assert.match(sms, /https:\/\/book\.northbank\.example\/pay\/abc/);
  assert.match(sms, /Tue 20 Oct, 10:30am/);
  assert.match(sms, /call 01 555 0100/);
  assert.doesNotMatch(sms, /physio|massage|acupuncture|women|pelvic/i);
  assert.ok(sms.length <= 306, `two SMS segments at most (${sms.length})`);
});

test("REQ-PHONE-005 a therapist only books patients in with themselves; reception books anyone", () => {
  assert.equal(ownBookingRefusal({ canBookAnyone: true, ownPractitionerId: null, requestedPractitionerId: "9" }), null);
  assert.equal(ownBookingRefusal({ canBookAnyone: false, ownPractitionerId: "7", requestedPractitionerId: "7" }), null);
  assert.match(ownBookingRefusal({ canBookAnyone: false, ownPractitionerId: "7", requestedPractitionerId: "9" }) ?? "", /only book patients in with yourself/);
  assert.match(ownBookingRefusal({ canBookAnyone: false, ownPractitionerId: null, requestedPractitionerId: "7" }) ?? "", /isn't linked/);
  assert.match(ownBookingRefusal({ canBookAnyone: false, ownPractitionerId: "", requestedPractitionerId: "" }) ?? "", /isn't linked/);
});
