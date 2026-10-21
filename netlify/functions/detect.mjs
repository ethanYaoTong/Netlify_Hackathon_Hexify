// POST /api/detect
// Our own recurring-charge detection engine (no AI). Takes raw bank CSV text,
// finds the subscriptions hiding in it and returns them as "zombies".
// Transactions are processed in memory only: nothing is stored or logged.
import { matchMerchant } from "../lib/merchants.mjs";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

// Accepted billing frequencies: the median gap (in days) between charges must fall in [min, max].
// `days` is the nominal interval, used to decide if a subscription is still active.
const FREQUENCIES = [
  { name: "weekly", min: 6, max: 8, days: 7, perYear: 52 },
  { name: "fortnightly", min: 13, max: 16, days: 14, perYear: 26 },
  { name: "monthly", min: 27, max: 33, days: 30.44, perYear: 12 },
  { name: "quarterly", min: 85, max: 95, days: 91.31, perYear: 4 },
  { name: "yearly", min: 355, max: 375, days: 365.25, perYear: 1 },
];

const HEADER_NAMES = {
  date: ["date", "transaction date", "posted date"],
  description: ["description", "details", "narrative", "merchant", "transaction details", "payee"],
  amount: ["amount", "debit", "debit amount"],
};

// Bank/payment-processor noise in front of the real merchant name.
const PREFIXES = [/^PAYPAL\s*\*\s*/, /^SQ\s*\*\s*/, /^SP\s+/, /^VISA PURCHASE\s+/, /^EFTPOS\s+/, /^DIRECT DEBIT\s+/];

// Trailing location words banks append (cities, states, country codes).
const LOCATION_WORDS = new Set([
  "AU", "AUS", "US", "USA", "IE", "GB", "UK", "NZ", "SG", "NL", "LU", "CA",
  "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT",
  "SYDNEY", "MELBOURNE", "BRISBANE", "PERTH", "ADELAIDE", "CANBERRA", "HOBART", "DARWIN", "DUBLIN", "LONDON",
]);

const FRIENDLY_ERROR =
  "The spirits couldn't read this file… Make sure it's a bank statement CSV with date, description and amount columns.";

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST with your CSV as the request body." }, { status: 405 });
  }

  const text = await req.text();
  if (!text.trim()) return Response.json({ error: "The file is empty. Even ghosts leave a trace…" }, { status: 400 });
  if (text.length > MAX_BODY_BYTES) {
    return Response.json({ error: "That statement is too big to summon (5 MB max)." }, { status: 413 });
  }

  let transactions;
  try {
    transactions = parseTransactions(text);
  } catch (err) {
    return Response.json({ error: err.message || FRIENDLY_ERROR }, { status: 400 });
  }

  return Response.json(detectSubscriptions(transactions));
};

export const config = { path: "/api/detect" };

// ---------------------------------------------------------------------------
// 1. CSV parsing
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 parser: handles quoted fields with commas, "" escapes and CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Parses YYYY-MM-DD or DD/MM/YYYY (Australian order) into a UTC day timestamp, or null. */
function parseDate(value) {
  const s = String(value).trim();
  let y, m, d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    [, y, m, d] = match.map(Number);
  } else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const t = Date.UTC(y, m - 1, d);
  const check = new Date(t);
  // Reject impossible dates like 31/02 that Date.UTC would silently roll over.
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return t;
}

/** Parses "-1,234.56", "$12.00" or "(12.00)" into a number, or null. */
function parseAmount(value) {
  let s = String(value).trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (!/^[+-]?\d*\.?\d+$/.test(s)) return null;
  return sign * parseFloat(s);
}

function findColumn(headers, names) {
  for (const name of names) {
    const idx = headers.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Some banks (e.g. CommBank) export without a header row, so guess the columns from the first row. */
function inferColumns(row) {
  const date = row.findIndex((f) => parseDate(f) !== null);
  const amount = row.findIndex((f, i) => i !== date && parseAmount(f) !== null);
  const description = row.findIndex((f, i) => i !== date && i !== amount && /[A-Za-z]/.test(f));
  return { date, amount, description };
}

/** Turns CSV text into debit transactions: [{ day, description, amount }] with positive amounts. */
function parseTransactions(text) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length === 0) throw new Error(FRIENDLY_ERROR);

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  let cols = {
    date: findColumn(headers, HEADER_NAMES.date),
    description: findColumn(headers, HEADER_NAMES.description),
    amount: findColumn(headers, HEADER_NAMES.amount),
  };
  let dataRows = rows.slice(1);
  if (Object.values(cols).includes(-1)) {
    cols = inferColumns(rows[0]);
    dataRows = rows;
  }
  if (Object.values(cols).includes(-1)) throw new Error(FRIENDLY_ERROR);

  const parsed = [];
  for (const row of dataRows) {
    const day = parseDate(row[cols.date] ?? "");
    const amount = parseAmount(row[cols.amount] ?? "");
    const description = (row[cols.description] ?? "").trim();
    if (day === null || amount === null || amount === 0 || !description) continue;
    parsed.push({ day, description, amount });
  }
  if (parsed.length === 0) throw new Error(FRIENDLY_ERROR);

  // If the file has any negative amounts, debits are the negatives and positives are income.
  // Otherwise it's a debit-only column, so every amount is money going out.
  const hasNegatives = parsed.some((t) => t.amount < 0);
  const debits = parsed
    .filter((t) => (hasNegatives ? t.amount < 0 : t.amount > 0))
    .map((t) => ({ ...t, amount: Math.abs(t.amount) }));

  return { debits, scanned: parsed.length };
}

// ---------------------------------------------------------------------------
// 2. Merchant normalisation
// ---------------------------------------------------------------------------

/**
 * "SP SPOTIFY P1A2B3"             -> "SPOTIFY"
 * "NETFLIX.COM 0412 SYDNEY AU"    -> "NETFLIX.COM"
 * "WOOLWORTHS METRO 3341, RANDWICK" -> "WOOLWORTHS METRO"
 */
function normaliseDescription(description) {
  let s = description.toUpperCase().trim();

  // Strip payment-processor prefixes (repeat in case they stack, e.g. "EFTPOS SQ *CAFE").
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of PREFIXES) {
      if (prefix.test(s)) {
        s = s.replace(prefix, "");
        stripped = true;
      }
    }
  }

  s = s.split(",")[0]; // anything after a comma is usually the suburb
  const tokens = s
    .replace(/\*/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/\d/.test(t)); // drop reference numbers, card numbers and dates

  while (tokens.length > 1 && LOCATION_WORDS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ") || description.toUpperCase().trim();
}

const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const round2 = (n) => Math.round(n * 100) / 100;
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Which merchant a transaction belongs to: a known merchant, or its normalised description. */
function identifyMerchant(description) {
  const normalised = normaliseDescription(description);
  const known = matchMerchant(normalised) || matchMerchant(description.toUpperCase());
  if (known) return { key: known.id, known };
  return { key: normalised, known: null };
}

// ---------------------------------------------------------------------------
// 3. Recurring-charge detection
// ---------------------------------------------------------------------------

function detectSubscriptions({ debits, scanned }) {
  if (debits.length === 0) return { subscriptions: [], totalYearly: 0, transactionsScanned: scanned };

  // "Now" is the newest date in the statement, so old statements give stable results.
  const newestDay = Math.max(...debits.map((t) => t.day));

  // Step 1: group charges by merchant.
  const groups = new Map();
  for (const t of debits) {
    const { key, known } = identifyMerchant(t.description);
    if (!groups.has(key)) groups.set(key, { key, known, charges: [] });
    groups.get(key).charges.push(t);
  }

  const subscriptions = [];
  for (const { key, known, charges } of groups.values()) {
    // Step 2: a subscription needs at least two charges.
    if (charges.length < 2) continue;
    charges.sort((a, b) => a.day - b.day);

    // Step 3–4: the median gap between charges decides the billing frequency.
    // Median (not mean) so one late or skipped payment doesn't break detection.
    const gaps = charges.slice(1).map((c, i) => Math.round((c.day - charges[i].day) / DAY_MS));
    const gap = median(gaps);
    const freq = FREQUENCIES.find((f) => gap >= f.min && gap <= f.max);
    if (!freq) continue;
    if (freq.name === "weekly" && charges.length < 3) continue;

    // Step 5: subscriptions charge roughly the same amount every time.
    // Groceries and takeaway vary wildly, so any charge >25% off the median rules it out.
    const amounts = charges.map((c) => c.amount);
    const typical = median(amounts);
    if (amounts.some((a) => Math.abs(a - typical) > typical * 0.25)) continue;

    const first = charges[0];
    const last = charges[charges.length - 1];

    // Step 6: price hike ("mutation") if the latest charge is >5% above the first.
    const priceHike = last.amount > first.amount * 1.05 ? { from: round2(first.amount), to: round2(last.amount) } : null;

    // Step 7: still active if the last charge is within 1.5 billing cycles of the statement end.
    const status = newestDay - last.day <= freq.days * 1.5 * DAY_MS ? "active" : "dormant";

    // Step 8–9: yearly cost at the current price, and rot level by months haunting you.
    const months = Math.round((newestDay - first.day) / DAY_MS / 30.44);
    const rotLevel = months < 3 ? 0 : months < 6 ? 1 : months < 12 ? 2 : 3;

    const name = known ? known.name : titleCase(key);
    subscriptions.push({
      id: known ? known.id : slugify(key),
      name,
      category: known ? known.category : "unknown",
      frequency: freq.name,
      amount: round2(last.amount),
      yearlyCost: round2(last.amount * freq.perYear),
      chargeCount: charges.length,
      firstCharged: isoDate(first.day),
      lastCharged: isoDate(last.day),
      status,
      rotLevel,
      priceHike,
      cancelUrl: known
        ? known.cancelUrl
        : `https://www.google.com/search?q=${encodeURIComponent(`how to cancel ${name} subscription`).replace(/%20/g, "+")}`,
      known: Boolean(known),
    });
  }

  subscriptions.sort((a, b) => b.yearlyCost - a.yearlyCost);

  // Only active subscriptions are still draining money; dormant ones are shown but not counted.
  const totalYearly = round2(
    subscriptions.filter((s) => s.status === "active").reduce((sum, s) => sum + s.yearlyCost, 0)
  );

  return { subscriptions, totalYearly, transactionsScanned: scanned };
}
