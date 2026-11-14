"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Icon, Notice } from "@/components/Brand";
import { CLINIC_EMAIL, CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import type { MenuBranch, MenuNode } from "@/core/booking-menu";
import { StepHead, UnavailableNotice } from "@/components/booking/Steps";
import type { AppointmentType } from "@/components/booking/types";

/**
 * Step 1 as dropdowns. Tapping a card opens its
 * options directly underneath it, in place; the other cards stay where they
 * are. One card open per level: opening another closes the first, and
 * tapping an open card closes it. The tree is core/booking-menu.ts.
 * Presentational: BookingFlow keeps which cards are open (`path`, and
 * browser Back/Forward).
 */
type Props = {
  root: MenuBranch<AppointmentType>;
  hasTypes: boolean;
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  /** The open cards, from the top level down (keys). */
  path: string[];
  /** Open (node given) or close (node null) a card: the new open path. */
  onOpen: (path: string[], node: MenuNode<AppointmentType> | null) => void;
  /** An appointment: the path to it (the last key is the appointment). */
  onChoose: (t: AppointmentType, path: string[]) => void;
  headingRef: RefObject<HTMLHeadingElement>;
};

export function TreatmentMenu({ root, hasTypes, loading, failed, selectedId, path, onOpen, onChoose, headingRef }: Props) {
  const ready = !loading && !failed && hasTypes;
  const listRef = useRef<HTMLDivElement>(null);
  const tapped = useRef<string | null>(null);

  // Opening a card can close one above it and shift the page: keep the tapped card in view.
  useEffect(() => {
    const key = tapped.current;
    tapped.current = null;
    if (!key) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-menu-path="${key}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 80 || top > window.innerHeight * 0.6) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    }
  }, [path]);

  const toggle = (depth: number, c: MenuNode<AppointmentType>) => {
    const isOpen = path[depth] === c.key;
    const next = isOpen ? path.slice(0, depth) : [...path.slice(0, depth), c.key];
    tapped.current = [...path.slice(0, depth), c.key].join("/");
    onOpen(next, isOpen ? null : c);
  };

  // A plain function, not a component, so the cards aren't remounted on every tap (keeps keyboard focus).
  function level(node: MenuBranch<AppointmentType>, depth: number) {
    const here = path.slice(0, depth);
    return (
      <ul className="option-list">
        {node.children.map((c) => {
          const key = [...here, c.key].join("/");
          if (c.kind === "link")
            return (
              <li key={c.key}>
                <a className="option" href={c.href}>
                  <span className="option-main">
                    <span className="option-title">{c.label}</span>
                    <span className="option-facts">{c.detail}</span>
                  </span>
                  <Icon name="external" className="option-chevron" />
                </a>
              </li>
            );
          if (c.kind === "type")
            return (
              <li key={c.key}>
                <button type="button" className="option" data-menu-path={key} aria-pressed={selectedId === c.type.id} onClick={() => onChoose(c.type, [...here, c.key])}>
                  <span className="option-main">
                    <span className="option-title">{c.label}</span>
                    <span className="option-facts">{c.detail}</span>
                    {c.type.notOnline && <span className="badge">Phone only: not bookable online</span>}
                  </span>
                  <Icon name="chevron-right" className="option-chevron" />
                </button>
              </li>
            );
          const open = path[depth] === c.key;
          const panelId = `menu-${key.replace(/[^a-z0-9-]/g, "-")}`;
          return (
            <li key={c.key}>
              <button
                type="button"
                className="option dropdown"
                data-menu-path={key}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(depth, c)}
              >
                <span className="option-main">
                  <span className="option-title">{c.label}</span>
                  {c.detail && <span className="option-facts">{c.detail}</span>}
                </span>
                <Icon name="chevron-down" className="option-chevron dropdown-chevron" />
              </button>
              {open && (
                <div className="dropdown-panel" id={panelId}>
                  {level(c, depth + 1)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section>
      <StepHead step={1} title="Choose a treatment" headingRef={headingRef}>
        <p className="lede">Tap a treatment to see its appointments. You pay the full fee when you book, so there&rsquo;s nothing to pay at the clinic.</p>
      </StepHead>

      {loading && (
        <div className="skeleton" aria-busy="true" aria-label="Loading treatments">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}

      {!loading && failed && <UnavailableNotice />}

      {!loading && !failed && !hasTypes && (
        <Notice title="No treatments can be booked online at the moment">
          <p>
            Please call us on <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> and reception will book you in.
          </p>
        </Notice>
      )}

      {ready && (
        <>
          <div ref={listRef}>
            {level(root, 0)}
          </div>

          <p className="not-sure">
            Not sure? Start with a physio assessment, or <a href={CLINIC_TEL}>call us on {CLINIC_PHONE}</a>.
          </p>

          {/* Room Rentals: for therapists, booked through reception (core/areas.ts). */}
          {path.length === 0 && (
            <div className="therapist-note">
              <p className="therapist-note-title">Renting a room? For therapists only</p>
              <p>
                Treatment rooms are available by the hour, half day or full day. Call <a href={CLINIC_TEL}>{CLINIC_PHONE}</a> or email{" "}
                <a href={`mailto:${CLINIC_EMAIL}?subject=Room%20rental`}>{CLINIC_EMAIL}</a> and reception will book it.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
