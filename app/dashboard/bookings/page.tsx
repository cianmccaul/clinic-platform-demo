"use client";

import BookingsAdmin from "@/components/dashboard/BookingsAdmin";
import { StaffGate } from "@/components/dashboard/staff";
import { SiteHeader } from "@/components/Brand";
import { useEffect } from "react";

export default function DashboardBookingsPage() {
  useEffect(() => {
    document.title = "Online bookings · Northbank dashboard";
  }, []);
  return (
    <StaffGate permission="bookings:view" title="Online bookings">
      {() => (
        <>
          <SiteHeader variant="staff" />
          <BookingsAdmin mode="session" />
        </>
      )}
    </StaffGate>
  );
}
