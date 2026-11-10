import type { ReactNode } from "react";
import { CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";

/**
 * Shared Northbank chrome and small building blocks. Purely presentational
 * (no state, no data fetching), so safe in client and server pages.
 *
 * The logo is the page's signature element wherever there is no real
 * photograph. Nothing else here decorates (docs/design.md).
 */

export type IconName =
  | "phone"
  | "check"
  | "alert"
  | "info"
  | "clock"
  | "calendar"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "external"
  | "map";

const ICON_PATHS: Record<IconName, ReactNode> = {
  phone: (
    <path d="M6.6 3.5h2.6l1.4 4-2 1.4a11.5 11.5 0 0 0 6.5 6.5l1.4-2 4 1.4v2.6a2 2 0 0 1-2.1 2A16.9 16.9 0 0 1 4.6 5.6a2 2 0 0 1 2-2.1z" />
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.8" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  map: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
};

export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export function PhoneLink({ className = "phone-link" }: { className?: string }) {
  return (
    <a className={className} href={CLINIC_TEL}>
      <Icon name="phone" />
      <span>
        <span className="visually-hidden">Call Northbank on </span>
        {CLINIC_PHONE}
      </span>
    </a>
  );
}

export function SiteHeader({ variant = "patient" }: { variant?: "patient" | "staff" }) {
  const staff = variant === "staff";
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="site-header-inner">
        <a className="site-logo" href={staff ? "/dashboard" : "/"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/northbank-wordmark.svg" alt={staff ? "Northbank dashboard" : "Northbank: book an appointment"} width={107} height={40} />
        </a>
        <div className="site-header-meta">
          {staff && <span className="staff-label">Dashboard</span>}
          <PhoneLink />
        </div>
      </div>
    </header>
  );
}

type Tone = "info" | "success" | "warning" | "error";
const TONE_ICON: Record<Tone, IconName> = { info: "info", success: "check", warning: "clock", error: "alert" };

/**
 * A status message. Colour is never the only signal: every notice has an
 * icon and a sentence. Errors and warnings are announced to screen readers.
 */
export function Notice({
  tone = "info",
  title,
  children,
  actions,
  icon,
  id,
  quiet = false,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: IconName;
  id?: string;
  /** Static content (a guide's callout): not announced as a status change. */
  quiet?: boolean;
}) {
  const live = quiet ? undefined : tone === "error" ? "alert" : tone === "warning" || tone === "success" ? "status" : undefined;
  return (
    <div id={id} className={`notice${tone === "info" ? "" : ` is-${tone}`}`} role={live}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      <div className="notice-body">
        {title && <p className="notice-title">{title}</p>}
        {children}
        {actions && <div className="notice-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function initials(firstName = "", lastName = "") {
  return `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
}

/** Real photo when Cliniko has one; initials until the photo shoot. */
export function Avatar({
  name,
  url,
  small = false,
}: {
  name: { firstName: string; lastName: string };
  url: string | null | undefined;
  small?: boolean;
}) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`avatar${small ? " avatar-sm" : ""}`} src={url} alt="" width={small ? 48 : 80} height={small ? 48 : 80} />;
  }
  return (
    <span className={`avatar-initials${small ? " avatar-sm" : ""}`} aria-hidden="true">
      {initials(name.firstName, name.lastName)}
    </span>
  );
}
