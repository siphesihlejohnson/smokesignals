'use strict';

const CashUp = (() => {
  function render(container) {
    const s = Auth.getSession();
    const isAdmin = s?.role === 'admin';
    const today = Data.fmtDate(new Date());
    const allToday = Data.getSales().filter(sale => sale.date === today);
    const viewSales = isAdmin ? allToday : allToday.filter(sale => sale.staff === s.staffName);

    const totals = calcTotals(viewSales);

    let staffBreakdown = '';
    if (isAdmin && allToday.length) {
      const byStaff = {};
      allToday.forEach(sale => {
        const k = sale.staff || 'Unknown';
        if (!byStaff[k]) byStaff[k] = [];
        byStaff[k].push(sale);
      });
      staffBreakdown = UI.panel('STAFF BREAKDOWN', UI.table(
        ['STAFF', 'SALES', 'CASH', 'EFT', 'CREDIT', 'RECEIVED'],
        Object.entries(byStaff).map(([name, sales]) => {
          const t = calcTotals(sales);
          return [name, t.count, UI.fmtCurrency(t.cash), UI.fmtCurrency(t.eft),
            UI.fmtCurrency(t.credit), UI.fmtCurrency(t.received)];
        })
      ));
    }

    container.innerHTML = `
      <div class="content-inner">
        ${UI.panel(`CASH-UP — ${today}`, `
          <div class="stats-row">
            <div class="stat-card">
              <div class="stat-label">TOTAL SALES</div>
              <div class="stat-value">${totals.count}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">CASH</div>
              <div class="stat-value">${UI.fmtCurrency(totals.cash)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">EFT</div>
              <div class="stat-value">${UI.fmtCurrency(totals.eft)}</div>
            </div>
            <div class="stat-card stat-card-amber">
              <div class="stat-label">CREDIT GIVEN</div>
              <div class="stat-value stat-value-amber">${UI.fmtCurrency(totals.credit)}</div>
            </div>
            <div class="stat-card stat-card-hi">
              <div class="stat-label">NET RECEIVED</div>
              <div class="stat-value">${UI.fmtCurrency(totals.received)}</div>
            </div>
          </div>
        `)}

        ${staffBreakdown}

        ${UI.panel("TODAY'S SALES", UI.table(
          isAdmin
            ? ['TIME', 'PRODUCT', 'QTY', 'CUSTOMER', 'PAY', 'AMOUNT', 'STAFF']
            : ['TIME', 'PRODUCT', 'QTY', 'CUSTOMER', 'PAY', 'AMOUNT'],
          viewSales.slice().reverse().map(sale => {
            const payBadge = sale.payment === 'CREDIT'
              ? '<span class="badge badge-low">CREDIT</span>'
              : sale.payment;
            const row = [sale.time, UI.esc(sale.product), sale.qty, UI.esc(sale.customer),
              payBadge, UI.fmtCurrency(sale.amount)];
            if (isAdmin) row.push(sale.staff);
            return row;
          }),
          'No sales today.'
        ))}
      </div>
    `;
  }

  function calcTotals(sales) {
    const cash   = sales.filter(s => s.payment === 'CASH').reduce((a, s) => a + (s.amount || 0), 0);
    const eft    = sales.filter(s => s.payment === 'EFT').reduce((a, s) => a + (s.amount || 0), 0);
    const credit = sales.filter(s => s.payment === 'CREDIT').reduce((a, s) => a + (s.amount || 0), 0);
    return { count: sales.length, cash, eft, credit, received: cash + eft };
  }

  return { render };
})();
