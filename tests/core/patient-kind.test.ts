import { test } from "vitest";
import assert from "node:assert/strict";
import { PATIENT_KINDS, isPatientKind, kindOfType, typesFor, visitNote } from "../../core/patient-kind.ts";

test("Cliniko's names are read as new or returning", () => {
  for (const n of ["Physiotherapy - New Patient", "Women's Health Physio, New Patient", "Osteopathy New Patient", "New Patient - lower limb biomechanical assessment", "Scoliosis Treatment & Rehab - New Patient"]) assert.equal(kindOfType(n), "new", n);
  for (const n of ["Physiotherapy - Return Patient", "Physiotherapy - Return Patient 45mins", "Osteopathy Return Patients", "Extended Women's Health Physio Return Patient", "Returning Patient check"]) assert.equal(kindOfType(n), "returning", n);
});

test("types that don't say are for both", () => {
  for (const n of ["Massage 60 mins", "Acupuncture", "Standard Appointment", "Renewal of prescription"]) assert.equal(kindOfType(n), null, n);
});

test("new and lapsed patients see the new-patient types, returning the return types", () => {
  const all = [{ name: "Physio - New Patient" }, { name: "Physio - Return Patient" }, { name: "Massage" }];
  const names = (k: (typeof PATIENT_KINDS)[number]) => typesFor(all, k).map((t) => t.name);
  assert.deepEqual(names("new"), ["Physio - New Patient", "Massage"]);
  assert.deepEqual(names("lapsed"), ["Physio - New Patient", "Massage"]);
  assert.deepEqual(names("returning"), ["Physio - Return Patient", "Massage"]);
});

test("the appointment note keeps the three answers apart, and ignores anything else", () => {
  const notes = PATIENT_KINDS.map((k) => visitNote(k));
  assert.equal(new Set(notes).size, 3);
  assert.match(visitNote("new"), /first visit/);
  assert.match(visitNote("returning"), /within the last 6 months/);
  assert.match(visitNote("lapsed"), /6\+ months ago/);
  for (const bad of [undefined, null, "", "other", 3]) assert.equal(visitNote(bad), "");
  assert.equal(isPatientKind("lapsed"), true);
  assert.equal(isPatientKind("other"), false);
});
