/**
 * Demo only: put a value into one of the real pages' inputs, the way typing
 * would, so the page's own React state picks it up. Used by the hint cards
 * and the simulated notification; the real pages don't know about either.
 */
export function fillField(selector: string, value: string, opts: { submit?: boolean } = {}): boolean {
  const el = document.querySelector<HTMLInputElement>(selector);
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  if (opts.submit) setTimeout(() => el.form?.requestSubmit(), 50);
  return true;
}

export const CODE_FIELD = 'input[autocomplete="one-time-code"]';
