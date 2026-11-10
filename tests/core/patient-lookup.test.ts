import { test } from "vitest";
import assert from "node:assert/strict";
import {
  PATIENT_LOOKUP_PERMISSION,
  clinikoFilters,
  gpNameOf,
  lookupResult,
  normaliseMobile,
  parseLookupQuery,
  prefillFrom,
  sameMobile,
  searchKindLabel,
  suggestedKind,
  visitSummary,
} from "../../core/patient-lookup.ts";
import { can } from "../../core/roles.ts";

test("REQ-LOOKUP-001 reception and owners can look patients up; therapists can't", () => {
  assert.equal(PATIENT_LOOKUP_PERMISSION, "phone-booking");
  assert.equal(can("therapist", PATIENT_LOOKUP_PERMISSION), false);
  assert.equal(can("admin", PATIENT_LOOKUP_PERMISSION), true);
  assert.equal(can("owner", PATIENT_LOOKUP_PERMISSION), true);
});

test("REQ-LOOKUP-002 mobiles in Cliniko's mixed formats all become +353", () => {
  for (const raw of ["087 123 4567", "0871234567", "087-123-4567", "(087) 123 4567", "87 123 4567", "871234567", "353871234567", "+353 87 123 4567", "+353 (0)87 123 4567", "+3530871234567", "00353 87 123 4567"]) {
    assert.equal(normaliseMobile(raw), "+353871234567", raw);
  }
  assert.equal(normaliseMobile("+44 7700 900123"), "+447700900123");
  assert.equal(normaliseMobile("01 555 0100"), null, "landline");
  assert.equal(normaliseMobile("ext 12"), null);
  assert.equal(normaliseMobile(""), null);
  assert.ok(sameMobile("0871234567", "+353 87 123 4567"));
  assert.ok(!sameMobile("0871234567", "0871234568"));
  assert.ok(!sameMobile("", ""));
});

test("REQ-LOOKUP-003 what was typed decides the search, from 3 characters", () => {
  assert.equal(parseLookupQuery("ga"), null);
  assert.equal(parseLookupQuery("   "), null);
  assert.deepEqual(parseLookupQuery("Gallagher"), { kind: "name", first: null, last: "Gallagher" });
  assert.deepEqual(parseLookupQuery("  Niamh   Gallagher "), { kind: "name", first: "Niamh", last: "Gallagher" });
  assert.deepEqual(parseLookupQuery("Mary Anne O'Brien"), { kind: "name", first: "Mary", last: "O'Brien" });
  for (const raw of ["2/4/1958", "02/04/1958", "2-4-1958", "2 4 1958", "1958-04-02", "2.4.1958"]) {
    assert.deepEqual(parseLookupQuery(raw), { kind: "dob", dateOfBirth: "1958-04-02" }, raw);
  }
  assert.equal(parseLookupQuery("31/02/1958"), null, "not a real date");
  assert.deepEqual(parseLookupQuery("Niamh@Example.com"), { kind: "email", email: "niamh@example.com" });
  assert.deepEqual(parseLookupQuery("087 123 4567"), { kind: "phone", mobile: "+353871234567" });
  assert.deepEqual(parseLookupQuery("+353871234567"), { kind: "phone", mobile: "+353871234567" });
  assert.equal(parseLookupQuery("01 555 0100"), null, "a landline isn't searched");
});

test("REQ-LOOKUP-003 Cliniko filters; a phone number isn't something Cliniko can search", () => {
  assert.deepEqual(clinikoFilters({ kind: "name", first: null, last: "Gallagher" }), ["last_name:~Gallagher"]);
  assert.deepEqual(clinikoFilters({ kind: "name", first: "Niamh", last: "Gall%a_gher" }), ["last_name:~Gallagher", "first_name:~Niamh"]);
  assert.deepEqual(clinikoFilters({ kind: "dob", dateOfBirth: "1958-04-02" }), ["date_of_birth:=1958-04-02"]);
  assert.deepEqual(clinikoFilters({ kind: "email", email: "a@b.ie" }), ["email:=a@b.ie"]);
  assert.equal(clinikoFilters({ kind: "phone", mobile: "+353871234567" }), null);
});

test("REQ-LOOKUP-004 the audit log says how someone was searched for, never the name or date typed", () => {
  assert.equal(searchKindLabel({ kind: "name", first: null, last: "Gallagher" }), "surname");
  assert.equal(searchKindLabel({ kind: "name", first: "Niamh", last: "Gallagher" }), "full name");
  assert.equal(searchKindLabel({ kind: "dob", dateOfBirth: "1958-04-02" }), "date of birth");
  assert.ok(!/Gallagher|1958/.test(searchKindLabel({ kind: "name", first: "Niamh", last: "Gallagher" })));
});

const RECORD = {
  id: 5501,
  first_name: "Niamh",
  last_name: "Gallagher",
  preferred_first_name: "",
  email: "niamh.gallagher@example.com",
  date_of_birth: "1958-04-02",
  address_1: "12 Seafield Road",
  state: "Dublin",
  post_code: "d02 xy12",
  notes: "Prefers mornings. Left knee.\nGP: Dr Murphy, Dublin 2",
  patient_phone_numbers: [
    { number: "01 853 0000", phone_type: "Home" },
    { number: "87 123 4567", phone_type: "Mobile" },
  ],
  medical_alerts: "should never be read",
};

test("REQ-LOOKUP-005 results show only who they are and their last and next appointment", () => {
  const names = { practitioners: new Map([["101", "Rhona Synnott"]]), types: new Map([["7", "Physiotherapy - Return Patients"]]) };
  const last = visitSummary(
    { starts_at: "2026-10-03T09:00:00Z", practitioner: { links: { self: "https://api.x/v1/practitioners/101" } }, appointment_type: { links: { self: "https://api.x/v1/appointment_types/7" } }, notes: "clinical" },
    names
  );
  const r = lookupResult(RECORD, last, null);
  assert.deepEqual(r, {
    id: "5501",
    name: "Niamh Gallagher",
    dateOfBirth: "1958-04-02",
    last: { startsAtISO: "2026-10-03T09:00:00Z", practitionerId: "101", practitionerName: "Rhona Synnott", appointmentTypeId: "7", appointmentTypeName: "Physiotherapy - Return Patients" },
    next: null,
  });
  assert.ok(!JSON.stringify(r).match(/knee|Seafield|alerts|clinical|Murphy/), "no notes, address or clinical details");
});

test("REQ-LOOKUP-006 choosing a patient fills the booking form from their record (GP line only from the notes)", () => {
  assert.deepEqual(prefillFrom(RECORD), {
    firstName: "Niamh",
    lastName: "Gallagher",
    email: "niamh.gallagher@example.com",
    phone: "87 123 4567",
    dateOfBirth: "1958-04-02",
    address: "12 Seafield Road",
    county: "Dublin",
    eircode: "d02 xy12",
    gpName: "Dr Murphy, Dublin 2",
  });
  assert.equal(gpNameOf("Left knee"), "");
  assert.equal(gpNameOf(undefined), "");
  assert.equal(prefillFrom({ id: 1, first_name: "A", last_name: "B", patient_phone_numbers: [{ number: "0871234567", phone_type: "Home" }] }).phone, "0871234567", "a mobile number not marked Mobile");
});

test("REQ-LOOKUP-006 returning or last seen 6+ months ago, from their last appointment", () => {
  const now = Date.parse("2026-10-30T10:00:00Z");
  assert.equal(suggestedKind("2026-10-03T09:00:00Z", now), "returning");
  assert.equal(suggestedKind("2026-05-01T09:00:00Z", now), "returning");
  assert.equal(suggestedKind("2026-04-29T09:00:00Z", now), "lapsed");
  assert.equal(suggestedKind(null, now), null);
});
