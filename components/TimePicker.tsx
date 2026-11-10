"use client";

import { useEffect, useState } from "react";
import { dublinDay } from "@/core/policy";
import { dayLong, timeShort } from "@/core/format";
import { Notice } from "@/components/Brand";

/**
 * Free times for one therapist and treatment, three weeks at a time, as
 * buttons grouped by day (same look as "Change time" on /manage). Used to
 * pick a new time on an existing payment (/rebook) and on the dashboard's
 * Appointments page (move an appointment).
 */
export function TimePicker(props: {
  businessId: string;
  practitionerId: string;
  appointmentTypeId: string;
  /** Moving an appointment: it doesn't block its own machine. */
  excludeAppointmentId?: string;
  /** Leave out times sooner than this many hours from now. */
  minLeadHours?: number;
  value: string | null;
  onChange: (iso: string) => void;
  emptyText?: string;
}) {
  const [weeks, setWeeks] = useState(3);
  const [times, setTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError(null);
    const today = Date.now();
    const chunks = Array.from({ length: weeks }, (_, i) => i * 7).map((d) => ({
      from: dublinDay(new Date(today + d * 86400000).toISOString()),
      to: dublinDay(new Date(today + (d + 6) * 86400000).toISOString()),
    }));
    const q = (from: string, to: string) =>
      `/api/available-times?businessId=${props.businessId}&practitionerId=${props.practitionerId}&appointmentTypeId=${props.appointmentTypeId}&from=${from}&to=${to}` +
      (props.excludeAppointmentId ? `&excludeAppointmentId=${props.excludeAppointmentId}` : "");
    Promise.all(chunks.map(({ from, to }) => fetch(q(from, to), { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))))
      .then((results) => {
        if (stopped) return;
        const minStart = Date.now() + (props.minLeadHours ?? 0) * 3_600_000;
        const merged = [...new Set(results.flatMap((d) => (d.availableTimes ?? []).map((t: any) => t.appointment_start as string)))]
          .filter((t) => new Date(t).getTime() > minStart)
          .sort();
        setTimes(merged);
      })
      .catch(() => !stopped && setError("We couldn't load the free times. Please try again."))
      .finally(() => !stopped && setLoading(false));
    return () => {
      stopped = true;
    };
  }, [props.businessId, props.practitionerId, props.appointmentTypeId, props.excludeAppointmentId, props.minLeadHours, weeks]);

  const byDay = new Map<string, string[]>();
  for (const t of times) byDay.set(dublinDay(t), [...(byDay.get(dublinDay(t)) ?? []), t]);

  if (error) return <Notice tone="error" title="Couldn't load times"><p>{error}</p></Notice>;
  return (
    <div className="stack-4">
      {loading && (
        <div className="skeleton-slots" aria-busy="true" aria-label="Checking times">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton-row is-short" />
          ))}
        </div>
      )}
      {!loading && times.length === 0 && (
        <Notice title={`No free times in the next ${weeks} weeks`}>
          <p>{props.emptyText ?? "Try further ahead."}</p>
        </Notice>
      )}
      {!loading &&
        [...byDay.entries()].map(([day, list]) => (
          <div className="slot-group" key={day}>
            <h3>{dayLong(list[0])}</h3>
            <ul className="slot-grid">
              {list.map((t) => (
                <li key={t}>
                  <button type="button" className="slot" aria-pressed={props.value === t} onClick={() => props.onChange(t)}>
                    {timeShort(t)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      {!loading && weeks < 12 && (
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => setWeeks((w) => w + 3)}>
            Show 3 more weeks
          </button>
        </div>
      )}
    </div>
  );
}
