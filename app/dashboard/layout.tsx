export const metadata = { title: "Dashboard · Northbank", robots: { index: false, follow: false } };

// Rendered per request so Next can put this request's CSP nonce on its
// scripts (core/csp.ts, middleware.ts). A prerendered copy would carry no
// nonce, and the dashboard's strict policy would block it.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
