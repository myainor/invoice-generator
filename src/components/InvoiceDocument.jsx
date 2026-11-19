/**
 * The invoice sheet itself — pure presentation, no state.
 *
 * Print-first: renders as a white A4 page. Every number comes from
 * `computeTotals`; nothing is recalculated here.
 */
import { money, amountInWords, displayDate, gstStateOf } from '../lib/invoiceModel';

function Party({ label, party, showGstin }) {
  const lines = String(party?.address || '').split('\n').filter(Boolean);
  return (
    <div className="igd-party">
      <span className="igd-party-label">{label}</span>
      <span className="igd-party-name">{party?.name || <em className="igd-ph">—</em>}</span>
      {lines.map((line, i) => <span key={i} className="igd-party-line">{line}</span>)}
      {party?.email && <span className="igd-party-line">{party.email}</span>}
      {party?.phone && <span className="igd-party-line">{party.phone}</span>}
      {showGstin && party?.gstin && (
        <span className="igd-party-line igd-party-tax">GSTIN: {party.gstin.toUpperCase()}</span>
      )}
      {showGstin && party?.pan && (
        <span className="igd-party-line igd-party-tax">PAN: {party.pan.toUpperCase()}</span>
      )}
    </div>
  );
}

export default function InvoiceDocument({ invoice, totals }) {
  const isGst = invoice.tax?.mode === 'gst';
  const currency = invoice.currency;
  const brand = invoice.branding?.brandColor || '#3b82f6';
  const placeOfSupply = isGst ? gstStateOf(invoice.to?.gstin) : null;
  const words = amountInWords(totals.total, currency);

  const hasPayment = Object.values(invoice.payment || {}).some((v) => String(v || '').trim());

  return (
    <article className="igd" style={{ '--igd-brand': brand }}>
      {/* ── Masthead ─────────────────────────────── */}
      <header className="igd-head">
        <div className="igd-head-brand">
          {invoice.branding?.logoDataUrl ? (
            <img src={invoice.branding.logoDataUrl} alt="" className="igd-logo" />
          ) : null}
          <span className="igd-biz">
            {invoice.branding?.businessName || invoice.from?.name || 'Your business'}
          </span>
        </div>
        <div className="igd-head-meta">
          <h1 className="igd-doc-title">{isGst ? 'Tax Invoice' : 'Invoice'}</h1>
          <span className="igd-doc-no">{invoice.invoiceNumber || '—'}</span>
        </div>
      </header>

      <div className="igd-rule" />

      {/* ── Parties + dates ──────────────────────── */}
      <section className="igd-parties">
        <Party label="Billed by" party={invoice.from} showGstin={isGst} />
        <Party label="Billed to" party={invoice.to} showGstin={isGst} />
        <div className="igd-party igd-dates">
          <span className="igd-party-label">Details</span>
          <span className="igd-kv"><b>Issued</b>{displayDate(invoice.issueDate)}</span>
          <span className="igd-kv"><b>Due</b>{displayDate(invoice.dueDate)}</span>
          {placeOfSupply && (
            <span className="igd-kv"><b>Place of supply</b>{placeOfSupply}</span>
          )}
        </div>
      </section>

      {/* ── Line items ───────────────────────────── */}
      <table className="igd-table">
        <thead>
          <tr>
            <th className="igd-c-idx">#</th>
            <th>Description</th>
            <th className="igd-c-num">Qty</th>
            <th className="igd-c-num">Rate</th>
            <th className="igd-c-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {totals.lines.length === 0 ? (
            <tr><td colSpan={5} className="igd-empty">No items yet</td></tr>
          ) : totals.lines.map((line, i) => (
            <tr key={line.id}>
              <td className="igd-c-idx">{i + 1}</td>
              <td className="igd-c-desc">
                {line.description || <em className="igd-ph">Item description</em>}
              </td>
              <td className="igd-c-num">{Number(line.qty) || 0}</td>
              <td className="igd-c-num">{money(line.rate, currency)}</td>
              <td className="igd-c-num igd-c-amt">{money(line.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Totals ───────────────────────────────── */}
      <section className="igd-totals-wrap">
        <div className="igd-totals">
          <div className="igd-t-row">
            <span>Subtotal</span><span>{money(totals.subtotal, currency)}</span>
          </div>

          {totals.discountAmount > 0 && (
            <div className="igd-t-row">
              <span>
                Discount
                {totals.discountType === 'percent' ? ` (${totals.discountValue}%)` : ''}
              </span>
              <span>− {money(totals.discountAmount, currency)}</span>
            </div>
          )}

          {totals.taxLines.length > 0 && (
            <div className="igd-t-row igd-t-muted">
              <span>Taxable value</span><span>{money(totals.taxable, currency)}</span>
            </div>
          )}

          {totals.taxLines.map((t) => (
            <div className="igd-t-row" key={t.key}>
              <span>{t.label}</span><span>{money(t.amount, currency)}</span>
            </div>
          ))}

          {totals.roundOff !== 0 && (
            <div className="igd-t-row igd-t-muted">
              <span>Round off</span>
              <span>{totals.roundOff > 0 ? '+' : '−'} {money(Math.abs(totals.roundOff), currency)}</span>
            </div>
          )}

          <div className="igd-t-row igd-t-grand">
            <span>Total due</span><span>{money(totals.total, currency)}</span>
          </div>
        </div>
      </section>

      {words && (
        <p className="igd-words"><b>Amount in words:</b> {words}</p>
      )}

      {/* ── Payment + terms ──────────────────────── */}
      {(hasPayment || invoice.notes || invoice.terms) && (
        <section className="igd-foot-grid">
          {hasPayment && (
            <div className="igd-block">
              <span className="igd-block-h">Payment details</span>
              {invoice.payment.accountName && <span>{invoice.payment.accountName}</span>}
              {invoice.payment.bankName && <span>{invoice.payment.bankName}</span>}
              {invoice.payment.accountNumber && <span>A/C: {invoice.payment.accountNumber}</span>}
              {invoice.payment.ifsc && <span>IFSC: {invoice.payment.ifsc.toUpperCase()}</span>}
              {invoice.payment.upi && <span>UPI: {invoice.payment.upi}</span>}
            </div>
          )}
          {invoice.notes && (
            <div className="igd-block">
              <span className="igd-block-h">Notes</span>
              <span className="igd-prewrap">{invoice.notes}</span>
            </div>
          )}
          {invoice.terms && (
            <div className="igd-block">
              <span className="igd-block-h">Terms</span>
              <span className="igd-prewrap">{invoice.terms}</span>
            </div>
          )}
        </section>
      )}
    </article>
  );
}
