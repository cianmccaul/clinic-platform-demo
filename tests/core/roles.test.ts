import { test } from "vitest";
import assert from "node:assert/strict";
import { allowedOnWeakSession, can, guideAudiences, needsStrongFor, needsStrongSignIn, staffChangeRefusal, type Role } from "../../core/roles.ts";

const s = (id: string, role: Role, active = true) => ({ id, role, active });

test("REQ-AUTH-001 each role sees its own guides and everything below it; patients see patient guides only", () => {
  assert.deepEqual(guideAudiences(null), ["patient"]);
  assert.deepEqual(guideAudiences("therapist"), ["patient", "therapist"]);
  assert.deepEqual(guideAudiences("admin"), ["patient", "therapist", "admin"]);
  assert.deepEqual(guideAudiences("owner"), ["patient", "therapist", "admin", "owner"]);
  assert.deepEqual(guideAudiences("superadmin"), ["patient", "therapist", "admin", "owner"]);
});

test("REQ-AUTH-002 therapists can't touch bookings, money or staff; reception can't manage staff", () => {
  for (const p of ["bookings:view", "bookings:manage", "phone-booking", "clinic:controls", "staff:manage", "timesheets:all"] as const) {
    assert.equal(can("therapist", p), false, p);
  }
  assert.equal(can("admin", "bookings:manage"), true);
  assert.equal(can("admin", "phone-booking"), true);
  assert.equal(can("admin", "staff:manage"), false);
  assert.equal(can("admin", "timesheets:all"), true, "reception sees everyone's timesheets");
  assert.equal(can("admin", "therapists:payments-setup"), false);
  assert.equal(can("owner", "staff:manage"), true);
  assert.equal(can("superadmin", "staff:manage"), true);
  assert.equal(can(null, "guides:therapist"), false);
});

test("REQ-AUTH-012 therapists book their own patients in (16 Oct 2026); everyone who books by phone can too", () => {
  assert.equal(can("therapist", "phone-booking:own"), true);
  assert.equal(can("therapist", "phone-booking"), false, "not anyone's diary, not the card over the phone");
  for (const r of ["admin", "owner", "superadmin"] as const) assert.equal(can(r, "phone-booking:own"), true, r);
  assert.equal(can(null, "phone-booking:own"), false);
  // Sending a payment request needs Face ID or an approved computer, even for a therapist.
  assert.equal(needsStrongFor("therapist", "phone-booking:own"), true);
  assert.equal(needsStrongFor("therapist", "guides:therapist"), false);
  assert.equal(needsStrongFor("admin", "guides:admin"), true);
  assert.equal(allowedOnWeakSession("phone-booking:own"), false);
});

test("REQ-AUTH-003 anyone who can move money needs a Face ID / passkey sign-in; an emailed code only opens guides", () => {
  assert.equal(needsStrongSignIn("therapist"), false);
  for (const r of ["admin", "owner", "superadmin"] as const) assert.equal(needsStrongSignIn(r), true);
  assert.equal(allowedOnWeakSession("guides:therapist"), true);
  assert.equal(allowedOnWeakSession("guides:admin"), false, "reception and owner guides need Face ID");
  assert.equal(allowedOnWeakSession("guides:owner"), false);
  assert.equal(allowedOnWeakSession("bookings:manage"), false);
  assert.equal(allowedOnWeakSession("staff:manage"), false);
});

test("REQ-AUTH-004 only owners manage owners and super admins; nobody changes themselves; never zero owners", () => {
  const owner = s("o1", "owner");
  const owner2 = s("o2", "owner");
  const sa = s("sa", "superadmin");
  const admin = s("a", "admin");
  const ther = s("t", "therapist");

  // Who may manage staff at all.
  assert.match(staffChangeRefusal({ actor: admin, target: ther, nextActive: false, activeOwnerCount: 1 }) ?? "", /Only an owner or super admin/);
  assert.match(staffChangeRefusal({ actor: s("x", "owner", false), target: ther, nextActive: false, activeOwnerCount: 1 }) ?? "", /Only an owner or super admin/);

  // Super admin: therapists and admins yes; owners and super admins no.
  assert.equal(staffChangeRefusal({ actor: sa, target: null, nextRole: "therapist", activeOwnerCount: 1 }), null);
  assert.equal(staffChangeRefusal({ actor: sa, target: ther, nextRole: "admin", activeOwnerCount: 1 }), null);
  assert.match(staffChangeRefusal({ actor: sa, target: null, nextRole: "owner", activeOwnerCount: 1 }) ?? "", /Only an owner can/);
  assert.match(staffChangeRefusal({ actor: sa, target: owner, nextActive: false, activeOwnerCount: 2 }) ?? "", /Only an owner can/);
  assert.match(staffChangeRefusal({ actor: sa, target: s("sa2", "superadmin"), nextActive: false, activeOwnerCount: 1 }) ?? "", /Only an owner can/);

  // Owner: can remove a super admin (the "if Cian leaves" case) and add owners.
  assert.equal(staffChangeRefusal({ actor: owner, target: sa, nextActive: false, activeOwnerCount: 1 }), null);
  assert.equal(staffChangeRefusal({ actor: owner, target: null, nextRole: "owner", activeOwnerCount: 1 }), null);

  // Nobody changes themselves.
  assert.match(staffChangeRefusal({ actor: owner, target: owner, nextActive: false, activeOwnerCount: 2 }) ?? "", /your own access/);

  // Never zero owners.
  assert.match(staffChangeRefusal({ actor: owner, target: owner2, nextActive: false, activeOwnerCount: 1 }) ?? "", /at least one owner/);
  assert.match(staffChangeRefusal({ actor: owner, target: owner2, nextRole: "admin", activeOwnerCount: 1 }) ?? "", /at least one owner/);
  assert.equal(staffChangeRefusal({ actor: owner, target: owner2, nextActive: false, activeOwnerCount: 2 }), null);
});

test("REQ-AUTH-013 owners and super admins may rename themselves, and change nothing else about themselves", () => {
  const owner = s("o1", "owner");
  const sa = s("sa", "superadmin");
  assert.equal(staffChangeRefusal({ actor: owner, target: owner, nameOnly: true, activeOwnerCount: 1 }), null);
  assert.equal(staffChangeRefusal({ actor: sa, target: sa, nameOnly: true, activeOwnerCount: 1 }), null);
  assert.match(staffChangeRefusal({ actor: owner, target: owner, nextActive: false, activeOwnerCount: 2 }) ?? "", /your own access/);
  assert.match(staffChangeRefusal({ actor: sa, target: sa, nextRole: "owner", activeOwnerCount: 1 }) ?? "", /your own access/);
  // Reception and therapists can't use Team at all, not even for their own name.
  assert.match(staffChangeRefusal({ actor: s("a", "admin"), target: s("a", "admin"), nameOnly: true, activeOwnerCount: 1 }) ?? "", /Only an owner or super admin/);
});
