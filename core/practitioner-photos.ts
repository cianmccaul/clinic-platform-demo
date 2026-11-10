/**
 * The clinic's own practitioner portraits (public/practitioners/*.jpg),
 * matched to Cliniko practitioners by name. Used in preference to Cliniko's
 * profile picture so every row has the same professional, face-centred crop.
 * Anyone not listed falls back to Cliniko's picture, then to initials.
 *
 * To add someone: save a square, face-centred JPEG (240×240) as
 * public/practitioners/<first>-<last>.jpg and add their name below.
 * Pure, no I/O, unit-tested in tests/practitioner-photos.test.ts.
 */

// Demo: no photos, so every practitioner shows their initials.
const PHOTOS: Record<string, string> = {};

/** "Dr. Anna Kowalska MISCP" → "anna kowalska" */
export function normaliseName(first = "", last = "") {
  return `${first} ${last}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|miss)\.?\s+/g, "")
    .replace(/\b(miscp|mcsp|bsc|msc|phd)\b\.?/g, "")
    .replace(/[^a-z' -]/g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function practitionerPhoto(first?: string, last?: string): string | null {
  const file = PHOTOS[normaliseName(first, last)];
  return file ? `/practitioners/${file}` : null;
}

export const PHOTO_NAMES = Object.keys(PHOTOS);
