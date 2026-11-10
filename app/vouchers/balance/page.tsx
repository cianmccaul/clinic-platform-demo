"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { CLINIC_PHONE, CLINIC_TEL } from "@/core/policy";
import { euroText, dayText } from "@/core/hub-invoice";

/**
 * "What's left on my voucher?" (gift vouchers v2). The code is all it takes, so the answer is
 * only what's on the voucher: what's left and until when. Never who bought it or who it's for.
 */
type Result =
  | { state: "active" | "used_up" | "expired" | "cancelled"; code: string; balanceMinor: number; expiresOn: string | null }
  | { state: "not_found" | "mistyped" | "off"; message?: string };

export default function VoucherBalancePage() {
  const [on, setOn] = useState<boolean | null>(null);
  const [checkoutOn, setCheckoutOn] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Check a gift voucher · Northbank";
    fetch("/api/vouchers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setOn(!!d.balanceOn);
        setCheckoutOn(!!d.checkoutOn);
      })
      .catch(() => setOn(false));
  }, []);

  async function check() {
    if (!code.trim()) {
      setError("Enter the code from the voucher.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/vouchers/balance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 429) setError(d.message ?? "Too many tries. Please wait a while, or call us.");
      else if (!res.ok && d.state !== "off") setError(d.message ?? `We couldn't look that up just now. Please try again, or call us on ${CLINIC_PHONE}.`);
      else setResult(d);
    } catch {
      setError("We couldn't look that up. Please check your connection and try again.");
    }
    setBusy(false);
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  const shell = (body: React.ReactNode) => (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        {body}
      </main>
    </>
  );
  if (on === null) return shell(<p className="secondary">Loading…</p>);
  if (!on) {
    return shell(
      <div className="stack-5">
        <div className="page-intro">
          <h1>Check a gift voucher</h1>
          <p className="lede">Call us and we&apos;ll tell you what&apos;s left on your voucher.</p>
        </div>
        <a className="btn btn-primary" href={CLINIC_TEL}>
          <Icon name="phone" /> Call {CLINIC_PHONE}
        </a>
      </div>
    );
  }

  return shell(
    <form className="stack-5" noValidate onSubmit={(e) => { e.preventDefault(); check(); }}>
      <div className="page-intro">
        <h1>Check a gift voucher</h1>
        <p className="lede">See what&apos;s left on a Northbank gift voucher and until when it can be used.</p>
      </div>
      <div className="field">
        <label htmlFor="b-code">Voucher code</label>
        <p className="field-hint" id="b-code-hint">
          It&apos;s on the voucher, like NB-7KQ4-X9TP-2HRM.
        </p>
        {error && (
          <p className="field-error" id="b-code-error">
            <Icon name="alert" />
            <span>
              <span className="visually-hidden">Error: </span>
              {error}
            </span>
          </p>
        )}
        <input
          id="b-code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={["b-code-hint", error ? "b-code-error" : ""].filter(Boolean).join(" ")}
        />
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Checking…" : "Check"}
      </button>

      <div ref={resultRef} tabIndex={-1} aria-live="polite">
        {result && <Answer r={result} checkoutOn={checkoutOn} />}
      </div>
    </form>
  );
}

function Answer({ r, checkoutOn }: { r: Result; checkoutOn: boolean }) {
  if (r.state === "not_found" || r.state === "mistyped" || r.state === "off") {
    return (
      <Notice tone="error" title={r.state === "mistyped" ? "One of the characters isn't right" : "We can't find that voucher"}>
        <p>
          {r.state === "mistyped" ? "Check the code against the voucher and try again." : "Check the code and try again."} If it still doesn&apos;t work, call us on {CLINIC_PHONE}.
        </p>
      </Notice>
    );
  }
  return <Found r={r as Extract<Result, { code: string }>} checkoutOn={checkoutOn} />;
}

function Found({ r, checkoutOn }: { r: Extract<Result, { code: string }>; checkoutOn: boolean }) {
  const until = r.expiresOn ? dayText(r.expiresOn) : null;
  if (r.state === "active") {
    return (
      <Notice tone="success" title={`${euroText(r.balanceMinor)} left on ${r.code}`}>
        <p>
          {until ? `It can be used until ${until}. ` : ""}
          {checkoutOn ? "Type the code when you pay to book online, or call us." : `To book, call us on ${CLINIC_PHONE} and quote the code.`}
        </p>
        {checkoutOn && (
          <p>
            <a className="btn btn-secondary" href="/">
              Book an appointment
            </a>
          </p>
        )}
      </Notice>
    );
  }
  const title = r.state === "used_up" ? `${r.code} has been used up` : r.state === "expired" ? `${r.code} has expired` : `${r.code} can't be used`;
  const text =
    r.state === "used_up"
      ? "There's nothing left on this voucher."
      : r.state === "expired"
        ? `It could be used until ${until}.`
        : "This voucher was cancelled.";
  return (
    <Notice title={title}>
      <p>
        {text} Questions? Call us on {CLINIC_PHONE}.
      </p>
    </Notice>
  );
}
