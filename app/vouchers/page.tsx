"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Notice, SiteHeader } from "@/components/Brand";
import { ProblemSummary, focusSoon, type Problem } from "@/components/ProblemSummary";
import { CLINIC_PHONE, CLINIC_TEL, PRIVACY_URL } from "@/core/policy";
import { MARKETING_OPT_IN_HINT, MARKETING_OPT_IN_LABEL } from "@/core/mailerlite";
import { MAX_MESSAGE, coversExamples } from "@/core/vouchers";
import { euroText } from "@/core/hub-invoice";

/**
 * Buy a gift voucher (plan-2026-10-28-gift-vouchers). A euro amount, who it's
 * for, an optional message, the buyer's details; then Stripe's card page. The
 * voucher (code + PDF) is emailed within a minute of paying: to the buyer, or
 * straight to the person it's for with a copy to the buyer.
 */
type Config = { on: boolean; suggestedEUR: number[]; minEUR: number; maxEUR: number; years: number; maxSendAheadDays?: number };
type TypeRow = { name: string; fullPriceEUR: number | null };

export default function VouchersPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [cancelled, setCancelled] = useState(false);

  const [preset, setPreset] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [sendTo, setSendTo] = useState<"me" | "them" | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  // Scheduled send (v2): straight away, or on a day they choose (e.g. Christmas morning).
  const [sendWhen, setSendWhen] = useState<"now" | "date">("now");
  const [sendOn, setSendOn] = useState("");
  const [message, setMessage] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [marketing, setMarketing] = useState(false);

  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Gift vouchers · Northbank";
    setCancelled(new URLSearchParams(window.location.search).get("cancelled") === "1");
    fetch("/api/vouchers", { cache: "no-store" })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setLoadError(true));
    // Live prices, only to say what an amount covers. Not needed to buy.
    fetch("/api/appointment-types")
      .then((r) => r.json())
      .then((d) => setTypes(d.appointmentTypes ?? []))
      .catch(() => {});
  }, []);

  const otherEUR = other.trim() === "" ? null : Number(other.trim().replace(/^€/, ""));
  const amountEUR = preset ?? otherEUR;
  const amountOk = config && amountEUR != null && Number.isInteger(amountEUR) && amountEUR >= config.minEUR && amountEUR <= config.maxEUR;
  const covers = useMemo(() => (amountOk ? coversExamples(amountEUR! * 100, types) : []), [amountOk, amountEUR, types]);
  const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());
  const todayDay = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), []);
  const lastSendDay = useMemo(() => new Date(Date.parse(`${todayDay}T12:00:00Z`) + (config?.maxSendAheadDays ?? 90) * 86_400_000).toISOString().slice(0, 10), [todayDay, config]);

  const problems = {
    amount: !amountOk,
    sendTo: !sendTo,
    recipientName: sendTo === "them" && !recipientName.trim(),
    recipientEmail: sendTo === "them" && !isEmail(recipientEmail),
    sendOn: sendTo === "them" && sendWhen === "date" && !(sendOn >= todayDay && sendOn <= lastSendDay),
    message: message.length > MAX_MESSAGE,
    buyerName: !buyerName.trim(),
    buyerEmail: !isEmail(buyerEmail),
  };
  const invalid = Object.values(problems).some(Boolean);
  const amountText = config ? `Choose an amount, or enter a whole euro amount from €${config.minEUR} to €${config.maxEUR}` : "Choose an amount";
  const problemList: Problem[] = [
    ...(problems.amount ? [{ id: "v-amount", text: amountText }] : []),
    ...(problems.sendTo ? [{ id: "v-send-me", text: "Choose who we email the voucher to" }] : []),
    ...(problems.recipientName ? [{ id: "v-rname", text: "Enter the name of the person it's for" }] : []),
    ...(problems.recipientEmail ? [{ id: "v-remail", text: "Enter the email of the person it's for" }] : []),
    ...(problems.sendOn ? [{ id: "v-sendon", text: "Choose the day to send it" }] : []),
    ...(problems.message ? [{ id: "v-message", text: `Keep the message under ${MAX_MESSAGE} characters` }] : []),
    ...(problems.buyerName ? [{ id: "v-bname", text: "Enter your name" }] : []),
    ...(problems.buyerEmail ? [{ id: "v-bemail", text: "Enter a valid email address" }] : []),
  ];
  const described = (cond: boolean, id: string) => (showErrors && cond ? id : undefined);
  const err = (cond: boolean, text: string, id: string) =>
    showErrors && cond ? (
      <p className="field-error" id={id}>
        <Icon name="alert" />
        <span>
          <span className="visually-hidden">Error: </span>
          {text}
        </span>
      </p>
    ) : null;

  async function pay() {
    setShowErrors(true);
    setError(null);
    if (invalid) {
      focusSoon(() => summaryRef.current);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/vouchers/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountEUR,
          buyer: { name: buyerName.trim(), email: buyerEmail.trim() },
          sendTo,
          recipient: { name: recipientName.trim() || undefined, email: sendTo === "them" ? recipientEmail.trim() : undefined },
          ...(sendTo === "them" && sendWhen === "date" && sendOn ? { sendOn } : {}),
          message: message.trim() || undefined,
          marketingOptIn: marketing,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.url) {
        window.location.href = d.url;
        return;
      }
      setError(d.error ?? d.message ?? `We couldn't open the payment page. Please call us on ${CLINIC_PHONE}.`);
    } catch {
      setError("We couldn't open the payment page. Please check your connection and try again.");
    }
    setBusy(false);
  }

  const shell = (body: React.ReactNode) => (
    <>
      <SiteHeader />
      <main id="main" className="page page-narrow">
        {body}
      </main>
    </>
  );

  if (loadError) {
    return shell(
      <Notice tone="error" title="We couldn't load this page" actions={<a className="btn btn-secondary" href={CLINIC_TEL}><Icon name="phone" /> Call {CLINIC_PHONE}</a>}>
        <p>Please try again in a minute, or call us.</p>
      </Notice>
    );
  }
  if (!config) return shell(<p className="secondary">Loading…</p>);
  if (!config.on) {
    return shell(
      <div className="stack-5">
        <div className="page-intro">
          <h1>Gift vouchers</h1>
          <p className="lede">We no longer sell gift vouchers. If you have one, call us or call in to the clinic and we&apos;ll book you in and use it for your treatment.</p>
        </div>
        <a className="btn btn-primary" href={CLINIC_TEL}>
          <Icon name="phone" /> Call {CLINIC_PHONE}
        </a>
      </div>
    );
  }

  return shell(
    <form className="stack-5" noValidate onSubmit={(e) => { e.preventDefault(); pay(); }}>
      <div className="page-intro">
        <h1>Gift vouchers</h1>
        <p className="lede">
          Give someone a treatment at Northbank. The voucher arrives by email within a minute, as a PDF ready to print. It lasts {config.years} years and can be used in one visit or several.
        </p>
        <p className="secondary">
          Already have one? <a href="/vouchers/balance">Check what&apos;s left on it</a>.
        </p>
      </div>

      {cancelled && (
        <Notice title="Payment cancelled">
          <p>Nothing has been charged. You can try again below.</p>
        </Notice>
      )}

      {showErrors && <ProblemSummary ref={summaryRef} problems={problemList} />}

      <fieldset className="field">
        <legend className="label">Amount</legend>
        {err(problems.amount, amountText, "amount-error")}
        <div className="kind-buttons" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(6.5rem, 1fr))" }}>
          {config.suggestedEUR.map((a, i) => (
            <button
              key={a}
              id={i === 0 ? "v-amount" : undefined}
              type="button"
              className="option kind-option"
              aria-pressed={preset === a}
              aria-describedby={i === 0 ? described(problems.amount, "amount-error") : undefined}
              onClick={() => {
                setPreset(a);
                setOther("");
              }}
            >
              <span className="option-title tnum">€{a}</span>
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: "var(--space-4)" }}>
          <label htmlFor="v-other">Or another amount (€)</label>
          <p className="field-hint" id="v-other-hint">
            Whole euros, €{config.minEUR} to €{config.maxEUR}.
          </p>
          <input
            id="v-other"
            inputMode="numeric"
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              setPreset(null);
            }}
            aria-invalid={(showErrors && problems.amount && preset == null) || undefined}
            aria-describedby={["v-other-hint", preset == null ? described(problems.amount, "amount-error") : undefined].filter(Boolean).join(" ")}
          />
        </div>
        {covers.length > 0 && (
          <p className="secondary" aria-live="polite">
            {euroText(amountEUR! * 100)} covers, for example: {covers.map((c) => `${c.name} (${euroText(c.priceMinor)})`).join(", ")}. It can go towards any treatment.
          </p>
        )}
      </fieldset>

      <fieldset className="field">
        <legend className="label">Who should we email the voucher to?</legend>
        {err(problems.sendTo, "Choose one", "send-error")}
        <label className="checkbox">
          <input id="v-send-me" type="radio" name="sendTo" checked={sendTo === "me"} onChange={() => setSendTo("me")} aria-describedby={described(problems.sendTo, "send-error")} />
          <span>To me, so I can print it or pass it on</span>
        </label>
        <label className="checkbox">
          <input type="radio" name="sendTo" checked={sendTo === "them"} onChange={() => setSendTo("them")} />
          <span>Straight to the person it&apos;s for (you get a copy)</span>
        </label>
      </fieldset>

      {sendTo && (
        <>
          <div className="field">
            <label htmlFor="v-rname">{sendTo === "them" ? "Their name" : "Their name (optional)"}</label>
            <p className="field-hint" id="v-rname-hint">
              Printed on the voucher: &quot;For …&quot;.
            </p>
            {err(problems.recipientName, "Enter the name of the person it's for", "rname-error")}
            <input id="v-rname" autoComplete="off" value={recipientName} maxLength={80} onChange={(e) => setRecipientName(e.target.value)} aria-invalid={(showErrors && problems.recipientName) || undefined} aria-describedby={["v-rname-hint", described(problems.recipientName, "rname-error")].filter(Boolean).join(" ")} />
          </div>
          {sendTo === "them" && (
            <div className="field">
              <label htmlFor="v-remail">Their email</label>
              {err(problems.recipientEmail, "Enter the email of the person it's for", "remail-error")}
              <input id="v-remail" type="email" inputMode="email" autoComplete="off" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} aria-invalid={(showErrors && problems.recipientEmail) || undefined} aria-describedby={described(problems.recipientEmail, "remail-error")} />
            </div>
          )}
          {sendTo === "them" && (
            <fieldset className="field">
              <legend className="label">When should they get it?</legend>
              <label className="checkbox">
                <input type="radio" name="sendWhen" checked={sendWhen === "now"} onChange={() => setSendWhen("now")} />
                <span>Straight away</span>
              </label>
              <label className="checkbox">
                <input type="radio" name="sendWhen" checked={sendWhen === "date"} onChange={() => setSendWhen("date")} />
                <span>On a day I choose (we send it that morning)</span>
              </label>
              {sendWhen === "date" && (
                <div className="field">
                  <label htmlFor="v-sendon">Day to send it</label>
                  <p className="field-hint" id="v-sendon-hint">
                    You get your copy straight away. We email it to them from 8am that day.
                  </p>
                  {err(problems.sendOn, "Choose the day to send it", "sendon-error")}
                  <input id="v-sendon" type="date" min={todayDay} max={lastSendDay} value={sendOn} onChange={(e) => setSendOn(e.target.value)} aria-invalid={(showErrors && problems.sendOn) || undefined} aria-describedby={["v-sendon-hint", described(problems.sendOn, "sendon-error")].filter(Boolean).join(" ")} />
                </div>
              )}
            </fieldset>
          )}
        </>
      )}

      <div className="field">
        <label htmlFor="v-message">Message (optional)</label>
        <p className="field-hint" id="v-message-hint">
          Printed on the voucher. {Math.max(0, MAX_MESSAGE - message.length)} characters left.
        </p>
        {err(problems.message, `Keep the message under ${MAX_MESSAGE} characters`, "message-error")}
        <textarea id="v-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={(showErrors && problems.message) || undefined} aria-describedby={["v-message-hint", described(problems.message, "message-error")].filter(Boolean).join(" ")} />
      </div>

      <div className="field">
        <label htmlFor="v-bname">Your name</label>
        {err(problems.buyerName, "Enter your name", "bname-error")}
        <input id="v-bname" autoComplete="name" value={buyerName} maxLength={80} onChange={(e) => setBuyerName(e.target.value)} aria-invalid={(showErrors && problems.buyerName) || undefined} aria-describedby={described(problems.buyerName, "bname-error")} />
      </div>
      <div className="field">
        <label htmlFor="v-bemail">Your email</label>
        <p className="field-hint" id="v-bemail-hint">
          Your receipt and {sendTo === "them" ? "a copy of the voucher" : "the voucher"} go here.
        </p>
        {err(problems.buyerEmail, "Enter a valid email address", "bemail-error")}
        <input id="v-bemail" type="email" inputMode="email" autoComplete="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} aria-invalid={(showErrors && problems.buyerEmail) || undefined} aria-describedby={["v-bemail-hint", described(problems.buyerEmail, "bemail-error")].filter(Boolean).join(" ")} />
      </div>

      <div className="field consent-block">
        <label className="checkbox">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} aria-describedby="marketing-hint" />
          <span>{MARKETING_OPT_IN_LABEL}</span>
        </label>
        <p className="secondary" id="marketing-hint">
          {MARKETING_OPT_IN_HINT}
        </p>
        <p className="secondary">
          We keep your name and email, and the name, email and message for the voucher, to send it and to honour it while it lasts.{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            Read our privacy notice<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
      </div>

      {error && (
        <Notice tone="error" title="Couldn't open the payment page" actions={<a className="btn btn-secondary" href={CLINIC_TEL}><Icon name="phone" /> Call {CLINIC_PHONE}</a>}>
          <p>{error}</p>
        </Notice>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Opening the payment page…" : amountOk ? `Pay ${euroText(amountEUR! * 100)} by card` : "Pay by card"}
      </button>
      <p className="secondary">You&apos;ll pay on Stripe&apos;s secure page. Apple Pay and Google Pay work too.</p>
    </form>
  );
}
