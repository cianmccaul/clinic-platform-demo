/**
 * Demo only: every page of the demo, for the sidebar (desktop) and the Menu
 * (phones), and the "try this" hint shown on each one.
 */
export const PORTFOLIO_URL = "https://cianmccaul.vercel.app";

export type NavItem = { href: string; label: string };
export type NavGroup = { title: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    title: "Patients",
    items: [
      { href: "/", label: "Book an appointment" },
      { href: "/manage", label: "Manage a booking" },
      { href: "/vouchers", label: "Buy a gift voucher" },
      { href: "/vouchers/balance", label: "Check a gift voucher" },
      { href: "/waitlist", label: "Join the waitlist" },
      { href: "/cancellation-policy", label: "Cancellation policy" },
      { href: "/help", label: "Help centre" },
    ],
  },
  {
    title: "Reception dashboard",
    items: [
      { href: "/dashboard", label: "Dashboard home" },
      { href: "/dashboard/appointments", label: "Patient lookup and appointments" },
      { href: "/dashboard/bookings", label: "Online bookings and refunds" },
      { href: "/dashboard/book", label: "Book a patient by phone" },
      { href: "/dashboard/take-payment", label: "Payment for a past appointment" },
      { href: "/dashboard/waitlist", label: "Waitlist board" },
      { href: "/dashboard/vouchers", label: "Gift vouchers" },
      { href: "/dashboard/invoices", label: "Invoices" },
      { href: "/dashboard/uninvoiced", label: "Not invoiced yet" },
      { href: "/dashboard/machine-clashes", label: "Machine clashes" },
    ],
  },
  {
    title: "Owners and team",
    items: [
      { href: "/dashboard/kpis", label: "Clinic KPIs" },
      { href: "/dashboard/therapists", label: "Therapist stats" },
      { href: "/dashboard/shifts", label: "Therapist shifts" },
      { href: "/dashboard/tasks", label: "Tasks" },
      { href: "/dashboard/timesheets", label: "Timesheets" },
      { href: "/dashboard/emails", label: "Emails" },
      { href: "/dashboard/team", label: "Team" },
      { href: "/dashboard/account", label: "Your sign-in" },
      { href: "/dashboard/help", label: "Staff help centre" },
    ],
  },
];

/** The nav item for this address: the longest href it starts with. */
export function currentHref(pathname: string): string | null {
  const all = NAV.flatMap((g) => g.items.map((i) => i.href));
  const hits = all.filter((h) => pathname === h || (h !== "/" && pathname.startsWith(`${h}/`)));
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

export type Hint = {
  id: string;
  /** Shown on this address and the ones under it (longest match wins). */
  path: string;
  title: string;
  text: string;
  /** One tap fills a field on the page with ready demo data. Shown only while that field is on screen. */
  fills?: { label: string; selector: string; value: string; submit?: boolean }[];
  next?: { label: string; href: string };
};

export const DEMO_EMAIL = "jack.murphy@example.com";
export const RETURNING_EMAIL = "hannah.lynch@example.com";

export const HINTS: Hint[] = [
  {
    id: "book", path: "/", title: "Try booking an appointment",
    text: "Open Physiotherapy, then Return Patient, and pick a time. On Your details, choose \"Use my details on file\" to skip the form as a returning patient.",
    fills: [
      { label: `Use ${RETURNING_EMAIL}`, selector: "#returning-email", value: RETURNING_EMAIL },
      { label: `Use ${DEMO_EMAIL}`, selector: "#returning-email", value: DEMO_EMAIL },
    ],
    next: { label: "Try managing a booking", href: "/manage" },
  },
  {
    id: "checkout", path: "/demo-checkout", title: "Try breaking it on purpose",
    text: "Pick \"Someone takes the time while I pay\": the payment is kept and you get a link to choose another time. Nobody is ever left paid but not booked.",
  },
  {
    id: "manage", path: "/manage", title: "Try it as Jack",
    text: "Jack has upcoming bookings to move or cancel, and past payments. His sign-in code arrives as a simulated notification, top right: click it to fill the code in.",
    fills: [{ label: `Use ${DEMO_EMAIL}`, selector: "#manage-email", value: DEMO_EMAIL }],
    next: { label: "Try buying a gift voucher", href: "/vouchers" },
  },
  {
    id: "voucher-buy", path: "/vouchers", title: "Try buying a gift voucher",
    text: "Pay on the pretend card page. The voucher's code arrives in the Inbox; type it on the Pay step of a booking to use it.",
    next: { label: "Try checking a voucher", href: "/vouchers/balance" },
  },
  {
    id: "voucher-balance", path: "/vouchers/balance", title: "Try checking a voucher",
    text: "This sample voucher was bought for €100 and part used at the desk.",
    fills: [{ label: "Use a sample code", selector: "#b-code", value: "{voucher}" }],
    next: { label: "Try the reception dashboard", href: "/dashboard" },
  },
  {
    id: "waitlist", path: "/waitlist", title: "Try joining the waitlist",
    text: "Texts are switched on: give an Irish mobile like 087 123 4567 and the confirmation arrives as a text in the Inbox. Offers are sent the same way.",
    next: { label: "See reception's waitlist board", href: "/dashboard/waitlist" },
  },
  {
    id: "dashboard", path: "/dashboard", title: "You're signed in as an owner",
    text: "Every area is open. A good first stop is finding a patient and seeing everything about their appointments.",
    next: { label: "Try looking up a patient", href: "/dashboard/appointments" },
  },
  {
    id: "lookup", path: "/dashboard/appointments", title: "Try looking up a patient",
    text: "Search by surname, full name or date of birth, then move or cancel any of their appointments, however they were booked.",
    fills: [
      { label: "Search for Murphy", selector: "#appt-q", value: "Murphy", submit: true },
      { label: "Search by date of birth", selector: "#appt-q", value: "17/04/1991", submit: true },
    ],
    next: { label: "Try booking a patient by phone", href: "/dashboard/book" },
  },
  {
    id: "phone", path: "/dashboard/book", title: "Try a phone booking",
    text: "Look the caller up first: their details are filled in for you. At the end, send the payment link by text or email (both land in the Inbox), or charge their saved card.",
    fills: [
      { label: "Look up Hannah Lynch", selector: "#patient-lookup", value: "Hannah Lynch" },
      { label: "Look up Murphy", selector: "#patient-lookup", value: "Murphy" },
    ],
    next: { label: "See online bookings and refunds", href: "/dashboard/bookings" },
  },
  {
    id: "bookings", path: "/dashboard/bookings", title: "Try a refund",
    text: "Pick a day to see who has paid. Refund, waive a late fee or charge an agreed extra: a refund can never be more than was paid.",
    next: { label: "Try the gift vouchers page", href: "/dashboard/vouchers" },
  },
  {
    id: "dash-vouchers", path: "/dashboard/vouchers", title: "Try using a voucher at the desk",
    text: "Look a code up, then press \"Use for a treatment\". Every use is a line on the voucher's ledger and can be undone.",
    fills: [{ label: "Look up a sample code", selector: "#v-code", value: "{voucher}", submit: true }],
    next: { label: "See the clinic KPIs", href: "/dashboard/kpis" },
  },
  {
    id: "dash-waitlist", path: "/dashboard/waitlist", title: "Try offering a time",
    text: "Press \"Look for times now\", or offer a time by hand. The offer goes out by text and holds the time for two hours.",
    next: { label: "Open the help centre", href: "/dashboard/help" },
  },
  {
    id: "help", path: "/help", title: "Step-by-step guides",
    text: "Every screenshot in these guides was captured from this demo and annotated with numbered callouts.",
    next: { label: "See the staff help centre", href: "/dashboard/help" },
  },
  {
    id: "staff-help", path: "/dashboard/help", title: "Guides for staff",
    text: "What reception and owners read on their first day. Each step has an annotated screenshot of this demo.",
    next: { label: "Back to booking", href: "/" },
  },
];

export function hintFor(pathname: string): Hint | null {
  const hits = HINTS.filter((h) => pathname === h.path || (h.path !== "/" && pathname.startsWith(`${h.path}/`)));
  return hits.sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}
