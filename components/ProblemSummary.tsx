"use client";

import { forwardRef } from "react";
import { Icon } from "@/components/Brand";

/**
 * "There is a problem" box for a form, like the booking flow's (components/booking/Steps.tsx):
 * each problem links to its field. Give it a ref and focus it when Pay / Join is pressed with
 * something missing, so the person sees (and a screen reader hears) why nothing happened.
 */
export type Problem = { id: string; text: string };

export const ProblemSummary = forwardRef<HTMLDivElement, { problems: Problem[] }>(function ProblemSummary({ problems }, ref) {
  if (!problems.length) return null;
  return (
    <div className="error-summary" ref={ref} tabIndex={-1} role="alert" aria-labelledby="problem-summary-title">
      <h2 id="problem-summary-title">
        <Icon name="alert" /> There is a problem
      </h2>
      <ul>
        {problems.map((p) => (
          <li key={p.id}>
            <a
              href={`#${p.id}`}
              onClick={(e) => {
                const el = document.getElementById(p.id);
                if (!el) return;
                e.preventDefault();
                el.scrollIntoView({ block: "center" });
                el.focus({ preventScroll: true });
              }}
            >
              {p.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});

/** Focus and show the summary once it has rendered. */
export function focusSoon(el: () => HTMLElement | null) {
  requestAnimationFrame(() => {
    const target = el();
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: "auto" });
    target.focus({ preventScroll: true });
  });
}
