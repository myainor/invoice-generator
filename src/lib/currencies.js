/**
 * Currencies the generator supports. Amounts are always entered and shown in
 * the invoice's own currency; nothing is ever converted.
 *
 * To add a currency, add an entry here and its words in `MAJOR_UNIT` /
 * `MINOR_UNIT` in invoiceModel.js (used for "amount in words").
 */
export const DEFAULT_CURRENCY = 'INR';

export const CURRENCIES = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', locale: 'en-IE' },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', locale: 'en-AE' },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
};

export const CURRENCY_LIST = Object.values(CURRENCIES);

export function isSupportedCurrency(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, code.toUpperCase());
}

export function getCurrencyMeta(code) {
  return CURRENCIES[String(code || '').toUpperCase()] || CURRENCIES[DEFAULT_CURRENCY];
}
