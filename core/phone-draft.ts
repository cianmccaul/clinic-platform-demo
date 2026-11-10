/**
 * A phone booking in progress, remembered in this browser tab
 * (sessionStorage) so staff can leave "Book a patient by phone" to look a
 * caller up and carry on where they were (the answering service, 30 Oct 2026).
 *
 * Keyed by the signed-in user, so someone else signing in on the same
 * browser sees nothing. Never card details (the booking steps have none),
 * and cleared as soon as the payment link is made. Gone 30 minutes after
 * the last change, on "Start again" and on sign-out.
 */

export const PHONE_DRAFT_TTL_MS = 30 * 60 * 1000;
const PREFIX = "northbank-phone-booking:";

export type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const phoneDraftKey = (userId: string) => PREFIX + userId;

/** This tab's sessionStorage, or null where there is none (private windows, the server). */
export function browserStore(): DraftStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function savePhoneDraft<T>(store: DraftStore | null, userId: string, data: T, now = Date.now()) {
  if (!store || !userId) return;
  try {
    store.setItem(phoneDraftKey(userId), JSON.stringify({ v: 1, userId, savedAt: now, data }));
  } catch {}
}

/** The user's booking in progress, or null if there's none, it's someone else's, or it's over 30 minutes old (then it's removed). */
export function readPhoneDraft<T>(store: DraftStore | null, userId: string, now = Date.now()): T | null {
  if (!store || !userId) return null;
  try {
    const raw = store.getItem(phoneDraftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    const fresh = d && d.v === 1 && d.userId === userId && typeof d.savedAt === "number" && now - d.savedAt < PHONE_DRAFT_TTL_MS && d.savedAt <= now + 60_000;
    if (!fresh || !d.data) {
      store.removeItem(phoneDraftKey(userId));
      return null;
    }
    return d.data as T;
  } catch {
    return null;
  }
}

export function clearPhoneDraft(store: DraftStore | null, userId: string) {
  if (!store || !userId) return;
  try {
    store.removeItem(phoneDraftKey(userId));
  } catch {}
}

/** On sign-out: every user's booking in progress in this tab. */
export function clearAllPhoneDrafts(store: DraftStore | null = browserStore()) {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => store.removeItem(k));
  } catch {}
}
