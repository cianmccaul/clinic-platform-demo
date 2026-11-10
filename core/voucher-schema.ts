/**
 * The gift voucher tables in Northbank's Postgres (Neon, Frankfurt), made by
 * ensureStaffDb() (lib/auth.ts) like the other tables. Vouchers live here, not
 * in Redis: they're money owed for up to 5 years, and Neon has backups
 * (ADR 0008). Only ever adds; never drops.
 */
export const VOUCHER_SCHEMA: string[] = [
  `create table if not exists voucher (
     id text primary key default gen_random_uuid()::text,
     code text not null unique,
     status text not null default 'pending' check (status in ('pending', 'active', 'cancelled')),
     source text not null check (source in ('online', 'desk', 'imported')),
     amount_minor integer not null check (amount_minor > 0),
     currency text not null default 'eur',
     purchase_day date,
     expires_on date,
     buyer_name text not null default '',
     buyer_email text,
     recipient_name text,
     recipient_email text,
     message text,
     paid_by text,
     stripe_session_id text unique,
     stripe_payment_intent text unique,
     marketing_opt_in boolean not null default false,
     emailed_at timestamptz,
     email_error text,
     email_attempts integer not null default 0,
     created_at timestamptz not null default now(),
     created_by text,
     note text not null default ''
   )`,
  `create index if not exists voucher_status_created on voucher (status, created_at)`,
  `create table if not exists voucher_event (
     id text primary key default gen_random_uuid()::text,
     voucher_id text not null references voucher (id),
     at timestamptz not null default now(),
     kind text not null check (kind in ('issued', 'redeemed', 'undone', 'refunded', 'cancelled', 'adjusted')),
     amount_minor integer not null,
     practitioner_id text,
     practitioner_name text,
     treatment_day date,
     undo_of text unique references voucher_event (id),
     by_staff text,
     note text not null default '',
     unconfirmed boolean not null default false
   )`,
  `create index if not exists voucher_event_voucher on voucher_event (voucher_id, at)`,
  `create index if not exists voucher_event_used on voucher_event (kind, at)`,
  // v2 (29 Oct 2026): scheduled send to the person it's for, and using a voucher when booking online.
  `alter table voucher add column if not exists send_on date`,
  `alter table voucher add column if not exists recipient_sent_at timestamptz`,
  `alter table voucher_event add column if not exists appointment_id text`,
  // Part of a voucher set aside while a patient books online (lib/voucher-checkout.ts). It counts against
  // the balance until it's used (becomes a 'redeemed' line), released, or past expires_at.
  `create table if not exists voucher_hold (
     id text primary key default gen_random_uuid()::text,
     voucher_id text not null references voucher (id),
     amount_minor integer not null check (amount_minor > 0),
     status text not null default 'held' check (status in ('held', 'used', 'released')),
     created_at timestamptz not null default now(),
     expires_at timestamptz not null,
     patient_id text,
     practitioner_id text not null,
     starts_at timestamptz not null,
     appointment_id text,
     event_id text unique references voucher_event (id),
     stripe_session_id text,
     owner text,
     note text not null default ''
   )`,
  `create index if not exists voucher_hold_live on voucher_hold (voucher_id, status, expires_at)`,
];
