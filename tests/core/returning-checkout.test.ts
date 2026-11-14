/** Returning patients skip the details form (core/returning-checkout.ts): the pure rules. */
import { describe, expect, test } from "vitest";
import { VERIFIED_PATIENT_KEY, verifiedPatientDetails, webhookPatientOptions } from "@/core/returning-checkout";

const MAIRE = {
  id: "7001", email: "Maire@Example.com", first_name: "Máire", last_name: "Ní Bhriain", date_of_birth: "1971-05-04", address_1: "12 Seafield Road", state: "Dublin",
  post_code: "D03 X1Y2", notes: "GP: Dr Kelly", patient_phone_numbers: [{ phone_type: "Mobile", number: "087 765 4321" }],
};

describe("returning patients", () => {
  test("details come from the record; only its gaps are asked", () => {
    const full = verifiedPatientDetails(MAIRE, {});
    expect(full).toMatchObject({ usable: true, missing: [], patient: { firstName: "Máire", email: "maire@example.com", phone: "087 765 4321" } });
    const gaps = verifiedPatientDetails({ ...MAIRE, date_of_birth: null, notes: "", patient_phone_numbers: [] }, {});
    expect(gaps.usable && gaps.missing).toEqual(["phone", "dateOfBirth", "gpName"]);
  });

  test("answers fill the gaps, and nothing asked twice", () => {
    const r = verifiedPatientDetails({ ...MAIRE, date_of_birth: null, notes: "" }, { dateOfBirth: "1971-05-04", gpName: " Dr Kelly " });
    expect(r).toMatchObject({ usable: true, missing: [], patient: { dateOfBirth: "1971-05-04", gpName: "Dr Kelly" } });
  });

  test("a record that can't be booked onto is refused", () => {
    expect(verifiedPatientDetails(null, {}).usable).toBe(false);
    expect(verifiedPatientDetails({ ...MAIRE, archived_at: "2026-01-01T00:00:00Z" }, {}).usable).toBe(false);
    expect(verifiedPatientDetails({ ...MAIRE, last_name: "" }, {}).usable).toBe(false);
  });

  test("the record id is trusted only from metadata the server wrote", () => {
    expect(webhookPatientOptions({ [VERIFIED_PATIENT_KEY]: "7001" })).toEqual({ fillGaps: true, clinikoPatientId: "7001" });
    expect(webhookPatientOptions({ [VERIFIED_PATIENT_KEY]: "7001; drop" })).toEqual({ fillGaps: false });
    expect(webhookPatientOptions({ clinikoPatientId: "7001" })).toEqual({ fillGaps: false });
    expect(webhookPatientOptions({ bookedBy: "reception", clinikoPatientId: "7001" })).toEqual({ fillGaps: true, clinikoPatientId: "7001" });
  });
});
