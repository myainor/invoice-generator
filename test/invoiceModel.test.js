import { describe, it, expect } from 'vitest';
import {
  computeTotals, createEmptyInvoice, resolveSupply, amountInWords, money,
  isValidGstin, gstStateOf, addDays, displayDate,
} from '../src/lib/invoiceModel';

const base = (over = {}) => ({
  ...createEmptyInvoice(),
  currency: 'INR',
  items: [{ id: 'a', description: 'Work', qty: 2, rate: 1000 }],
  ...over,
});

describe('computeTotals', () => {
  it('sums line items', () => {
    const t = computeTotals(base());
    expect(t.subtotal).toBe(2000);
    expect(t.total).toBe(2000);
  });

  it('applies a percent discount before tax', () => {
    const t = computeTotals(base({ discount: { type: 'percent', value: 10 } }));
    expect(t.discountAmount).toBe(200);
    expect(t.taxable).toBe(1800);
  });

  it('caps a flat discount at the subtotal', () => {
    const t = computeTotals(base({ discount: { type: 'flat', value: 99999 } }));
    expect(t.discountAmount).toBe(2000);
    expect(t.taxable).toBe(0);
  });

  it('splits GST into CGST + SGST for the same state', () => {
    const inv = base({
      tax: { mode: 'gst', rate: 18, supply: 'intra', label: 'VAT' },
    });
    const t = computeTotals(inv);
    expect(t.taxLines.map((l) => l.key)).toEqual(['cgst', 'sgst']);
    expect(t.taxAmount).toBe(360);
    expect(t.total).toBe(2360);
  });

  it('charges IGST for a different state', () => {
    const inv = base({ tax: { mode: 'gst', rate: 18, supply: 'inter', label: 'VAT' } });
    const t = computeTotals(inv);
    expect(t.taxLines.map((l) => l.key)).toEqual(['igst']);
    expect(t.taxAmount).toBe(360);
  });

  it('supports a simple named tax', () => {
    const inv = base({ currency: 'GBP', tax: { mode: 'simple', rate: 20, supply: 'auto', label: 'VAT' } });
    const t = computeTotals(inv);
    expect(t.taxLines[0].label).toBe('VAT (20%)');
    expect(t.total).toBe(2400);
  });

  it('rounds INR totals to the nearest rupee and reports the round-off', () => {
    const inv = base({ items: [{ id: 'a', description: '', qty: 1, rate: 100.4 }] });
    const t = computeTotals(inv);
    expect(t.total).toBe(100);
    expect(t.roundOff).toBe(-0.4);
  });

  it('keeps cents for non-INR currencies', () => {
    const inv = base({ currency: 'USD', items: [{ id: 'a', description: '', qty: 1, rate: 100.4 }] });
    expect(computeTotals(inv).total).toBe(100.4);
  });

  it('avoids float dust', () => {
    const inv = base({ items: [{ id: 'a', description: '', qty: 3, rate: 0.1 }] });
    expect(computeTotals(inv).subtotal).toBe(0.3);
  });

  it('treats bad numbers as zero', () => {
    const inv = base({ items: [{ id: 'a', description: '', qty: 'x', rate: '' }] });
    expect(computeTotals(inv).total).toBe(0);
  });
});

describe('GST helpers', () => {
  it('validates GSTINs', () => {
    expect(isValidGstin('27ABCDE1234F1Z5')).toBe(true);
    expect(isValidGstin('27abcde1234f1z5')).toBe(true);
    expect(isValidGstin('nope')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });

  it('maps a GSTIN to its state', () => {
    expect(gstStateOf('27ABCDE1234F1Z5')).toBe('Maharashtra');
    expect(gstStateOf('29ABCDE1234F1Z5')).toBe('Karnataka');
    expect(gstStateOf('99ABCDE1234F1Z5')).toBe(null);
  });

  it('derives place of supply from the two GSTINs', () => {
    const same = base({ from: { gstin: '27ABCDE1234F1Z5' }, to: { gstin: '27ZZZZZ9999Z1Z5' } });
    const diff = base({ from: { gstin: '27ABCDE1234F1Z5' }, to: { gstin: '29ZZZZZ9999Z1Z5' } });
    expect(resolveSupply(same)).toBe('intra');
    expect(resolveSupply(diff)).toBe('inter');
  });

  it('falls back to same-state when a GSTIN is missing', () => {
    expect(resolveSupply(base())).toBe('intra');
  });

  it('honours an explicit supply choice', () => {
    const inv = base({ tax: { mode: 'gst', rate: 18, supply: 'inter', label: 'VAT' } });
    expect(resolveSupply(inv)).toBe('inter');
  });
});

describe('amountInWords', () => {
  it('uses Indian grouping for INR', () => {
    expect(amountInWords(12500, 'INR')).toBe('Rupees Twelve Thousand Five Hundred Only');
    expect(amountInWords(100000, 'INR')).toBe('Rupees One Lakh Only');
    expect(amountInWords(10000000, 'INR')).toBe('Rupees One Crore Only');
  });

  it('includes the minor unit', () => {
    expect(amountInWords(1.5, 'INR')).toBe('Rupees One and Fifty Paise Only');
  });

  it('uses western grouping for other currencies', () => {
    expect(amountInWords(1000000, 'USD')).toBe('Dollars One Million Only');
  });

  it('handles zero', () => {
    expect(amountInWords(0, 'INR')).toBe('Rupees Zero Only');
  });
});

describe('formatting', () => {
  it('always shows two decimals', () => {
    expect(money(5000, 'USD')).toBe('$5,000.00');
    expect(money(5000.5, 'USD')).toBe('$5,000.50');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-01-25', 15)).toBe('2026-02-09');
  });

  it('formats dates', () => {
    expect(displayDate('2026-09-16')).toBe('16 Sep 2026');
    expect(displayDate('')).toBe('—');
  });
});
