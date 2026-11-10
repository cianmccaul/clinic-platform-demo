import { test } from "vitest";
import assert from "node:assert/strict";
import { firstNamesMatch, isSamePerson, matchPatient, normaliseNamePart } from "../../core/patient-match.ts";

const mum = { id: 1, first_name: "Siobhán", last_name: "O'Brien", date_of_birth: "1980-03-01" };
const son = { id: 2, first_name: "Jack", last_name: "O'Brien", date_of_birth: "2012-07-09" };
const dad = { id: 3, first_name: "John", last_name: "Murphy", date_of_birth: "1950-01-01" };
const dadJr = { id: 4, first_name: "John", last_name: "Murphy", date_of_birth: "1985-05-05" };

test("REQ-MATCH-001 a family sharing one email: the booking goes to the named person", () => {
  assert.equal(matchPatient([mum, son], { firstName: "Jack", lastName: "O'Brien" }).patient?.id, 2);
  assert.equal(matchPatient([mum, son], { firstName: "Siobhan", lastName: "OBrien" }).patient?.id, 1);
  assert.equal(matchPatient([mum, son], { firstName: "Jack", lastName: "O'Brien" }).sharedEmail, true);
});

test("REQ-MATCH-002 no name match means a new record, never the first one on the email", () => {
  const r = matchPatient([mum, son], { firstName: "Aoife", lastName: "O'Brien" });
  assert.equal(r.patient, null);
  assert.equal(r.sharedEmail, true);
  assert.equal(matchPatient([], { firstName: "Aoife", lastName: "Byrne" }).sharedEmail, false);
});

test("REQ-MATCH-003 one record, same person: matched, not shared", () => {
  const r = matchPatient([mum], { firstName: "siobhan", lastName: "o brien", dateOfBirth: "1980-03-01" });
  assert.equal(r.patient?.id, 1);
  assert.equal(r.sharedEmail, false);
});

test("REQ-MATCH-004 same name, different date of birth: two people", () => {
  assert.equal(matchPatient([dad, dadJr], { firstName: "John", lastName: "Murphy", dateOfBirth: "1985-05-05" }).patient?.id, 4);
  assert.equal(matchPatient([dad], { firstName: "John", lastName: "Murphy", dateOfBirth: "1985-05-05" }).patient, null);
  // No date of birth on either side: the name decides (oldest record first).
  assert.equal(matchPatient([dad, dadJr], { firstName: "John", lastName: "Murphy" }).patient?.id, 3);
  // Record without a date of birth still matches by name.
  assert.equal(isSamePerson({ id: 5, first_name: "John", last_name: "Murphy" }, { firstName: "John", lastName: "Murphy", dateOfBirth: "1985-05-05" }), true);
});

test("REQ-MATCH-005 name forms: accents, ł, hyphens, middle names, preferred first name", () => {
  assert.equal(normaliseNamePart("  Wiśniewska "), "wisniewska");
  assert.equal(isSamePerson({ id: 1, first_name: "Aoife", last_name: "Test-Byrne" }, { firstName: "Aoife", lastName: "Test Byrne" }), true);
  assert.equal(firstNamesMatch("Mary Anne", "Mary"), true);
  assert.equal(firstNamesMatch("Mary", "Maria"), false);
  assert.equal(isSamePerson({ id: 1, first_name: "Katherine", preferred_first_name: "Kate", last_name: "Doyle" }, { firstName: "Kate", lastName: "Doyle" }), true);
  assert.equal(isSamePerson({ id: 1, first_name: "*** NO LAST NAME", last_name: "" }, { firstName: "Tom", lastName: "Ryan" }), false);
  assert.equal(isSamePerson({ id: 1, first_name: "Tom", last_name: "Ryan" }, { firstName: "Tom", lastName: "" }), false);
});
