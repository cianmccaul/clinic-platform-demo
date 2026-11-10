"use client";

import BookingFlow from "@/components/booking/BookingFlow";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate, StrongSignInNotice, useStaff } from "@/components/dashboard/staff";

/**
 * Book a patient by phone, signed in as yourself. Reception and owners book
 * with anyone; a therapist books patients in with themselves only, by payment
 * link (decision 16 Oct 2026). The server checks both again.
 */
export default function DashboardPhoneBookingPage() {
  const { reload, computerError } = useStaff();
  return (
    <StaffGate permission="phone-booking:own" title="Book a patient in">
      {(me) => {
        const anyone = me.permissions.includes("phone-booking");
        if (anyone) return <BookingFlow reception={{ adminKey: "", userId: me.id }} />;
        if (!me.strong) {
          return (
            <DashboardShell title="Book a patient in" narrow>
              <StrongSignInNotice me={me} onDone={reload} computerError={computerError} />
            </DashboardShell>
          );
        }
        if (!me.ownPractitionerId) {
          return (
            <DashboardShell title="Book a patient in" narrow>
              <Notice title="Your account isn't linked to your diary yet" actions={<a className="btn btn-secondary" href="/dashboard">Back to the dashboard</a>}>
                <p>Ask an owner to link your account to your Cliniko diary on Team. Until then, book patients in Cliniko.</p>
              </Notice>
            </DashboardShell>
          );
        }
        return <BookingFlow reception={{ adminKey: "", practitionerId: me.ownPractitionerId, userId: me.id }} />;
      }}
    </StaffGate>
  );
}
