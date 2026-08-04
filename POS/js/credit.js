'use strict';

const Credit = (() => {
  function render(container) {
    const s = Auth.getSession();
    const isAdmin = s?.role === 'admin';
    const allCredit = Data.getSales().filter(sale => sale.payment === 'CREDIT');
    const viewCredit = isAdmin ? allCredit : allCredit.filter(sale => sale.staff === s.staffName);

    const outstanding = viewCredit.filter(s => !s.creditPaid).slice().reverse();
    const paid        = viewCredit.filter(s => s.creditPaid).slice().reverse();

    const outTotal = outstanding.reduce((a, s) => a + (s.amount || 0), 0);
    const paidTotal = paid.reduce((a, s) => a + (s.amount || 0), 0);

    const outCols = ['DATE', 'CUSTOMER', 'PHONE', 'AMOUNT', 'PRODUCT', isAdmin ? 'STAFF' : null, 'ACTION'].filter(Boolean);
    const outRows = outstanding.map(sale => {
      const row = [
        sale.date,
        UI.esc(sale.customer),
        sale.phone,
        UI.fmtCurrency(sale.amount),
        UI.esc(sale.product),
        ...(isAdmin ? [sale.staff] : []),
        `<button class="btn btn-xs btn-ok" onclick="Credit.markPaid('${sale.id}')">MARK PAID</button>`,
      ];
      return row;
    });

    const paidCols = ['DATE', 'PAID ON', 'CUSTOMER', 'AMOUNT', 'PRODUCT', isAdmin ? 'STAFF' : null].filter(Boolean);
    const paidRows = paid.map(sale => [
      sale.date,
      sale.creditPaidAt ? Data.fmtDate(sale.creditPaidAt) : '—',
      UI.esc(sale.customer),
      UI.fmtCurrency(sale.amount),
      UI.esc(sale.product),
      ...(isAdmin ? [sale.staff] : []),
    ]);

    container.innerHTML = `
      <div class="content-inner">
        ${UI.panel('OUTSTANDING CREDIT', `
          <div class="credit-summary">
            <span class="credit-summary-label">TOTAL OUTSTANDING</span>
            <span class="credit-summary-value ${outTotal > 0 ? 'credit-summary-amber' : ''}">${UI.fmtCurrency(outTotal)}</span>
          </div>
          ${UI.table(outCols, outRows, 'No outstanding credit.')}
        `)}

        ${UI.panel('PAID CREDIT', `
          <div class="credit-summary">
            <span class="credit-summary-label">TOTAL RECOVERED</span>
            <span class="credit-summary-value">${UI.fmtCurrency(paidTotal)}</span>
          </div>
          ${UI.table(paidCols, paidRows, 'No paid credit yet.')}
        `)}
      </div>
    `;
  }

  async function markPaid(saleId) {
    const sale = Data.getSales().find(s => s.id === saleId);
    if (!sale) return;
    const ok = await UI.confirm(`Mark ${UI.esc(sale.customer)}'s ${UI.fmtCurrency(sale.amount)} as paid?`);
    if (!ok) return;
    Data.markCreditPaid(saleId);
    UI.toast(`${sale.customer} — marked as paid`, 'success');
    Data.processQueue();
    UI.navigate('credit');
  }

  return { render, markPaid };
})();
