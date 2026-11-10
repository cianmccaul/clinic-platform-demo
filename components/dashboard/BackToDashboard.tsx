import { Icon } from "@/components/Brand";

/**
 * A plain way home on every dashboard page, not just the logo (Cian, 27 Oct 2026). Pages with
 * their own layout (Online bookings, a guide, booking by phone) must draw it too, or it shows
 * while the page loads and then vanishes (28 Oct). Its own small file, so the patient booking
 * flow can use it without loading the dashboard's sign-in code.
 */
export function BackToDashboard() {
  return (
    <a className="btn btn-secondary back-to-dashboard" href="/dashboard">
      <Icon name="chevron-left" /> Back to dashboard
    </a>
  );
}
