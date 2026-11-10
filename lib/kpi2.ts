/** Demo: types only. The real module is server code that talks to the database and Cliniko. */
import type { KpiReport } from "@/core/kpi2-report";

export type KpiPayload = KpiReport & { practitioners: Record<string, string>; target: { month: string; set: boolean } };
