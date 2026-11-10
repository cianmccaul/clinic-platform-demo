"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/Brand";
import { DashboardShell, StaffGate } from "@/components/dashboard/staff";
import { EMAIL_GROUPS, LIMITS, checkTemplate, fillTemplate, sampleValues, type EmailTemplateDef, type EmailTemplateId, type EmailValues } from "@/core/email-templates";
import { brandedEmailHtml } from "@/core/email-html";
import { POLICY_SENTENCE, formatDublin } from "@/core/policy";

/**
 * Emails (31 Oct 2026): the words of every email the Hub sends, for reception
 * and owners to change. Saved changes are used from the next email; "Back to
 * the original words" undoes them. See core/email-templates.ts.
 */
export default function EmailsPage() {
  return (
    <StaffGate permission="emails:edit" title="Emails">
      {(me) => <Emails myEmail={me.email} />}
    </StaffGate>
  );
}

type Saved = { subject: string; body: string; button?: string; updatedAt?: string; updatedBy?: string } | null;
type Template = EmailTemplateDef & { id: EmailTemplateId; saved: Saved };

const idFromUrl = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("id"));

function Emails({ myEmail }: { myEmail: string }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/email-templates", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the emails.");
      setTemplates(json.templates);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    setOpenId(idFromUrl());
    const onPop = () => setOpenId(idFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  const open = (id: string | null) => {
    window.history.pushState(null, "", id ? `?id=${id}` : window.location.pathname);
    setOpenId(id);
    window.scrollTo(0, 0);
  };

  const current = templates?.find((t) => t.id === openId);

  if (current) {
    return (
      <DashboardShell title={current.name} lede={current.sentWhen}>
        <Editor key={current.id} t={current} myEmail={myEmail} onBack={() => open(null)} onChanged={load} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Emails"
      lede="The words in every email the Hub sends. Change one and the very next email uses your words. You can always go back to the original words."
    >
      <div className="stack-5">
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        {!templates && !error && <p className="secondary">Loading…</p>}
        {templates && (
          <Notice title="Good to know">
            <ul>
              <li>Booking confirmations and reminders come from Cliniko, not the Hub, so they aren&apos;t here. Change those in Cliniko.</li>
              <li>
                The logo, the button&apos;s link, the cancellation policy sentence and the clinic&apos;s address at the bottom are added to every email
                automatically.
              </li>
            </ul>
          </Notice>
        )}
        {templates &&
          EMAIL_GROUPS.map((g) => {
            const inGroup = templates.filter((t) => t.group === g);
            if (!inGroup.length) return null;
            return (
              <section key={g} className="option-group">
                <h2>{g}</h2>
                <ul className="option-list">
                  {inGroup.map((t) => (
                    <li key={t.id}>
                      <a
                        className="option"
                        href={`?id=${t.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          open(t.id);
                        }}
                      >
                        <span className="option-main">
                          <span className="option-title">
                            {t.name} {t.saved && <span className="badge is-warn">Changed</span>}
                          </span>
                          <span className="option-desc">{t.sentWhen}</span>
                          {t.saved?.updatedAt && (
                            <span className="option-facts">
                              Changed by {t.saved.updatedBy ?? "someone"}, {formatDublin(t.saved.updatedAt)}
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </DashboardShell>
  );
}

type Field = "subject" | "body" | "button";

function Editor({ t, myEmail, onBack, onChanged }: { t: Template; myEmail: string; onBack: () => void; onChanged: () => Promise<void> }) {
  const start = t.saved ?? { subject: t.subject, body: t.body, button: t.button };
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const [button, setButton] = useState(start.button ?? t.button ?? "");
  const [busy, setBusy] = useState<"" | "save" | "test" | "reset">("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const refs = { subject: useRef<HTMLInputElement>(null), body: useRef<HTMLTextAreaElement>(null), button: useRef<HTMLInputElement>(null) };
  const lastField = useRef<Field>("body");

  const hasButton = t.button !== undefined;
  const draft = useMemo(() => ({ subject, body, ...(hasButton ? { button } : {}) }), [subject, body, button, hasButton]);
  const problems = useMemo(() => checkTemplate(t.id, draft), [t.id, draft]);
  const unsaved = subject !== start.subject || body !== start.body || (hasButton && button !== (start.button ?? t.button ?? ""));
  const isOriginal = subject === t.subject && body === t.body && (!hasButton || button === t.button);

  const preview = useMemo(() => {
    const values = sampleValues(t.id);
    // While it has a problem the Hub would send the original words, so the preview shows what's typed anyway.
    const mail = fillTemplate(t.id, values as EmailValues<typeof t.id>, { [t.id]: draft });
    const shown = problems.length ? { ...mail, ...fillAnyway(t, values, draft) } : mail;
    return {
      subject: shown.subject,
      html: brandedEmailHtml(shown.subject, shown.text, {
        ...(t.id === "code" ? { code: values.code } : {}),
        ...(hasButton ? { action: { label: shown.button, url: "https://book.northbank.example" } } : {}),
        ...(t.policy ? { policy: POLICY_SENTENCE } : {}),
      }),
    };
  }, [t, draft, problems.length, hasButton]);

  const insert = (name: string) => {
    const field = lastField.current === "button" && !hasButton ? "body" : lastField.current;
    const el = refs[field].current;
    const value = { subject, body, button }[field];
    const set = { subject: setSubject, body: setBody, button: setButton }[field];
    const token = `{${name}}`;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    set(value.slice(0, at) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const post = async (kind: "save" | "test" | "reset") => {
    setBusy(kind);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/email-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "reset" ? { id: t.id, reset: true } : { id: t.id, ...draft, ...(kind === "test" ? { test: true } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Something went wrong. Try again in a minute.");
      setMessage({ tone: "success", text: json.message });
      if (kind === "reset") {
        setSubject(t.subject);
        setBody(t.body);
        setButton(t.button ?? "");
        setConfirmReset(false);
      }
      if (kind !== "test") await onChanged();
    } catch (e: any) {
      setMessage({ tone: "error", text: e.message });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="stack-5">
      <div className="row-actions">
        <button
          className="btn btn-secondary"
          onClick={() => {
            if (unsaved && !window.confirm("Leave without saving your changes?")) return;
            onBack();
          }}
        >
          All emails
        </button>
      </div>

      <p className="secondary">
        Goes to: {t.to}.{" "}
        {t.saved?.updatedAt ? `Changed by ${t.saved.updatedBy ?? "someone"}, ${formatDublin(t.saved.updatedAt)}.` : "These are the original words."}
      </p>
      {t.note && (
        <Notice tone="warning">
          <p>{t.note}</p>
        </Notice>
      )}

      <div className="panel stack-4">
        <div className="field">
          <label htmlFor="tpl-subject">Subject</label>
          <input id="tpl-subject" ref={refs.subject} value={subject} maxLength={LIMITS.subject} onFocus={() => (lastField.current = "subject")} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tpl-body">Email</label>
          <textarea
            id="tpl-body"
            ref={refs.body}
            value={body}
            rows={16}
            maxLength={LIMITS.body}
            onFocus={() => (lastField.current = "body")}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="field-hint">Leave an empty line between paragraphs. Web links become clickable by themselves.</p>
        </div>
        {hasButton && (
          <div className="field">
            <label htmlFor="tpl-button">Button</label>
            <input id="tpl-button" ref={refs.button} value={button} maxLength={LIMITS.button} onFocus={() => (lastField.current = "button")} onChange={(e) => setButton(e.target.value)} />
            <p className="field-hint">The words on the navy button. Where it goes is set by the Hub.</p>
          </div>
        )}

        <div>
          <p className="label">Details the Hub fills in</p>
          <p className="field-hint">Click where you want one in the subject, email or button, then press it below to put it there.</p>
          <ul className="placeholder-list">
            {t.vars.map((v) => {
              const must = [...(t.required?.subject ?? []), ...(t.required?.body ?? [])].includes(v.name);
              return (
                <li key={v.name}>
                  <button type="button" className="btn btn-secondary placeholder-chip" onClick={() => insert(v.name)}>
                    {`{${v.name}}`}
                  </button>{" "}
                  <span className="secondary">
                    {v.label}
                    {v.optional && " · not always there: its paragraph is left out when it's empty"}
                    {must && " · must stay"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {problems.length > 0 && (
        <Notice tone="error" title="Fix these before saving">
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}
      {message && (
        <Notice tone={message.tone}>
          <p>{message.text}</p>
        </Notice>
      )}

      <div className="row-actions">
        <button className="btn btn-primary" disabled={!!busy || problems.length > 0 || !unsaved} onClick={() => post("save")}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-secondary" disabled={!!busy || problems.length > 0} onClick={() => post("test")}>
          {busy === "test" ? "Sending…" : `Send a test to ${myEmail}`}
        </button>
        {(t.saved || !isOriginal) && !confirmReset && (
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => (t.saved ? setConfirmReset(true) : (setSubject(t.subject), setBody(t.body), setButton(t.button ?? "")))}>
            Back to the original words
          </button>
        )}
        {confirmReset && (
          <>
            <button className="btn btn-destructive" disabled={!!busy} onClick={() => post("reset")}>
              {busy === "reset" ? "Going back…" : "Yes, use the original words"}
            </button>
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirmReset(false)}>
              Keep my words
            </button>
          </>
        )}
      </div>

      <section className="stack-3">
        <h2>Preview</h2>
        <p className="secondary">
          With made-up details. Subject: <strong>{preview.subject}</strong>
        </p>
        <iframe title="Preview of the email" className="email-preview" srcDoc={preview.html} sandbox="" />
      </section>
    </div>
  );
}

/** Fills the typed words even when they don't pass the checks yet, for the preview only. */
function fillAnyway(t: Template, values: Record<string, string>, draft: { subject: string; body: string; button?: string }) {
  const def = { ...t, subject: draft.subject, body: draft.body, button: draft.button };
  const sub = (s: string) => s.replace(/\{([a-z0-9_]+)\}/g, (whole, n: string) => values[n] ?? whole);
  return { subject: sub(def.subject).replace(/\s+/g, " ").trim(), text: sub(def.body), button: sub(def.button ?? "") };
}
