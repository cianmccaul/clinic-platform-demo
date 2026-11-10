import { test } from "vitest";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  CODE_ALPHABET,
  balanceOf,
  checkChar,
  codeCandidates,
  coversExamples,
  displayCode,
  expiryDay,
  isExpired,
  isHubCode,
  looksMistyped,
  makeCode,
  parseDay,
  parseImport,
  refundToRecord,
  totalsByTherapist,
  typedEuroToMinor,
  undoRefusal,
  useRefusal,
  voucherAmountMinor,
  voucherEmail,
  voucherPdfName,
} from "../../core/vouchers.ts";

const rnd = (n: number) => new Uint8Array(randomBytes(n));

test("REQ-VOU-001 codes: NB + 12 characters, no look-alike characters, a check character", () => {
  for (let i = 0; i < 200; i++) {
    const c = makeCode(rnd);
    assert.match(c, /^NB[2-9A-HJ-NP-Z]{12}$/);
    assert.equal(isHubCode(c), true);
    assert.doesNotMatch(c.slice(2), /[01OI]/);
  }
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(new Set(CODE_ALPHABET).size, 32);
});

test("REQ-VOU-002 a single wrong character is always caught", () => {
  const c = makeCode(rnd);
  const body = c.slice(2, 13);
  for (let i = 0; i < body.length; i++) {
    for (const ch of CODE_ALPHABET) {
      if (ch === body[i]) continue;
      const wrong = body.slice(0, i) + ch + body.slice(i + 1);
      assert.notEqual(checkChar(wrong), c.slice(-1), `position ${i} → ${ch}`);
    }
  }
  assert.equal(looksMistyped(`${c.slice(0, -1)}${c.slice(-1) === "2" ? "3" : "2"}`), true);
  assert.equal(looksMistyped(c), false);
});

test("REQ-VOU-003 shown in groups; typed any way, found", () => {
  const c = "NB" + "7KQ4X9TP2HR";
  const code = c + checkChar("7KQ4X9TP2HR");
  assert.equal(displayCode(code), `NB-7KQ4-X9TP-2HR${code.slice(-1)}`);
  assert.deepEqual(codeCandidates(` nb-7kq4 x9tp-2hr${code.slice(-1).toLowerCase()} `), [code]);
  // Left off the "NB-"
  assert.deepEqual(codeCandidates(`7KQ4-X9TP-2HR${code.slice(-1)}`), [`7KQ4X9TP2HR${code.slice(-1)}`, code]);
  // Imported Vaoucher codes keep their shape
  assert.equal(displayCode("XMAS2025AB"), "XMAS2025AB");
  assert.deepEqual(codeCandidates("xmas-2025-ab"), ["XMAS2025AB"]);
  assert.equal(codeCandidates("ab"), null);
});

test("REQ-VOU-004 amounts: whole euros, €10 to €500", () => {
  assert.equal(voucherAmountMinor(75), 7500);
  assert.equal(voucherAmountMinor("75"), 7500);
  assert.equal(voucherAmountMinor("€100"), 10000);
  assert.equal(voucherAmountMinor(9), null);
  assert.equal(voucherAmountMinor(501), null);
  assert.equal(voucherAmountMinor(75.5), null);
  assert.equal(voucherAmountMinor("abc"), null);
  assert.equal(voucherAmountMinor(-50), null);
});

test("REQ-VOU-005 lasts 5 years from the day it's bought (never less)", () => {
  assert.equal(expiryDay("2026-11-20"), "2031-11-20");
  assert.equal(expiryDay("2028-02-29"), "2033-03-01");
  assert.equal(isExpired("2031-11-20", "2031-11-20"), false); // usable on the last day
  assert.equal(isExpired("2031-11-20", "2031-11-21"), true);
  assert.equal(isExpired(null, "2099-01-01"), false);
});

test("REQ-VOU-006 using it: part use allowed, never more than is left, not when cancelled, unpaid or expired", () => {
  const v = { status: "active" as const, expiresOn: "2031-11-20", balanceMinor: 7500 };
  const today = "2026-12-01";
  assert.equal(useRefusal(v, 5000, today), null);
  assert.equal(useRefusal(v, 7500, today), null);
  assert.match(useRefusal(v, 7501, today)!, /Only €75\.00 is left/);
  assert.match(useRefusal(v, 0, today)!, /more than €0/);
  assert.match(useRefusal(v, 12.5, today)!, /more than €0/);
  assert.match(useRefusal({ ...v, balanceMinor: 0 }, 100, today)!, /nothing left/);
  assert.match(useRefusal({ ...v, status: "cancelled" }, 100, today)!, /cancelled/);
  assert.match(useRefusal({ ...v, status: "pending" }, 100, today)!, /hasn't been paid/);
  assert.match(useRefusal(v, 100, "2031-11-21")!, /expired on 20 November 2031/);
});

test("REQ-VOU-007 the balance is the sum of the ledger; a use can be undone once", () => {
  assert.equal(balanceOf([{ amountMinor: 10000 }, { amountMinor: -7500 }, { amountMinor: 7500 }, { amountMinor: -2000 }]), 8000);
  const used = { id: "e2", kind: "redeemed" as const, amountMinor: -7500 };
  assert.equal(undoRefusal(used, false), null);
  assert.match(undoRefusal(used, true)!, /already been undone/);
  assert.match(undoRefusal({ id: "e1", kind: "issued", amountMinor: 10000 }, false)!, /Only a use/);
  assert.match(undoRefusal(undefined, false)!, /isn't on this voucher/);
});

test("REQ-VOU-008 a refund made in Stripe all goes on the ledger (even below zero), and says how much had been used", () => {
  assert.deepEqual(refundToRecord(7500, 0, 7500), { take: 7500, shortMinor: 0 });
  assert.deepEqual(refundToRecord(7500, 0, 2500), { take: 7500, shortMinor: 5000 });
  assert.deepEqual(refundToRecord(7500, 7500, 0), { take: 0, shortMinor: 0 }); // the same event again
  assert.deepEqual(refundToRecord(5000, 2000, 8000), { take: 3000, shortMinor: 0 });
  assert.deepEqual(refundToRecord(5000, 0, -1000), { take: 5000, shortMinor: 5000 });
});

test("REQ-VOU-009 desk amounts", () => {
  assert.equal(typedEuroToMinor("75"), 7500);
  assert.equal(typedEuroToMinor("€ 75.5"), 7550);
  assert.equal(typedEuroToMinor("1,000"), 100000);
  assert.equal(typedEuroToMinor("37,50"), 3750); // a decimal comma, not €3,750
  assert.equal(typedEuroToMinor("12,5"), 1250);
  assert.equal(typedEuroToMinor("1,00,0"), null);
  assert.equal(typedEuroToMinor("1,000.50"), 100050);
  assert.equal(typedEuroToMinor("0"), null);
  assert.equal(typedEuroToMinor("75.555"), null);
  assert.equal(typedEuroToMinor("-5"), null);
});

test("REQ-VOU-010 Vaoucher import: code, amount left, expiry date, optional name; problems listed by line", () => {
  const r = parseImport(
    ["Code,Balance,Expiry,Name", "XMAS-25-AB12, 50, 31/12/2030, Mary Byrne", "GIFT9999;75.50;2029-06-01", "BAD1,abc,31/12/2030", "NODATE1,20,soon", "XMAS-25-AB12,10,31/12/2030", "", "2,5,1/1/2030"].join("\n")
  );
  assert.deepEqual(r.rows, [
    { code: "XMAS25AB12", balanceMinor: 5000, expiresOn: "2030-12-31", name: "Mary Byrne" },
    { code: "GIFT9999", balanceMinor: 7550, expiresOn: "2029-06-01", name: "" },
  ]);
  assert.equal(r.problems.length, 4);
  assert.match(r.problems[0], /Line 4 \(BAD1\): the amount/);
  assert.match(r.problems[1], /Line 5 \(NODATE1\): the expiry date/);
  assert.match(r.problems[2], /twice/);
  assert.match(r.problems[3], /Line 8: no voucher code/);
  assert.equal(parseDay("31/02/2030"), null);
  assert.equal(parseDay("1.3.2030"), "2030-03-01");
});

test("REQ-VOU-011 the emails carry what the law needs in writing: bought, valid until, how long it can be used", () => {
  const v = { code: "NB7KQ4X9TP2HR" + checkChar("7KQ4X9TP2HR"), amountMinor: 7500, purchaseDay: "2026-11-20", expiresOn: "2031-11-20", buyerName: "Aoife Byrne", recipientName: "Sean Byrne", message: "Happy Christmas!" };
  const buyer = voucherEmail(v, "buyer", { sentToRecipient: "sean@example.com" });
  assert.match(buyer.subject, /Thank you: your Northbank gift voucher \(€75\.00\)/);
  for (const re of [/Bought: 20 November 2026/, /Valid until: 20 November 2031/, /any time from the day it was bought until then/, /NB-7KQ4-X9TP/, /emailed the voucher to Sean Byrne at sean@example\.com/, /01 555 0100/]) assert.match(buyer.text, re);
  const them = voucherEmail(v, "recipient");
  assert.match(them.subject, /^Aoife sent you a Northbank gift voucher \(€75\.00\)$/);
  assert.match(them.text, /Hi Sean/);
  assert.match(them.text, /Their message: "Happy Christmas!"/);
  assert.match(them.text, /Valid until: 20 November 2031/);
  const again = voucherEmail({ ...v, balanceMinor: 2500 }, "buyer", { resend: true });
  assert.match(again.subject, /Your Northbank gift voucher NB-7KQ4/);
  assert.match(again.text, /€25\.00 left/);
  assert.equal(voucherPdfName(v.code).includes(" "), false);
});

test("REQ-VOU-012 what an amount covers, from live prices", () => {
  const types = [
    { name: "Physiotherapy", fullPriceEUR: 75 },
    { name: "Sports Massage 60", fullPriceEUR: 80 },
    { name: "Sports Massage 30", fullPriceEUR: 50 },
    { name: "Physiotherapy", fullPriceEUR: 75 },
    { name: "No price", fullPriceEUR: null },
    { name: "Free review", fullPriceEUR: 0 },
  ];
  assert.deepEqual(coversExamples(7500, types).map((t) => t.name), ["Physiotherapy", "Sports Massage 30"]);
  assert.deepEqual(coversExamples(10000, types, 2).map((t) => t.name), ["Sports Massage 60", "Physiotherapy"]);
  assert.deepEqual(coversExamples(1000, types), []);
});

test("REQ-VOU-013 per-therapist totals: uses minus undos", () => {
  const t = totalsByTherapist([
    { practitionerId: "1", practitionerName: "Clare K", amountMinor: 7500 },
    { practitionerId: "2", practitionerName: "Anna B", amountMinor: 5000 },
    { practitionerId: "1", practitionerName: "Clare K", amountMinor: 2500 },
    { practitionerId: "2", practitionerName: "Anna B", amountMinor: -5000 },
  ]);
  assert.deepEqual(t, [{ practitionerId: "1", name: "Clare K", amountMinor: 10000, count: 2 }]);
});

// ---- v2 (29 Oct 2026)
import { appliedMinor, availableOf, checkoutRefusal, sendDue, sendOnRefusal, voucherNetMinor, voucherCheckoutOn, howToUse } from "../../core/vouchers.ts";
import { invoicePayments } from "../../core/hub-invoice.ts";
import { needsClinikoInvoice } from "../../core/invoicing.ts";

test("REQ-VOU-031 a voucher covers up to the fee, never leaving under Stripe's 50c on the card", () => {
  assert.equal(appliedMinor(7500, 10000), 7500);
  assert.equal(appliedMinor(7500, 5000), 5000);
  assert.equal(appliedMinor(7500, 7480), 7450, "€0.20 left would be under 50c: the voucher covers 50c less");
  assert.equal(appliedMinor(7500, 0), 0);
  assert.equal(appliedMinor(40, 100), 40);
  assert.equal(availableOf(7500, 5000), 2500);
});

test("REQ-VOU-032 checkout refuses cancelled, expired, empty and fully set-aside vouchers, without saying whose it is", () => {
  const ok = { status: "active" as const, expiresOn: "2031-01-01", availableMinor: 100, balanceMinor: 100 };
  assert.equal(checkoutRefusal(ok, "2026-11-01"), null);
  assert.match(checkoutRefusal({ ...ok, status: "cancelled" }, "2026-11-01")!, /can't be used/);
  assert.match(checkoutRefusal({ ...ok, expiresOn: "2026-10-01" }, "2026-11-01")!, /expired/);
  assert.match(checkoutRefusal({ ...ok, balanceMinor: 0, availableMinor: 0 }, "2026-11-01")!, /nothing left/);
  assert.match(checkoutRefusal({ ...ok, availableMinor: 0 }, "2026-11-01")!, /another booking right now/);
});

test("REQ-VOU-033 scheduled send: today to 90 days ahead; due from 8am on the day", () => {
  assert.equal(sendOnRefusal("2026-12-25", "2026-11-01"), null);
  assert.match(sendOnRefusal("2026-10-31", "2026-11-01")!, /today or a day after/);
  assert.match(sendOnRefusal("2027-03-01", "2026-11-01")!, /next 90 days/);
  assert.equal(sendDue("2026-12-25", "2026-12-25", 7), false);
  assert.equal(sendDue("2026-12-25", "2026-12-25", 8), true);
  assert.equal(sendDue("2026-12-25", "2026-12-26", 0), true);
  assert.equal(sendDue(null, "2026-12-24", 0), true);
});

test("REQ-VOU-034 the voucher part of a booking is invoiced as its own payment, and putting it back is its refund", () => {
  const b = { payments: [], voucher: { voucherId: "v", code: "NB7KQ4X9TP2HRM", holdId: "h", eventId: "e1", amountMinor: 5000, returnedMinor: 5000, at: "2026-11-05T10:00:00Z" } };
  const [p] = invoicePayments(b);
  assert.equal(p.paymentIntentId, "vch_e1");
  assert.equal(p.amountMinor, 5000);
  assert.equal(p.refundedMinor, 5000);
  assert.equal(p.voucherCode, "NB7KQ4X9TP2HRM");
  assert.equal(voucherNetMinor(b.voucher), 0);
  assert.equal(invoicePayments({ payments: [], voucher: { ...b.voucher, eventId: undefined } }).length, 0, "not marked used yet: nothing to invoice");
  // While Hub invoices are off, a booking paid only by voucher still shows on "Not invoiced yet".
  assert.equal(needsClinikoInvoice({ payments: [], status: "booked", voucher: { ...b.voucher, returnedMinor: 0 } }), true);
});

test("REQ-VOU-035 emails and the PDF say the code can be typed online only once that's switched on", () => {
  assert.equal(voucherCheckoutOn({ VOUCHER_CHECKOUT: "on" }), true);
  assert.equal(voucherCheckoutOn({ VOUCHER_SALES: "on" }), false);
  assert.match(howToUse(true), /book\.northbank\.example/);
  assert.doesNotMatch(howToUse(false), /type the code/);
});
