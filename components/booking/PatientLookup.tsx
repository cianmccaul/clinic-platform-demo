"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import { MIN_QUERY_LENGTH, type LookupPrefill, type LookupResult, type VisitSummary } from "@/core/patient-lookup";
import type { PatientKind } from "@/core/patient-kind";

/**
 * "Find a patient" at the top of Book a patient by phone (the answering service,
 * 30 Oct 2026): search Cliniko by surname, full name, email or date of
 * birth without leaving the booking. Picking someone fills the details from
 * their record and the booking is made on it (no duplicate). Reception and
 * owners only; the server checks again and logs every look-up
 * (/api/admin/patient-lookup).
 */

export type ChosenPatient = {
  id: string;
  name: string;
  prefill: LookupPrefill;
  last: VisitSummary | null;
  suggestedKind: PatientKind | null;
};

type SearchAnswer = { results: LookupResult[]; more: boolean; notSearchable?: string; error?: string };

const DEBOUNCE_MS = 500;
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IE", opts);
const visitDate = (iso: string) => fmt({ day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" }).format(new Date(iso));
const dobText = (d: string) => fmt({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
export const visitLine = (v: VisitSummary) => [visitDate(v.startsAtISO), v.appointmentTypeName, v.practitionerName].filter(Boolean).join(" · ");

export default function PatientLookup({ onChoose }: { onChoose: (p: ChosenPatient) => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Same search again on this page: answered from here, not Cliniko.
  const cache = useRef(new Map<string, SearchAnswer>());

  useEffect(() => {
    const term = q.trim().replace(/\s+/g, " ");
    setError(null);
    if (term.length < MIN_QUERY_LENGTH) {
      setAnswer(null);
      setSearching(false);
      return;
    }
    const key = term.toLowerCase();
    const hit = cache.current.get(key);
    if (hit) {
      setAnswer(hit);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/patient-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "search", q: term }) });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? "Couldn't search Cliniko just now. Try again, or look them up in Cliniko.");
        else {
          const a: SearchAnswer = { results: data.results ?? [], more: !!data.more, notSearchable: data.notSearchable };
          cache.current.set(key, a);
          setAnswer(a);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the Hub. Check the connection and try again.");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  async function choose(r: LookupResult) {
    setOpening(r.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/patient-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", id: r.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.patient) return setError(data.error ?? "Couldn't open their record just now. Try again, or type their details in.");
      onChoose({ id: r.id, name: r.name, prefill: data.patient, last: data.last ?? null, suggestedKind: data.suggestedKind ?? null });
    } catch {
      setError("Couldn't reach the Hub. Check the connection and try again.");
    } finally {
      setOpening(null);
    }
  }

  const results = answer?.results ?? [];
  return (
    <section className="stack-3" aria-labelledby="patient-lookup-label">
      <div className="field">
        <label id="patient-lookup-label" htmlFor="patient-lookup">
          Find a patient in Cliniko
        </label>
        <p className="field-hint" id="patient-lookup-hint">
          Surname, full name, email or date of birth (like 2/4/1958). Been here before? Pick them and their details are filled in.
        </p>
        <input id="patient-lookup" type="search" autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} aria-describedby="patient-lookup-hint" />
      </div>
      <div aria-live="polite" className="stack-3">
        {searching && <p className="secondary">Searching Cliniko…</p>}
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {!searching && answer?.notSearchable && (
          <Notice tone="warning">
            <p>{answer.notSearchable}</p>
          </Notice>
        )}
        {!searching && answer && !answer.notSearchable && !results.length && <p className="secondary">No patients found. Check the spelling, try their date of birth, or book them as a new patient.</p>}
        {!searching && results.length > 0 && (
          <ul className="option-list" aria-label="Patients found">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className="option" onClick={() => choose(r)} disabled={!!opening}>
                  <span className="option-main">
                    <span className="option-title">
                      {r.name}
                      {r.dateOfBirth && <span className="secondary"> · born {dobText(r.dateOfBirth)}</span>}
                    </span>
                    <span className="option-facts">{r.last ? `Last: ${visitLine(r.last)}` : "No past appointments"}</span>
                    {r.next && <span className="option-facts">Next: {visitLine(r.next)}</span>}
                  </span>
                  <span className="secondary">{opening === r.id ? "Opening…" : "Choose"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!searching && answer?.more && <p className="secondary">More patients match. Add their first name or date of birth to narrow it down.</p>}
      </div>
    </section>
  );
}
