/**
 * Data model + maths for the invoice generator.
 *
 * Everything here is pure and browser-only: there is no server, so client
 * details never leave the user's device. Drafts live in localStorage.
 *
 * Note on currency: amounts are entered *in* `invoice.currency` and are never
 * FX-converted. Totals and formatting always use the invoice's own currency.
 */
import { getCurrencyMeta, isSupportedCurrency, DEFAULT_CURRENCY } from './currencies';

export const DRAFT_KEY = 'invoice-generator:draft:v1';
export const HISTORY_KEY = 'invoice-generator:history:v1';
export const HISTORY_LIMIT = 3;

/* A logo is stored inline as a data URL. localStorage gives us ~5 MB total, so
   cap the source file well below that or saving the draft starts failing. */
export const MAX_LOGO_BYTES = 400 * 1024;

/* GST state codes — the first two digits of a GSTIN. Used to derive the place
   of supply and to decide CGST+SGST (same state) vs IGST (different states). */
export const GST_STATE_CODES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli',
  '27': 'Maharashtra', '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const GST_RATES = [0, 5, 12, 18, 28];

export function isValidGstin(value) {
  return GSTIN_RE.test(String(value || '').trim().toUpperCase());
}

export function gstStateOf(gstin) {
  const code = String(gstin || '').trim().slice(0, 2);
  return GST_STATE_CODES[code] || null;
}

/** ISO date (yyyy-mm-dd) for <input type="date">. */
function isoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-16" → "16 Sep 2026", matching the rest of the product. */
export function displayDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

let itemSeq = 0;
export function newItem(patch = {}) {
  itemSeq += 1;
  return { id: `it-${Date.now()}-${itemSeq}`, description: '', qty: 1, rate: 0, ...patch };
}

/** INV-2026-0416 — year plus a short time-derived suffix, unique enough locally. */
export function makeInvoiceNumber() {
  const now = new Date();
  const suffix = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  return `INV-${now.getFullYear()}-${suffix}`;
}

export function createEmptyInvoice() {
  const today = isoDate();
  return {
    currency: DEFAULT_CURRENCY,
    invoiceNumber: makeInvoiceNumber(),
    issueDate: today,
    dueDate: addDays(today, 15),
    from: { name: '', email: '', phone: '', address: '', gstin: '', pan: '' },
    to: { name: '', email: '', phone: '', address: '', gstin: '' },
    items: [newItem({ description: '', qty: 1, rate: 0 })],
    discount: { type: 'percent', value: 0 },
    tax: {
      mode: 'none',          // 'none' | 'gst' | 'simple'
      rate: 18,
      supply: 'auto',        // 'auto' | 'intra' | 'inter'
      label: 'VAT',          // used when mode === 'simple'
    },
    notes: '',
    terms: '',
    payment: { bankName: '', accountName: '', accountNumber: '', ifsc: '', upi: '' },
    branding: { businessName: '', logoDataUrl: '', brandColor: '#3b82f6' },
  };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Round to 2dp without float dust (0.1+0.2 style). */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Whether GST should be split CGST+SGST (same state) or charged as IGST.
 * `auto` derives it from the two GSTINs and falls back to intra-state, which is
 * the common case for a freelancer billing a client in their own state.
 */
export function resolveSupply(invoice) {
  const mode = invoice?.tax?.supply || 'auto';
  if (mode === 'intra' || mode === 'inter') return mode;
  const a = String(invoice?.from?.gstin || '').trim().slice(0, 2);
  const b = String(invoice?.to?.gstin || '').trim().slice(0, 2);
  if (a && b && GST_STATE_CODES[a] && GST_STATE_CODES[b]) {
    return a === b ? 'intra' : 'inter';
  }
  return 'intra';
}

/**
 * All derived money for an invoice. Everything downstream (document, preview,
 * totals bar) reads from this so the numbers can never disagree.
 */
export function computeTotals(invoice) {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  const lines = items.map((it) => ({
    ...it,
    amount: round2(num(it.qty) * num(it.rate)),
  }));

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));

  const dType = invoice?.discount?.type === 'flat' ? 'flat' : 'percent';
  const dValue = num(invoice?.discount?.value);
  const discountAmount = round2(
    dType === 'percent' ? (subtotal * dValue) / 100 : Math.min(dValue, subtotal),
  );

  const taxable = round2(Math.max(0, subtotal - discountAmount));

  const mode = invoice?.tax?.mode || 'none';
  const rate = num(invoice?.tax?.rate);
  const supply = resolveSupply(invoice);

  let taxAmount = 0;
  let taxLines = [];

  if (mode === 'gst' && rate > 0) {
    if (supply === 'intra') {
      const half = round2((taxable * rate) / 200);
      taxLines = [
        { key: 'cgst', label: `CGST (${rate / 2}%)`, amount: half },
        { key: 'sgst', label: `SGST (${rate / 2}%)`, amount: half },
      ];
      taxAmount = round2(half * 2);
    } else {
      taxAmount = round2((taxable * rate) / 100);
      taxLines = [{ key: 'igst', label: `IGST (${rate}%)`, amount: taxAmount }];
    }
  } else if (mode === 'simple' && rate > 0) {
    taxAmount = round2((taxable * rate) / 100);
    const label = String(invoice?.tax?.label || 'Tax').trim() || 'Tax';
    taxLines = [{ key: 'tax', label: `${label} (${rate}%)`, amount: taxAmount }];
  }

  const rawTotal = round2(taxable + taxAmount);
  // Indian invoices conventionally round to the nearest rupee and show the delta.
  const isINR = (invoice?.currency || DEFAULT_CURRENCY) === 'INR';
  const total = isINR ? Math.round(rawTotal) : rawTotal;
  const roundOff = round2(total - rawTotal);

  return {
    lines, subtotal, discountAmount, discountType: dType, discountValue: dValue,
    taxable, taxLines, taxAmount, supply, rawTotal, roundOff, total,
  };
}

/**
 * Format in the invoice's own currency — never converted.
 *
 * Amounts are always shown with exactly two decimals so an invoice column
 * aligns and reads as money ("₹5,000.00", not "₹5,000").
 */
export function money(amount, currency = DEFAULT_CURRENCY) {
  const code = isSupportedCurrency(currency) ? currency : DEFAULT_CURRENCY;
  const meta = getCurrencyMeta(code);
  const value = num(amount);
  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${meta.symbol}${value.toFixed(2)}`;
  }
}

/* ---------- amount in words ---------- */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under1000(n) {
  const out = [];
  if (n >= 100) {
    out.push(ONES[Math.floor(n / 100)], 'Hundred');
    n %= 100;
    if (n) out.push('and');
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)]);
    n %= 10;
  }
  if (n) out.push(ONES[n]);
  return out.join(' ');
}

/** Indian grouping: crore / lakh / thousand. */
function indianWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

/** International grouping: million / billion. */
function westernWords(n) {
  if (n === 0) return 'Zero';
  const scales = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
  const parts = [];
  for (const [value, name] of scales) {
    const chunk = Math.floor(n / value);
    if (chunk) {
      parts.push(`${westernWords(chunk)} ${name}`);
      n %= value;
    }
  }
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}

const MINOR_UNIT = {
  INR: 'Paise', USD: 'Cents', GBP: 'Pence', EUR: 'Cents',
  AUD: 'Cents', CAD: 'Cents', AED: 'Fils', SGD: 'Cents',
};

const MAJOR_UNIT = {
  INR: 'Rupees', USD: 'Dollars', GBP: 'Pounds', EUR: 'Euro',
  AUD: 'Dollars', CAD: 'Dollars', AED: 'Dirhams', SGD: 'Dollars',
};

/**
 * "₹12,500.50" → "Rupees Twelve Thousand Five Hundred and Fifty Paise Only".
 * A GST tax invoice is conventionally expected to carry the amount in words.
 */
export function amountInWords(amount, currency = DEFAULT_CURRENCY) {
  const code = isSupportedCurrency(currency) ? currency : DEFAULT_CURRENCY;
  const value = Math.abs(num(amount));
  const major = Math.floor(value);
  const minor = Math.round((value - major) * 100);
  const toWords = code === 'INR' ? indianWords : westernWords;

  if (major > 1e15) return ''; // beyond sensible invoice range — skip rather than lie

  const head = `${MAJOR_UNIT[code] || ''} ${toWords(major)}`.trim();
  const tail = minor ? ` and ${toWords(minor)} ${MINOR_UNIT[code] || ''}` : '';
  return `${head}${tail} Only`.replace(/\s+/g, ' ');
}

/* ---------- local persistence ---------- */

/** Saving must never throw — private mode and full quotas are normal. */
function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persist the draft. An inline logo can push us past quota, so on failure we
 * retry once without it rather than silently losing the whole draft.
 */
export function saveDraft(invoice) {
  if (safeWrite(DRAFT_KEY, invoice)) return true;
  const stripped = { ...invoice, branding: { ...invoice.branding, logoDataUrl: '' } };
  return safeWrite(DRAFT_KEY, stripped);
}

export function loadDraft() {
  const saved = safeRead(DRAFT_KEY);
  if (!saved || typeof saved !== 'object') return null;
  // Merge onto a fresh invoice so drafts written by an older version of the
  // tool never arrive missing a field the UI expects.
  const base = createEmptyInvoice();
  return {
    ...base, ...saved,
    from: { ...base.from, ...(saved.from || {}) },
    to: { ...base.to, ...(saved.to || {}) },
    tax: { ...base.tax, ...(saved.tax || {}) },
    discount: { ...base.discount, ...(saved.discount || {}) },
    payment: { ...base.payment, ...(saved.payment || {}) },
    branding: { ...base.branding, ...(saved.branding || {}) },
    items: Array.isArray(saved.items) && saved.items.length ? saved.items : base.items,
  };
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

export function loadHistory() {
  const list = safeRead(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

/** Keep the last few finished invoices so a refresh doesn't lose them. */
export function pushHistory(invoice, total) {
  const entry = {
    id: `${invoice.invoiceNumber}-${Date.now()}`,
    invoiceNumber: invoice.invoiceNumber,
    clientName: invoice.to?.name || 'Client',
    issueDate: invoice.issueDate,
    currency: invoice.currency,
    total,
    invoice,
  };
  const next = [entry, ...loadHistory().filter((e) => e.invoiceNumber !== invoice.invoiceNumber)]
    .slice(0, HISTORY_LIMIT);
  safeWrite(HISTORY_KEY, next);
  return next;
}

export function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}
