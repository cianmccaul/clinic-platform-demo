"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Notice } from "@/components/Brand";
import { DashboardShell, FaceIdTip, SignIn, StrongSignInNotice, TeamWaitingDevices, Tile, WaitingDevices, useStaff } from "@/components/dashboard/staff";

/** The dashboard home: sign in, then one tile per thing your role can do. */
export default function DashboardHome() {
  const { me, error, reload, computerError } = useStaff();

  if (error) {
    return (
      <DashboardShell title="Dashboard" narrow>
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      </DashboardShell>
    );
  }
  if (!me) return <DashboardShell title="Dashboard" narrow>{<p className="secondary">Loading…</p>}</DashboardShell>;
  if (!me.signedIn) return <SignIn onSignedIn={reload} />;

  const has = (p: string) => me.permissions.includes(p as never);
  const first = me.name.split(" ")[0];

  return (
    <DashboardShell title={`Hello ${first}`} lede={`Signed in as ${me.email} · ${me.roleLabel}`} narrow home>
      <div className="stack-5">
        {me.limited && <StrongSignInNotice me={me} onDone={reload} computerError={computerError} />}
        {me.strong && <WaitingDevices devices={me.waitingDevices} onChange={reload} />}
        {me.strong && me.approvesDevices && <TeamWaitingDevices />}
        <FaceIdTip me={me} />

        <ul className="option-list">
          <Tile href="/dashboard/help/start-here" title="Start here: how Northbank works" desc="Which system to use for what, with pictures of each screen" />
          {has("bookings:manage") && <Tile href="/dashboard/appointments" title="Appointments" desc="Find any patient, then move or cancel their appointments, however they were booked" />}
          {has("bookings:view") && <Tile href="/dashboard/bookings" title="Online bookings" desc="Who has paid, refunds, waived fees, extras and no-shows" />}
          {has("bookings:view") && <Tile href="/dashboard/waitlist" title="Waitlist" desc="Patients waiting for a time, offers sent, and offering a time by hand" />}
          {has("bookings:view") && <MachineClashesTile />}
          {has("vouchers:use") && <Tile href="/dashboard/vouchers" title="Gift vouchers" desc="Look up a voucher, use it for a treatment, send it again, and see what's outstanding" />}
          {has("bookings:view") && <Tile href="/dashboard/invoices" title="Invoices" desc="Invoices and credit notes the Hub emails to patients, and resending them" />}
          {has("bookings:view") && <Tile href="/dashboard/uninvoiced" title="Not invoiced yet" desc="Paid bookings that still need an invoice in Cliniko" />}
          {has("phone-booking") ? (
            <Tile href="/dashboard/book" title="Book a patient by phone" desc="The patient's five steps, then a payment link or their card" />
          ) : (
            has("phone-booking:own") && <Tile href="/dashboard/book" title="Book a patient in" desc="Book a patient in with you: they pay by a link, then it goes in your diary" />
          )}
          {has("phone-booking:own") && (
            <Tile
              href="/dashboard/take-payment"
              title="Payment for a past appointment"
              desc={has("phone-booking") ? "A patient pays for an appointment they've had: on the screen, or by an emailed link" : "Your patient pays for an appointment they've had: on your screen, or by an emailed link"}
            />
          )}
          {has("tasks:use") && <Tile href="/dashboard/tasks" title="Tasks" desc="Your list for the week, tasks for colleagues, repeating jobs, and the clinic tree" />}
          {has("kpis:view") && <Tile href="/dashboard/kpis" title="Clinic KPIs" desc="New and returning patients, rebooking, cancellations, no-shows and revenue, per therapist" />}
          {has("kpis:view") && <Tile href="/dashboard/therapists" title="Therapist stats" desc="Each therapist's month next to their own usual: how full, rebooking and missed visits" />}
          {has("shifts:manage") && <Tile href="/dashboard/shifts" title="Therapist shifts" desc="Alternate Saturdays, two Mondays a month and other days Cliniko can't repeat" />}
          {has("emails:edit") && <Tile href="/dashboard/emails" title="Emails" desc="The words in the emails the Hub sends patients and staff, and changing them" />}
          {has("staff:manage") && <Tile href="/dashboard/team" title="Team" desc="Add staff, change roles, switch accounts off, reset someone’s sign-in" />}
          {(me.timesheets || has("timesheets:all")) && (
            <Tile
              href="/dashboard/timesheets"
              title="Timesheets"
              desc={has("timesheets:all") ? "Clock in and out, hours worked, and everyone's timesheets for payroll" : "Clock in and out, and your hours worked"}
            />
          )}
          <Tile href="/dashboard/help" title="Help centre" desc="Step-by-step guides to the dashboard, with numbered pictures" />
          <Tile href="/dashboard/account" title="Your sign-in" desc="Your phones and computers, and optional Face ID or fingerprint" />
        </ul>

        {me.role === "therapist" && (
          <Notice title="Coming soon">
            <p>Your own bookings and payments will appear here. For now, your diary is in Cliniko and your payments are in your Stripe account.</p>
          </Notice>
        )}

        <div>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await authClient.signOut();
              reload();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}

/** Shockwave or laser booked twice at once in Cliniko (plan 30 Oct 2026, part B), with how many when there are any. */
function MachineClashesTile() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    fetch("/api/admin/machine-clashes?count=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => typeof d?.count === "number" && setCount(d.count))
      .catch(() => {});
  }, []);
  return (
    <Tile
      href="/dashboard/machine-clashes"
      title="Machine clashes, next 7 days"
      desc="Shockwave or laser appointments in Cliniko that overlap, with who to move"
      badge={count ? `${count} to fix` : undefined}
    />
  );
}
