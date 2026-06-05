'use strict';

const Reports = (() => {
  function render(container) {
    const sales     = Data.getSales();
    const customers = Data.getCustomers();

    const monthly   = getMonthlyData(sales);
    const products  = getProductStats(sales);
    const staffStats = getStaffStats(sales);
    const custStats = getCustomerStats(sales, customers);

    container.innerHTML = `
      <div class="content-inner">
        <div class="report-actions">
          <button class="btn btn-sm" id="btn-export-report">EXPORT FULL REPORT (CSV)</button>
        </div>

        ${UI.panel('MONTHLY REVENUE', `
          <div class="chart-area">
            <pre class="ascii-chart">${renderRevenueChart(monthly)}</pre>
          </div>
        `)}

        ${UI.panel('CASH VS EFT BY MONTH', `
          <div class="chart-area">
            <pre class="ascii-chart">${renderCashEFTChart(monthly)}</pre>
          </div>
        `)}

        ${UI.panel('TOP PRODUCTS BY UNITS SOLD', `
          ${UI.table(
            ['PRODUCT','CATEGORY','UNITS SOLD','REVENUE'],
            products.slice(0,10).map(p => [UI.esc(p.name), p.category, p.unitsSold, UI.fmtCurrency(p.revenue)])
          )}
        `)}

        ${UI.panel('STAFF PERFORMANCE', `
          ${UI.table(
            ['STAFF','SALES','REVENUE','CASH','EFT','AVG SALE'],
            staffStats.map(s => [s.name, s.count, UI.fmtCurrency(s.revenue),
              UI.fmtCurrency(s.cash), UI.fmtCurrency(s.eft),
              UI.fmtCurrency(s.count ? s.revenue / s.count : 0)])
          )}
        `)}

        ${UI.panel('NEW VS RETURNING CUSTOMERS BY MONTH', `
          ${UI.table(
            ['MONTH','NEW','RETURNING','TOTAL SALES'],
            Object.entries(custStats).sort((a,b) => b[0].localeCompare(a[0])).map(([month, d]) =>
              [month, d.newCount, d.returningCount, d.totalSales]
            )
          )}
        `)}
      </div>
    `;

    document.getElementById('btn-export-report').addEventListener('click', () => exportReport(sales, products, staffStats, monthly));
  }

  function getMonthlyData(sales) {
    const months = {};
    sales.forEach(s => {
      const parts = (s.date || '').split('/');
      if (parts.length < 3) return;
      const key = `${parts[2]}-${parts[1]}`;
      const label = `${monthName(parseInt(parts[1],10))} ${parts[2]}`;
      if (!months[key]) months[key] = { key, label, revenue: 0, cash: 0, eft: 0, count: 0 };
      months[key].revenue += s.amount || 0;
      months[key].count++;
      if (s.payment === 'CASH') months[key].cash += s.amount || 0;
      else months[key].eft += s.amount || 0;
    });
    return Object.values(months).sort((a,b) => a.key.localeCompare(b.key));
  }

  function monthName(n) {
    return ['','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][n] || '';
  }

  function renderRevenueChart(monthly) {
    if (!monthly.length) return 'No data';
    const maxVal = Math.max(...monthly.map(m => m.revenue));
    const BAR_W = 30;
    return monthly.map(m => {
      const barLen = maxVal > 0 ? Math.round((m.revenue / maxVal) * BAR_W) : 0;
      const bar = '█'.repeat(barLen).padEnd(BAR_W);
      const label = m.label.padEnd(12).substring(0,12);
      const value = UI.fmtCurrency(m.revenue).padStart(10);
      return `${label} ${bar} ${value}`;
    }).join('\n');
  }

  function renderCashEFTChart(monthly) {
    if (!monthly.length) return 'No data';
    const header = `${'MONTH'.padEnd(12)} ${'CASH'.padEnd(20)} ${'EFT'.padEnd(20)}`;
    const sep = '-'.repeat(55);
    const rows = monthly.map(m => {
      const maxCE = Math.max(m.cash, m.eft, 1);
      const cBar = '▓'.repeat(Math.round((m.cash/maxCE)*18)).padEnd(18);
      const eBar = '░'.repeat(Math.round((m.eft /maxCE)*18)).padEnd(18);
      const label = m.label.padEnd(12).substring(0,12);
      return `${label} ${cBar} ${UI.fmtCurrency(m.cash).padStart(8)} | ${eBar} ${UI.fmtCurrency(m.eft).padStart(8)}`;
    });
    return [header, sep, ...rows].join('\n');
  }

  function getProductStats(sales) {
    const stats = {};
    sales.forEach(s => {
      if (!s.product) return;
      const k = s.product;
      if (!stats[k]) stats[k] = { name: s.product, category: s.category||'Uncategorised', unitsSold: 0, revenue: 0 };
      stats[k].unitsSold += s.qty || 0;
      stats[k].revenue  += s.amount || 0;
    });
    return Object.values(stats).sort((a,b) => b.unitsSold - a.unitsSold);
  }

  function getStaffStats(sales) {
    const stats = {};
    sales.forEach(s => {
      const k = s.staff || 'Unknown';
      if (!stats[k]) stats[k] = { name: k, count: 0, revenue: 0, cash: 0, eft: 0 };
      stats[k].count++;
      stats[k].revenue += s.amount || 0;
      if (s.payment === 'CASH') stats[k].cash += s.amount || 0;
      else stats[k].eft += s.amount || 0;
    });
    return Object.values(stats).sort((a,b) => b.revenue - a.revenue);
  }

  function getCustomerStats(sales, customers) {
    const firstPurchase = {};
    customers.forEach(c => {
      if (c.firstPurchase) {
        const d = new Date(c.firstPurchase);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        firstPurchase[c.phone] = key;
      }
    });

    const monthStats = {};
    sales.forEach(s => {
      const parts = (s.date||'').split('/');
      if (parts.length < 3) return;
      const key = `${parts[2]}-${parts[1]}`;
      if (!monthStats[key]) monthStats[key] = { newCount: 0, returningCount: 0, totalSales: 0 };
      monthStats[key].totalSales++;
      if (s.phone && firstPurchase[s.phone] === key) monthStats[key].newCount++;
      else monthStats[key].returningCount++;
    });
    return monthStats;
  }

  function exportReport(sales, products, staffStats, monthly) {
    const s = Auth.getSession();
    Data.addAudit('EXPORT_CSV', 'Full report exported', s?.staffId);

    let csv = '=== SMOKE420 FULL REPORT ===\n\n';

    csv += '=== MONTHLY REVENUE ===\n';
    csv += 'Month,Revenue,Cash,EFT,Sales Count\n';
    monthly.forEach(m => { csv += `${m.label},${m.revenue},${m.cash},${m.eft},${m.count}\n`; });

    csv += '\n=== PRODUCTS ===\n';
    csv += 'Product,Category,Units Sold,Revenue\n';
    products.forEach(p => { csv += `"${p.name}","${p.category}",${p.unitsSold},${p.revenue}\n`; });

    csv += '\n=== STAFF PERFORMANCE ===\n';
    csv += 'Staff,Sales,Revenue,Cash,EFT\n';
    staffStats.forEach(st => { csv += `${st.name},${st.count},${st.revenue},${st.cash},${st.eft}\n`; });

    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `smoke420_report_${Data.fmtDate(new Date()).replace(/\//g,'-')}.csv`;
    a.click();

    UI.toast('Report exported', 'success');
  }

  return { render };
})();
