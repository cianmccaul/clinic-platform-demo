import { test } from "vitest";
import assert from "node:assert/strict";
import {
  OFFER_WINDOW_MINUTES, waitlistJoinedEmail, channelsFor, clampUntilDay, ineligibleReason, joinRefusal, offerExpiry, rankEntries,
  slotMatchesEntry, waitlistJoinedSms, waitlistOfferSms, withinSendHours, type WaitlistEntry,
} from "../../core/waitlist.ts";

const entry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
  id: "e1", status: "active", createdAt: "2026-10-26T09:00:00Z", practitionerId: "1", appointmentTypeId: "10", appointmentTypeName: "Physio",
  businessId: "5", fromDay: "2026-10-27", untilDay: "2026-12-20", days: [], parts: [], wantsSms: false,
  patient: { firstName: "Aoife", lastName: "Byrne", email: "a@example.com", phone: "087 123 4567" }, offerLog: [], ignoredInRow: 0, ...over,
});
const NOW = Date.parse("2026-10-27T09:00:00Z"); // 09:00 Irish time (GMT after 25 Oct)

test("REQ-WAIT-001 each patient gets a 2 hour window to accept", () => {
  assert.equal(OFFER_WINDOW_MINUTES, 120);
  assert.equal(offerExpiry("2026-10-28T10:00:00Z", NOW), "2026-10-27T11:00:00.000Z");
});

test("REQ-WAIT-001 the window never runs past 1 hour before the appointment, and no automatic offers under 3 hours' notice", () => {
  assert.equal(offerExpiry("2026-10-27T12:00:00Z", NOW), "2026-10-27T11:00:00.000Z"); // exactly 3 h: full 2 h
  assert.equal(offerExpiry("2026-10-27T11:59:00Z", NOW), null);
  assert.equal(offerExpiry("2026-10-27T08:00:00Z", NOW), null); // in the past
  // reception can still offer a nearer time by hand, with a shorter window
  assert.equal(offerExpiry("2026-10-27T10:00:00Z", NOW, true), "2026-10-27T09:45:00.000Z");
  assert.equal(offerExpiry("2026-10-27T09:20:00Z", NOW, true), null);
});

test("REQ-WAIT-002 messages only go out between 08:30 and 20:00 Irish time", () => {
  assert.equal(withinSendHours(Date.parse("2026-10-27T08:29:00Z")), false);
  assert.equal(withinSendHours(Date.parse("2026-10-27T08:30:00Z")), true);
  assert.equal(withinSendHours(Date.parse("2026-10-27T19:59:00Z")), true);
  assert.equal(withinSendHours(Date.parse("2026-10-27T20:00:00Z")), false);
  // summer time: 08:30 Irish is 07:30 UTC
  assert.equal(withinSendHours(Date.parse("2026-07-01T07:30:00Z")), true);
  assert.equal(withinSendHours(Date.parse("2026-07-01T07:29:00Z")), false);
});

test("REQ-WAIT-003 an opening must fit the therapist, dates, weekdays and parts of the day chosen", () => {
  const slot = { practitionerId: "1", startsAtISO: "2026-10-28T10:00:00Z" }; // Wed, morning
  assert.equal(slotMatchesEntry(entry(), slot), true);
  assert.equal(slotMatchesEntry(entry({ practitionerId: "2" }), slot), false);
  assert.equal(slotMatchesEntry(entry({ practitionerId: "any" }), slot), true);
  assert.equal(slotMatchesEntry(entry({ days: [1, 2] }), slot), false);
  assert.equal(slotMatchesEntry(entry({ days: [3] }), slot), true);
  assert.equal(slotMatchesEntry(entry({ parts: ["Afternoon"] }), slot), false);
  assert.equal(slotMatchesEntry(entry({ parts: ["Morning", "Evening"] }), slot), true);
  assert.equal(slotMatchesEntry(entry({ untilDay: "2026-10-27" }), slot), false);
  assert.equal(slotMatchesEntry(entry({ fromDay: "2026-10-29" }), slot), false);
});

test("REQ-WAIT-003 days and parts use Irish time, not UTC", () => {
  // 23:30 UTC on 1 Jul is 00:30 Irish time on 2 Jul (Thursday, morning)
  const slot = { practitionerId: "1", startsAtISO: "2026-07-01T23:30:00Z" };
  assert.equal(slotMatchesEntry(entry({ fromDay: "2026-07-01", untilDay: "2026-07-01" }), slot), false);
  assert.equal(slotMatchesEntry(entry({ fromDay: "2026-07-02", untilDay: "2026-07-02", days: [4] }), slot), true);
});

test("REQ-WAIT-004 order: the named therapist's list first, then longest since an offer, then joined first", () => {
  const slot = { practitionerId: "1", startsAtISO: "2026-10-28T10:00:00Z" };
  const any = entry({ id: "any", practitionerId: "any", createdAt: "2026-10-01T00:00:00Z" });
  const newer = entry({ id: "newer", createdAt: "2026-10-20T00:00:00Z" });
  const older = entry({ id: "older", createdAt: "2026-10-10T00:00:00Z" });
  const offeredRecently = entry({ id: "recent", createdAt: "2026-10-02T00:00:00Z", lastOfferAt: "2026-10-26T00:00:00Z" });
  const order = rankEntries([any, newer, offeredRecently, older], slot, NOW).map((e) => e.id);
  assert.deepEqual(order, ["older", "newer", "recent", "any"]);
});

test("REQ-WAIT-005 limits: one offer a day, four a week, pause after three ignored, paused entries skipped", () => {
  const todayOffer = new Date(NOW - 3 * 3_600_000).toISOString();
  assert.match(ineligibleReason(entry({ offerLog: [todayOffer] }), NOW)!, /today/);
  const spread = [1, 2, 3, 4].map((d) => new Date(NOW - d * 86_400_000).toISOString());
  assert.match(ineligibleReason(entry({ offerLog: spread }), NOW)!, /week/);
  assert.equal(ineligibleReason(entry({ offerLog: spread.slice(0, 3) }), NOW), null);
  assert.match(ineligibleReason(entry({ ignoredInRow: 3 }), NOW)!, /ignored/);
  assert.match(ineligibleReason(entry({ status: "paused" }), NOW)!, /paused/);
  assert.match(ineligibleReason(entry({ status: "offered" }), NOW)!, /offered/);
  assert.match(ineligibleReason(entry({ untilDay: "2026-10-26" }), NOW)!, /end date/);
});

test("REQ-WAIT-005 at most two places on the list, and not the same thing twice", () => {
  const live = [{ practitionerId: "1", appointmentTypeId: "10", status: "active" as const }];
  assert.match(joinRefusal(live, { practitionerId: "1", appointmentTypeId: "10" })!, /already/);
  assert.equal(joinRefusal(live, { practitionerId: "2", appointmentTypeId: "10" }), null);
  const two = [...live, { practitionerId: "2", appointmentTypeId: "11", status: "paused" as const }];
  assert.match(joinRefusal(two, { practitionerId: "3", appointmentTypeId: "12" })!, /up to 2/);
  const cancelled = [{ practitionerId: "1", appointmentTypeId: "10", status: "cancelled" as const }];
  assert.equal(joinRefusal(cancelled, { practitionerId: "1", appointmentTypeId: "10" }), null);
});

test("an entry can run for at most 60 days", () => {
  assert.equal(clampUntilDay("2026-10-27", undefined), "2026-12-26");
  assert.equal(clampUntilDay("2026-10-27", "2026-11-10"), "2026-11-10");
  assert.equal(clampUntilDay("2026-10-27", "2027-06-01"), "2026-12-26");
  assert.equal(clampUntilDay("2026-10-27", "2026-10-01"), "2026-12-26");
});

test("REQ-WAIT-006 text only once texts are set up (27 Oct); email until then, without consent, or with no mobile", () => {
  assert.deepEqual(channelsFor(entry({ wantsSms: true }), false), ["email"]);
  assert.deepEqual(channelsFor(entry({ wantsSms: false }), true), ["email"]);
  assert.deepEqual(channelsFor(entry({ wantsSms: true }), true), ["sms"]);
  assert.deepEqual(channelsFor(entry({ wantsSms: true, patient: { firstName: "A", lastName: "B", email: "a@b.ie", phone: "01 555 0100" } }), true), ["email"]);
});

test("REQ-WAIT-006 the text carries only the link and the date, never the treatment", () => {
  const s = waitlistOfferSms({ url: "https://book.northbank.example/pay/abc", startsAtISO: "2026-10-28T10:00:00Z", expiresAtISO: "2026-10-27T11:00:00Z", phone: "01 555 0100" });
  assert.match(s, /^Northbank:/);
  assert.match(s, /Wed 28 Oct, 10:00am/);
  assert.match(s, /until 11:00am/);
  assert.match(s, /leave the waitlist/);
  assert.doesNotMatch(s, /physio|laser|massage|osteo/i);
});

// Plain GSM characters only, and one text (160) with a real-length pay link; the joined text with a real leave link.
const GSM = /^[A-Za-z0-9 .,:;'!?()\/@&%+\-_"=\n]*$/;
test("REQ-WAIT-006 the texts are plain characters and fit one text (offer) / two at most (joined)", () => {
  // A made-up domain the same length as the real booking site, so the length check means the same.
  const url = "https://book.nb.example/pay/" + "A".repeat(22);
  for (const [start, exp] of [["2026-10-28T10:00:00Z", "2026-10-27T11:00:00Z"], ["2026-12-30T10:30:00Z", "2026-12-30T00:30:00Z"]]) {
    const s = waitlistOfferSms({ url, startsAtISO: start, expiresAtISO: exp, phone: "01 555 0100" });
    assert.match(s, GSM);
    assert.ok(s.length <= 160, `offer text is ${s.length} characters: ${s}`);
  }
  const j = waitlistJoinedSms({ leaveUrl: "https://book.northbank.example/waitlist/leave/" + "A".repeat(22), phone: "01 555 0100" });
  assert.match(j, GSM);
  assert.match(j, /pause or leave/);
  assert.ok(j.length <= 306, `joined text is ${j.length} characters`);
});

test("REQ-WAIT-020 (audit M6) waitlist texts go to Irish mobiles only; other numbers are told by email", () => {
  const withPhone = (phone: string) => entry({ wantsSms: true, patient: { firstName: "A", lastName: "B", email: "a@b.ie", phone } });
  assert.deepEqual(channelsFor(withPhone("+353 87 123 4567"), true), ["sms"]);
  assert.deepEqual(channelsFor(withPhone("0871234567"), true), ["sms"]);
  assert.deepEqual(channelsFor(withPhone("+44 7700 900123"), true), ["email"]);
  assert.deepEqual(channelsFor(withPhone("+882 1234 5678"), true), ["email"]);
  assert.deepEqual(channelsFor(withPhone("00 1 900 555 0100"), true), ["email"]);
});

test("REQ-WAIT-021 (audit L8) the 'you're on the waitlist' email says how offers will come", () => {
  const base = { firstName: "A", treatment: "Physiotherapy", practitioner: "Clare", phone: "01 555 0100", leaveUrl: "https://x" };
  assert.match(waitlistJoinedEmail({ ...base, sms: true, smsAvailable: true }).text, /we'll send a text message with a link/);
  assert.doesNotMatch(waitlistJoinedEmail({ ...base, sms: true, smsAvailable: true }).text, /an email and a text/);
  assert.match(waitlistJoinedEmail({ ...base, sms: false, smsAvailable: true }).text, /we'll send an email with a link/);
  assert.match(waitlistJoinedEmail({ ...base, sms: true, smsAvailable: false }).text, /we'll send an email with a link/);
});
