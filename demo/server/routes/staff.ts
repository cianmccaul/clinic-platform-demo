/** Staff sign-in state. In the demo you're always signed in, as an owner, so every dashboard area shows. */
import { can, guideAudiences, PERMISSIONS, ROLE_LABEL } from "@/core/roles";
import { ok, route } from "../router";

const ME = {
  signedIn: true,
  id: "staff_demo",
  name: "Demo Owner",
  email: "owner@northbank.example",
  role: "owner" as const,
  roleLabel: ROLE_LABEL.owner,
  strong: true,
  passkeySession: true,
  computer: "approved" as const,
  passkeys: 1,
  waitingDevices: [],
  timesheets: true,
  approvesDevices: true,
  limited: false,
  permissions: PERMISSIONS.filter((p) => can("owner", p)),
  ownPractitionerId: null,
  guides: guideAudiences("owner"),
};

route("GET", "/api/staff/me", () => ok(ME));
route("POST", "/api/staff/computer", () => ok({ ok: true }));
route("GET", "/api/staff/devices", () => ok({ devices: [] }));
route("GET", "/api/staff/devices/team", () => ok({ devices: [] }));
route("GET", "/api/staff/features", () => ok({ tasks: { admin: true, owner: true, superadmin: true } }));
