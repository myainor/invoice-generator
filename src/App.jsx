/**
 * Invoice generator: a free, account-free invoice maker.
 *
 * Everything happens in the browser and the draft lives in localStorage, so
 * client details never leave the device. PDF output is the browser's own
 * print pipeline (see the @media print block in styles.css): vector text,
 * real page breaks and zero dependencies.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Trash2, Download, RotateCcw, ImagePlus, Check,
  Receipt, Building2, UserRound, ListOrdered, Percent, Landmark, StickyNote,
} from 'lucide-react';
import InvoiceDocument from './components/InvoiceDocument';
import { CURRENCY_LIST } from './lib/currencies';
import {
  createEmptyInvoice, computeTotals, newItem, money, addDays,
  loadDraft, saveDraft, clearDraft, loadHistory, pushHistory,
  isValidGstin, gstStateOf, resolveSupply, GST_RATES, MAX_LOGO_BYTES,
} from './lib/invoiceModel';

export default function App() {
  const fileRef = useRef(null);

  const [invoice, setInvoice] = useState(() => loadDraft() || createEmptyInvoice());
  const [history, setHistory] = useState(() => loadHistory());
  const [savedFlash, setSavedFlash] = useState(false);
  const [logoError, setLogoError] = useState('');

  const totals = useMemo(() => computeTotals(invoice), [invoice]);

  /* Autosave the draft, debounced so typing doesn't hammer localStorage. */
  useEffect(() => {
    const t = setTimeout(() => saveDraft(invoice), 400);
    return () => clearTimeout(t);
  }, [invoice]);

  /* ---------- update helpers ---------- */
  const patch = useCallback((partial) => {
    setInvoice((v) => ({ ...v, ...partial }));
  }, []);

  const patchGroup = useCallback((group, partial) => {
    setInvoice((v) => ({ ...v, [group]: { ...v[group], ...partial } }));
  }, []);

  const updateItem = useCallback((id, partial) => {
    setInvoice((v) => ({
      ...v,
      items: v.items.map((it) => (it.id === id ? { ...it, ...partial } : it)),
    }));
  }, []);

  const addItem = useCallback(() => {
    setInvoice((v) => ({ ...v, items: [...v.items, newItem()] }));
  }, []);

  const removeItem = useCallback((id) => {
    setInvoice((v) => ({
      ...v,
      items: v.items.length > 1 ? v.items.filter((it) => it.id !== id) : v.items,
    }));
  }, []);

  const handleLogo = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // let the same file be re-picked after an error
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('That file is not an image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(`Logo must be under ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoError('');
      patchGroup('branding', { logoDataUrl: String(reader.result || '') });
    };
    reader.onerror = () => setLogoError('Could not read that file.');
    reader.readAsDataURL(file);
  };

  /* Print → "Save as PDF". Naming the document first makes the browser suggest
     a sensible filename instead of the page title. */
  const handlePrint = () => {
    const previous = document.title;
    const client = invoice.to?.name ? ` - ${invoice.to.name}` : '';
    document.title = `${invoice.invoiceNumber || 'Invoice'}${client}`;

    const restore = () => {
      document.title = previous;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);

    setHistory(pushHistory(invoice, totals.total));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2400);

    window.print();
  };

  const handleReset = () => {
    clearDraft();
    setInvoice(createEmptyInvoice());
    setLogoError('');
  };

  const supply = resolveSupply(invoice);
  const isGst = invoice.tax.mode === 'gst';
  const fromGstState = gstStateOf(invoice.from.gstin);
  const toGstState = gstStateOf(invoice.to.gstin);

  const gstinHint = (value, state) => {
    const v = String(value || '').trim();
    if (!v) return null;
    if (!isValidGstin(v)) return <span className="ig-hint warn">Doesn&apos;t look like a valid GSTIN</span>;
    return <span className="ig-hint">{state || 'Valid'}</span>;
  };

  return (
    <div className="app">
      <header className="app-bar">
        <div className="app-wrap app-bar-in">
          <span className="app-title"><Receipt size={18} /> Invoice Generator</span>
          <a className="app-link" href="https://github.com/myainor/invoice-generator" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </header>

      <main className="app-wrap">
        <section className="ig-hero">
          <h1>Invoice generator</h1>
          <p>
            Build a clean, branded invoice and download it as a PDF. GST-ready, eight
            currencies, no watermark, and your details never leave your browser.
          </p>
          <ul className="ig-hero-points">
            <li><Check size={15} /> GST, CGST/SGST &amp; IGST</li>
            <li><Check size={15} /> 8 currencies</li>
            <li><Check size={15} /> No watermark</li>
            <li><Check size={15} /> Saved on your device only</li>
          </ul>
        </section>

        <section className="ig-main">
          <div className="ig-layout">

            {/* ============ FORM ============ */}
            <div className="ig-form">

              {/* Your brand */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><Receipt size={15} /> Your brand</h2>
                <div className="ig-grid one">
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-biz">Business name shown on the invoice</label>
                    <input
                      id="ig-biz" className="ig-input" type="text"
                      placeholder="Studio Nine Design"
                      value={invoice.branding.businessName}
                      onChange={(e) => patchGroup('branding', { businessName: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <span className="ig-label">Logo &amp; accent colour</span>
                    <div className="ig-logo-row">
                      <div className="ig-logo-prev">
                        {invoice.branding.logoDataUrl
                          ? <img src={invoice.branding.logoDataUrl} alt="Your logo" />
                          : <ImagePlus size={20} />}
                      </div>
                      <button type="button" className="ig-file-btn" onClick={() => fileRef.current?.click()}>
                        <ImagePlus size={15} /> {invoice.branding.logoDataUrl ? 'Replace' : 'Upload logo'}
                      </button>
                      {invoice.branding.logoDataUrl && (
                        <button
                          type="button" className="ig-file-btn"
                          onClick={() => patchGroup('branding', { logoDataUrl: '' })}
                        >
                          Remove
                        </button>
                      )}
                      <input
                        ref={fileRef} type="file" accept="image/*"
                        className="ig-file-input" onChange={handleLogo}
                      />
                      <input
                        type="color" className="ig-color" aria-label="Accent colour"
                        value={invoice.branding.brandColor}
                        onChange={(e) => patchGroup('branding', { brandColor: e.target.value })}
                      />
                    </div>
                    {logoError
                      ? <span className="ig-hint warn">{logoError}</span>
                      : <span className="ig-hint">PNG or SVG, under {Math.round(MAX_LOGO_BYTES / 1024)} KB.</span>}
                  </div>
                </div>
              </div>

              {/* Invoice details */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><ListOrdered size={15} /> Invoice details</h2>
                <div className="ig-grid">
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-no">Invoice number</label>
                    <input
                      id="ig-no" className="ig-input" type="text"
                      value={invoice.invoiceNumber}
                      onChange={(e) => patch({ invoiceNumber: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-cur">Currency</label>
                    <select
                      id="ig-cur" className="ig-select"
                      value={invoice.currency}
                      onChange={(e) => patch({ currency: e.target.value })}
                    >
                      {CURRENCY_LIST.map((c) => (
                        <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-issued">Issue date</label>
                    <input
                      id="ig-issued" className="ig-input" type="date"
                      value={invoice.issueDate}
                      onChange={(e) => patch({
                        issueDate: e.target.value,
                        dueDate: addDays(e.target.value, 15),
                      })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-due">Due date</label>
                    <input
                      id="ig-due" className="ig-input" type="date"
                      value={invoice.dueDate}
                      onChange={(e) => patch({ dueDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Billed by */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><Building2 size={15} /> Billed by (you)</h2>
                <div className="ig-grid">
                  <div className="ig-field ig-span">
                    <label className="ig-label" htmlFor="ig-f-name">Name</label>
                    <input
                      id="ig-f-name" className="ig-input" type="text" placeholder="Your name or business"
                      value={invoice.from.name}
                      onChange={(e) => patchGroup('from', { name: e.target.value })}
                    />
                  </div>
                  <div className="ig-field ig-span">
                    <label className="ig-label" htmlFor="ig-f-addr">Address</label>
                    <textarea
                      id="ig-f-addr" className="ig-textarea" placeholder={'Street\nCity, State — PIN'}
                      value={invoice.from.address}
                      onChange={(e) => patchGroup('from', { address: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-f-email">Email</label>
                    <input
                      id="ig-f-email" className="ig-input" type="email"
                      value={invoice.from.email}
                      onChange={(e) => patchGroup('from', { email: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-f-phone">Phone</label>
                    <input
                      id="ig-f-phone" className="ig-input" type="tel"
                      value={invoice.from.phone}
                      onChange={(e) => patchGroup('from', { phone: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-f-gst">GSTIN <span className="ig-hint">(optional)</span></label>
                    <input
                      id="ig-f-gst" className="ig-input" type="text" placeholder="27ABCDE1234F1Z5"
                      value={invoice.from.gstin}
                      onChange={(e) => patchGroup('from', { gstin: e.target.value.toUpperCase() })}
                    />
                    {gstinHint(invoice.from.gstin, fromGstState)}
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-f-pan">PAN <span className="ig-hint">(optional)</span></label>
                    <input
                      id="ig-f-pan" className="ig-input" type="text"
                      value={invoice.from.pan}
                      onChange={(e) => patchGroup('from', { pan: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>
              </div>

              {/* Billed to */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><UserRound size={15} /> Billed to (client)</h2>
                <div className="ig-grid">
                  <div className="ig-field ig-span">
                    <label className="ig-label" htmlFor="ig-t-name">Client name</label>
                    <input
                      id="ig-t-name" className="ig-input" type="text" placeholder="Client or company"
                      value={invoice.to.name}
                      onChange={(e) => patchGroup('to', { name: e.target.value })}
                    />
                  </div>
                  <div className="ig-field ig-span">
                    <label className="ig-label" htmlFor="ig-t-addr">Address</label>
                    <textarea
                      id="ig-t-addr" className="ig-textarea" placeholder={'Street\nCity, State — PIN'}
                      value={invoice.to.address}
                      onChange={(e) => patchGroup('to', { address: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-t-email">Email</label>
                    <input
                      id="ig-t-email" className="ig-input" type="email"
                      value={invoice.to.email}
                      onChange={(e) => patchGroup('to', { email: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-t-gst">Client GSTIN <span className="ig-hint">(optional)</span></label>
                    <input
                      id="ig-t-gst" className="ig-input" type="text" placeholder="29ABCDE1234F1Z5"
                      value={invoice.to.gstin}
                      onChange={(e) => patchGroup('to', { gstin: e.target.value.toUpperCase() })}
                    />
                    {gstinHint(invoice.to.gstin, toGstState)}
                  </div>
                </div>
              </div>

              {/* Line items */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><ListOrdered size={15} /> Items</h2>
                <div className="ig-items">
                  <div className="ig-item-head">
                    <span>Description</span><span>Qty</span><span>Rate</span><span />
                  </div>
                  {invoice.items.map((it) => (
                    <div className="ig-item" key={it.id}>
                      <input
                        className="ig-input" type="text" placeholder="Website design — 4 pages"
                        aria-label="Item description"
                        value={it.description}
                        onChange={(e) => updateItem(it.id, { description: e.target.value })}
                      />
                      <input
                        className="ig-input ig-item-num" type="number" min="0" step="any"
                        aria-label="Quantity"
                        value={it.qty}
                        onChange={(e) => updateItem(it.id, { qty: e.target.value })}
                      />
                      <input
                        className="ig-input ig-item-num" type="number" min="0" step="any"
                        aria-label="Rate"
                        value={it.rate}
                        onChange={(e) => updateItem(it.id, { rate: e.target.value })}
                      />
                      <button
                        type="button" className="ig-icon-btn"
                        onClick={() => removeItem(it.id)}
                        disabled={invoice.items.length === 1}
                        aria-label="Remove item"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="ig-add-btn" onClick={addItem}>
                    <Plus size={15} /> Add item
                  </button>
                </div>
              </div>

              {/* Discount & tax */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><Percent size={15} /> Discount &amp; tax</h2>

                <div className="ig-grid">
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-disc">Discount</label>
                    <input
                      id="ig-disc" className="ig-input" type="number" min="0" step="any"
                      value={invoice.discount.value}
                      onChange={(e) => patchGroup('discount', { value: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <span className="ig-label">Discount type</span>
                    <div className="ig-seg">
                      <button
                        type="button" className={invoice.discount.type === 'percent' ? 'on' : ''}
                        onClick={() => patchGroup('discount', { type: 'percent' })}
                      >Percent</button>
                      <button
                        type="button" className={invoice.discount.type === 'flat' ? 'on' : ''}
                        onClick={() => patchGroup('discount', { type: 'flat' })}
                      >Flat</button>
                    </div>
                  </div>

                  <div className="ig-field ig-span">
                    <span className="ig-label">Tax</span>
                    <div className="ig-seg">
                      <button
                        type="button" className={invoice.tax.mode === 'none' ? 'on' : ''}
                        onClick={() => patchGroup('tax', { mode: 'none' })}
                      >No tax</button>
                      <button
                        type="button" className={invoice.tax.mode === 'gst' ? 'on' : ''}
                        onClick={() => patchGroup('tax', { mode: 'gst' })}
                      >GST (India)</button>
                      <button
                        type="button" className={invoice.tax.mode === 'simple' ? 'on' : ''}
                        onClick={() => patchGroup('tax', { mode: 'simple' })}
                      >Other tax</button>
                    </div>
                  </div>

                  {isGst && (
                    <>
                      <div className="ig-field">
                        <label className="ig-label" htmlFor="ig-gst-rate">GST rate</label>
                        <select
                          id="ig-gst-rate" className="ig-select"
                          value={invoice.tax.rate}
                          onChange={(e) => patchGroup('tax', { rate: Number(e.target.value) })}
                        >
                          {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </div>
                      <div className="ig-field">
                        <span className="ig-label">Place of supply</span>
                        <div className="ig-seg">
                          <button
                            type="button" className={invoice.tax.supply === 'auto' ? 'on' : ''}
                            onClick={() => patchGroup('tax', { supply: 'auto' })}
                          >Auto</button>
                          <button
                            type="button" className={invoice.tax.supply === 'intra' ? 'on' : ''}
                            onClick={() => patchGroup('tax', { supply: 'intra' })}
                          >Same state</button>
                          <button
                            type="button" className={invoice.tax.supply === 'inter' ? 'on' : ''}
                            onClick={() => patchGroup('tax', { supply: 'inter' })}
                          >Other state</button>
                        </div>
                        <span className="ig-hint">
                          {supply === 'intra'
                            ? 'Charging CGST + SGST'
                            : 'Charging IGST'}
                          {invoice.tax.supply === 'auto' && ' (from the two GSTINs)'}
                        </span>
                      </div>
                    </>
                  )}

                  {invoice.tax.mode === 'simple' && (
                    <>
                      <div className="ig-field">
                        <label className="ig-label" htmlFor="ig-tax-label">Tax name</label>
                        <input
                          id="ig-tax-label" className="ig-input" type="text" placeholder="VAT"
                          value={invoice.tax.label}
                          onChange={(e) => patchGroup('tax', { label: e.target.value })}
                        />
                      </div>
                      <div className="ig-field">
                        <label className="ig-label" htmlFor="ig-tax-rate">Rate (%)</label>
                        <input
                          id="ig-tax-rate" className="ig-input" type="number" min="0" step="any"
                          value={invoice.tax.rate}
                          onChange={(e) => patchGroup('tax', { rate: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Payment details */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><Landmark size={15} /> How to pay you</h2>
                <div className="ig-grid">
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-p-acname">Account name</label>
                    <input
                      id="ig-p-acname" className="ig-input" type="text"
                      value={invoice.payment.accountName}
                      onChange={(e) => patchGroup('payment', { accountName: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-p-bank">Bank</label>
                    <input
                      id="ig-p-bank" className="ig-input" type="text"
                      value={invoice.payment.bankName}
                      onChange={(e) => patchGroup('payment', { bankName: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-p-acno">Account number</label>
                    <input
                      id="ig-p-acno" className="ig-input" type="text"
                      value={invoice.payment.accountNumber}
                      onChange={(e) => patchGroup('payment', { accountNumber: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-p-ifsc">IFSC</label>
                    <input
                      id="ig-p-ifsc" className="ig-input" type="text"
                      value={invoice.payment.ifsc}
                      onChange={(e) => patchGroup('payment', { ifsc: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div className="ig-field ig-span">
                    <label className="ig-label" htmlFor="ig-p-upi">UPI ID</label>
                    <input
                      id="ig-p-upi" className="ig-input" type="text" placeholder="you@bank"
                      value={invoice.payment.upi}
                      onChange={(e) => patchGroup('payment', { upi: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="ig-panel">
                <h2 className="ig-panel-h"><StickyNote size={15} /> Notes &amp; terms</h2>
                <div className="ig-grid one">
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-notes">Notes to the client</label>
                    <textarea
                      id="ig-notes" className="ig-textarea"
                      placeholder="Thanks for your business!"
                      value={invoice.notes}
                      onChange={(e) => patch({ notes: e.target.value })}
                    />
                  </div>
                  <div className="ig-field">
                    <label className="ig-label" htmlFor="ig-terms">Terms</label>
                    <textarea
                      id="ig-terms" className="ig-textarea"
                      placeholder="Payment due within 15 days."
                      value={invoice.terms}
                      onChange={(e) => patch({ terms: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ============ PREVIEW ============ */}
            <div className="ig-preview">
              <div className="ig-actions">
                <button type="button" className="btn btn-primary" onClick={handlePrint}>
                  <Download size={17} /> Download PDF
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleReset}>
                  <RotateCcw size={16} /> Start over
                </button>
                {savedFlash && (
                  <span className="ig-saved"><Check size={15} /> Saved on this device</span>
                )}
              </div>

              {/* On-screen preview. The printed copy is a separate portal
                  below — see the note there for why. */}
              <div className="ig-sheet-scroll">
                <InvoiceDocument invoice={invoice} totals={totals} />
              </div>

              {history.length > 0 && (
                <div className="ig-history">
                  <span className="ig-history-h">Recent on this device</span>
                  {history.map((h) => (
                    <button
                      key={h.id} type="button" className="ig-hist-item"
                      onClick={() => setInvoice(h.invoice)}
                    >
                      <span>
                        <b>{h.invoiceNumber}</b>
                        <span className="ig-hist-meta"> · {h.clientName}</span>
                      </span>
                      <span>{money(h.total, h.currency)}</span>
                    </button>
                  ))}
                </div>
              )}

            </div>
          </div>
        </section>
      </main>

      <footer className="app-foot">
        <div className="app-wrap">
          MIT licensed · open source ·{' '}
          <a href="https://github.com/myainor/invoice-generator" target="_blank" rel="noopener noreferrer">
            Contribute on GitHub
          </a>
        </div>
      </footer>

      {/* The copy that actually prints. It lives directly under <body>, not
          inside the layout: the preview column is position: sticky (a
          containing block), and hiding siblings with visibility leaves their
          layout boxes behind and pads the job with blank pages. As a
          body-level sibling, print CSS can simply drop everything beside it. */}
      {createPortal(
        <div className="ig-print-portal" aria-hidden="true">
          <InvoiceDocument invoice={invoice} totals={totals} />
        </div>,
        document.body,
      )}
    </div>
  );
}
