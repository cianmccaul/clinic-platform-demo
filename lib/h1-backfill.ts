/** Demo: types only. The real module is server code that talks to the database and Cliniko. */
export type H1Row = {
  appointmentId: string;
  day: string;
  paymentIntentId: string;
  /** found: on this therapist account · clinic: an older charge on the clinic's own account, left as it is · unsure: Stripe couldn't be asked (run again) */
  result: "found" | "clinic" | "unsure" | "error";
  account?: string;
  error?: string;
};

export type H1Report = { applied: boolean; from: string; to: string; bookingsChecked: number; rows: H1Row[] };
