"use client";

/**
 * Demo only: when the clinic "sends" a sign-in code, it slides in at the top
 * right like a phone notification on a Mac, clearly marked as simulated.
 * Clicking it types the code into the page's code box. The same code is in
 * the demo Inbox, exactly as the real email words it.
 */
import { useEffect, useRef, useState } from "react";
import { useDemoVersion } from "./DemoBar";
import { CODE_FIELD, fillField } from "./fill";
import { getDb } from "./server";

export function DemoNotification() {
  const v = useDemoVersion();
  const [code, setCode] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const seen = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const codes = getDb().codes;
    const latest = codes[codes.length - 1]?.code ?? null;
    // Codes already waiting when the page loads aren't news; one that appears afterwards is.
    if (seen.current !== undefined && latest && latest !== seen.current) {
      setCode(latest);
      setFilled(false);
    }
    seen.current = latest;
    // Used or replaced: the notification has done its job.
    setCode((c) => (c && !codes.some((x) => x.code === c) ? null : c));
  }, [v]);

  if (!code) return <div className="demo-notify-region" aria-live="polite" />;
  return (
    <div className="demo-notify-region" aria-live="polite">
      <div className="demo-notify">
        <button
          type="button"
          className="demo-notify-main"
          onClick={() => {
            if (fillField(CODE_FIELD, code)) setFilled(true);
          }}
        >
          <span className="demo-notify-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#fff" focusable="false">
              <path d="M12 4c-4.7 0-8.5 3.1-8.5 7 0 2.2 1.2 4.1 3.1 5.4-.2.9-.7 2-1.6 2.9 1.7-.1 3.3-.7 4.500-1.600.8.2 1.600.3 2.500.3 4.700 0 8.500-3.100 8.500-7s-3.800-7-8.500-7z" />
            </svg>
          </span>
          <span className="demo-notify-text">
            <span className="demo-notify-top">
              <span className="demo-notify-app">Messages</span>
              <span className="demo-notify-when">now</span>
            </span>
            <span className="demo-notify-from">Northbank</span>
            <span className="demo-notify-message">
              Your code is <strong className="tnum">{code}</strong>
            </span>
            <span className="demo-notify-note">{filled ? "Code filled in. Press Continue." : "Simulated for the demo. Click to fill in the code."}</span>
          </span>
        </button>
        <button type="button" className="demo-notify-close" aria-label="Dismiss notification" onClick={() => setCode(null)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
