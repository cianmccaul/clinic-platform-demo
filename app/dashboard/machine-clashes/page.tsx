"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { formatDublin } from "@/core/policy";

/**
 * Machine clashes, next 7 days (plan 30 Oct 2026, part B): shockwave or
 * laser appointments in Cliniko that overlap, so two therapists would need
 * the one machine at once. The Hub stops this for its own bookings; this
 * catches ones made in Cliniko. Reception moves one of them in Cliniko and
 * the clash drops off the list by itself.
 */
export default function MachineClashesPage() {
  return (
    <StaffGate permission="bookings:view" title="Machine clashes">
      {() => <MachineClashes />}
    </StaffGate>
  );
}

type Appt = { id: string; patientName: string; practitionerName: string; treatment: string; startsAtISO: string; endsAtISO: string; clinikoUrl: string | null };
type Clash = { machine: string; startsAtISO: string; endsAtISO: string; appointments: Appt[] };
type Data = { from: string; to: string; clashes: Clash[] };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" });

function MachineClashes() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/machine-clashes", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the list.");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DashboardShell
      title="Machine clashes"
      lede="Shockwave or laser appointments in the next 7 days that overlap in Cliniko. There is one of each machine, so only one therapist can use it at a time."
    >
      <div className="stack-5">
        <Notice title="For each clash">
          <ol>
            <li>
              Press <strong>Open in Cliniko</strong> and find the appointment in the diary.
            </li>
            <li>Move one of them to a time the machine is free, or change the treatment if the machine isn&apos;t needed. Check with the therapists first.</li>
            <li>Press Check again: the clash drops off this list once it&apos;s fixed in Cliniko.</li>
          </ol>
        </Notice>

        <div className="row-actions">
          <button className="btn btn-secondary" disabled={loading} onClick={load}>
            {loading ? "Checking Cliniko…" : "Check again"}
          </button>
        </div>

        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {data && !loading && data.clashes.length === 0 && !error && <p className="secondary">No machine clashes in the next 7 days. Nothing to do.</p>}

        {data?.clashes.map((c) => (
          <section key={`${c.machine}:${c.startsAtISO}`} className="panel">
            <h2 className="panel-title">
              {c.machine}, {formatDublin(c.startsAtISO)}
            </h2>
            <p className="panel-meta">
              {c.appointments.length} appointments need the {c.machine.toLowerCase()} between {time(c.startsAtISO)} and {time(c.endsAtISO)}.
            </p>
            <div className="stack-4">
              {c.appointments.map((a) => (
                <div key={a.id} className="stack-2">
                  <p>
                    <strong>{a.patientName}</strong> with {a.practitionerName}, {time(a.startsAtISO)} to {time(a.endsAtISO)}
                  </p>
                  <p className="secondary">{a.treatment}</p>
                  {a.clinikoUrl && (
                    <div className="row-actions">
                      <a className="btn btn-secondary" href={a.clinikoUrl} target="_blank" rel="noopener noreferrer">
                        Open in Cliniko
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DashboardShell>
  );
}
