/* acacia-bridge-docs.js — brings Books' sales documents into Sell (same company), read-only from Books:
 *   Quotes, Orders, Bulk Invoicing, Credit Notes, Sales Returns, Receipts, Recurring Invoices, Delivery notes.
 * Needs acacia_sell_modules_read.sql (or the latest acacia_cross_app_sync.sql) run once in Supabase,
 * and acacia-bridge.js (customers/invoices/products) loaded before this file.
 * Books stays the owner of these records: they are created, updated and removed here when they change in Books.
 * Records you create in Sell are never touched. Books posts stock and ledger entries for these itself,
 * so nothing is pushed back (Sell payments still go to Books through the existing "payments to post" inbox). */
(function (w) {
  'use strict';
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var num = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  var r2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function hash(o) { var s = canon(o), x = 5381, i; for (i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return String(x >>> 0); }
  var isBooksCo = function (id) { return /^(ACC-\d+|company_[A-Za-z0-9_]+)$/i.test(String(id || '')); };
  function db() { try { return DB; } catch (e) { return null; } }
  function user() { try { return CURRENT_USER; } catch (e) { return null; } }
  var busy = false, KEYS = ['customers', 'invoices', 'quotes', 'orders', 'bulkInvoices', 'creditNotes', 'salesReturns', 'receipts', 'recurringInvoices', 'deliveries'];

  function parseRow(rows, k) {
    var r = rows[k]; if (!r) return null;
    try { var v = JSON.parse(r.value); if (typeof v === 'string') v = JSON.parse(v); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  var TODAY = function () { return new Date().toISOString().slice(0, 10); };
  var pick = function (o, ks) { for (var i = 0; i < ks.length; i++) { var v = o && o[ks[i]]; if (v != null && String(v).trim() !== '') return v; } return ''; };

  /* ---- lookups (customers / invoices / products are kept in step by acacia-bridge.js) ---- */
  function ctx(rows) {
    var d = db(), bkCust = parseRow(rows, 'customers') || [], nameById = {};
    bkCust.forEach(function (c) { if (c && c.id != null) nameById[String(c.id)] = c.name; });
    var bkInv = parseRow(rows, 'invoices') || [], invNoById = {};
    bkInv.forEach(function (i) { if (i && i.id != null) invNoById[String(i.id)] = i.invoiceNumber; });
    function cust(b) {
      var byLink = null, id = pick(b, ['customerId', 'custId']);
      if (id !== '') d.customers.forEach(function (c) { if (!byLink && c._bk && String(c._bk.id) === String(id)) byLink = c; });
      if (byLink) return byLink;
      var nm = pick(b, ['customerName', 'customer', 'name']);
      if (nm !== '' && nameById[String(nm)]) nm = nameById[String(nm)];       /* a Books customer id was stored instead of the name */
      if (id !== '' && nameById[String(id)] && !nm) nm = nameById[String(id)];
      var found = null; d.customers.forEach(function (c) { if (!found && nm !== '' && low(c.name) === low(nm)) found = c; });
      return found;
    }
    function invoice(b) {
      var no = pick(b, ['invoiceNumber', 'invoiceNo', 'invoiceRef']), bid = pick(b, ['invoiceId']);
      if (bid !== '' && invNoById[String(bid)] != null && no === '') no = invNoById[String(bid)];
      var f = null;
      d.invoices.forEach(function (i) {
        if (f) return;
        if (bid !== '' && i._bk && String(i._bk.id) === String(bid)) f = i;
        else if (no !== '' && (String(i.id) === String(no) || ('SL-' + i.id) === String(no) || ('B-' + no) === String(i.id))) f = i;
      });
      return f;
    }
    function lines(items) {
      return (items || []).map(function (i) {
        var nm = String(pick(i, ['product', 'name', 'itemName', 'desc', 'description']) || 'Item'), sku = pick(i, ['sku', 'code']);
        var qty = num(pick(i, ['qty', 'quantity'])) || 1, price = num(pick(i, ['price', 'unitPrice', 'rate', 'sellingPrice']));
        if (!price && num(i.subtotal) && qty) price = r2(num(i.subtotal) / qty);
        var p = null; d.products.forEach(function (x) { if (!p && ((sku && x.sku && low(x.sku) === low(sku)) || low(x.name) === low(nm))) p = x; });
        return { pid: p ? p.id : 'BK:' + nm, qty: qty, price: price, disc: num(i.discount) };
      });
    }
    return { cust: cust, invoice: invoice, lines: lines };
  }
  var tot = function (b) { var v = pick(b, ['totalKES', 'total', 'totalAmount', 'amount']); return num(v); };

  /* ---- one adapter per Books list: how to recognise, build and refresh the Sell record ---- */
  var MOD = {
    quotes: {
      list: function (d) { return d.quotes; }, no: function (b) { return String(pick(b, ['quoteNumber', 'number', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); if (!cu) return null;
        var st = low(b.status); return { id: id, custId: cu.id, lines: c.lines(b.items), status: st === 'converted' ? 'Accepted' : (b.status || 'Sent'), date: b.date || TODAY(), total: tot(b), converted: { order: null }, notes: b.notes || '' };
      },
      apply: function (r, n) { ['custId', 'lines', 'status', 'date', 'total', 'notes'].forEach(function (k) { r[k] = n[k]; }); }
    },
    orders: {
      list: function (d) { return d.orders; }, no: function (b) { return String(pick(b, ['number', 'orderNumber', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); if (!cu) return null;
        var st = String(b.status || ''), ok = ['Pending', 'Confirmed', 'Packed', 'Delivered', 'Cancelled'].filter(function (s) { return low(s) === low(st); })[0];
        return { id: id, custId: cu.id, lines: c.lines(b.items), status: ok || 'Pending', date: b.date || TODAY(), total: tot(b), converted: { invoice: null }, deliveryDate: b.deliveryDate || '', quoteRef: b.sourceQuoteNumber || '' };
      },
      apply: function (r, n) { ['custId', 'lines', 'status', 'date', 'total', 'deliveryDate'].forEach(function (k) { r[k] = n[k]; }); }
    },
    creditNotes: {
      list: function (d) { return d.creditNotes; }, no: function (b) { return String(pick(b, ['number', 'creditNoteNumber', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); if (!cu) return null; var inv = c.invoice(b);
        return { id: id, invoiceId: inv ? inv.id : String(pick(b, ['invoiceNumber', 'invoiceNo']) || '—'), custId: cu.id, amount: tot(b), reason: b.reason || '', date: b.date || TODAY() };
      },
      apply: function (r, n) { ['invoiceId', 'custId', 'amount', 'reason', 'date'].forEach(function (k) { r[k] = n[k]; }); }
    },
    salesReturns: {
      list: function (d) { return d.returns; }, no: function (b) { return String(pick(b, ['returnNumber', 'number', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); if (!cu) return null; var inv = c.invoice(b);
        return { id: id, invoiceId: inv ? inv.id : String(pick(b, ['invoiceNumber', 'invoiceNo', 'invoiceId']) || '—'), custId: cu.id, lines: c.lines(b.items), amount: tot(b), reason: b.reason || '', date: b.date || TODAY() };
      },
      apply: function (r, n) { ['invoiceId', 'custId', 'lines', 'amount', 'reason', 'date'].forEach(function (k) { r[k] = n[k]; }); }
    },
    receipts: {
      list: function (d) { return d.payments; }, no: function (b) { return String(pick(b, ['receiptNumber', 'number', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); if (!cu) return null; var inv = c.invoice(b);
        return { id: id, invoiceId: inv ? inv.id : String(pick(b, ['invoiceNumber', 'invoiceNo']) || '—'), custId: cu.id, amount: num(b.amount), method: String(pick(b, ['method', 'paymentMethod', 'bank']) || 'Receipt'), date: b.date || TODAY(), fromBooks: true };
      },
      apply: function (r, n) { ['invoiceId', 'custId', 'amount', 'method', 'date'].forEach(function (k) { r[k] = n[k]; }); },
      after: function (r) { var R = (db()._bkReg = db()._bkReg || {}); R.pay = R.pay || {}; R.pay[r.id] = 1; }   /* never send a Books receipt back to Books as a new payment */
    },
    recurringInvoices: {
      list: function (d) { return d.recurring; }, no: function (b) { return String(pick(b, ['number', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); if (!cu) return null; var ln = c.lines(b.items), first = ln[0] || { pid: '', qty: 1 };
        var t = low(b.recurrenceType), days = num(b.recurrenceDays);
        var freq = /week/.test(t) || days === 7 ? 'Weekly' : (/quarter/.test(t) || (days >= 85 && days <= 95) ? 'Quarterly' : 'Monthly');
        return { id: id, custId: cu.id, pid: first.pid, qty: first.qty, lines: ln, freq: freq, next: String(b.nextDate || b.date || TODAY()).slice(0, 10), fromBooks: true };
      },
      apply: function (r, n) { ['custId', 'pid', 'qty', 'lines', 'freq', 'next'].forEach(function (k) { r[k] = n[k]; }); }
    },
    deliveries: {
      list: function (d) { return d.deliveries; }, no: function (b) { return String(pick(b, ['dn', 'deliveryNumber', 'number', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); var inv = c.invoice(b);
        return { id: id, custId: cu ? cu.id : '', customer: String(pick(b, ['customerName', 'customer']) || ''), invoiceId: inv ? inv.id : String(pick(b, ['invoiceNumber', 'invoiceId']) || ''), date: b.date || TODAY(), track: b.trackNumber || '', location: b.location || '', truck: b.truckNumber || '', driver: b.driver || '', option: b.deliveryOption || '', notes: b.description || '' };
      },
      apply: function (r, n) { ['custId', 'customer', 'invoiceId', 'date', 'track', 'location', 'truck', 'driver', 'option', 'notes'].forEach(function (k) { r[k] = n[k]; }); }
    },
    bulkInvoices: {
      list: function (d) { return d.invoices; }, no: function (b) { return String(pick(b, ['invoiceNumber', 'invoiceNo', 'id'])); },
      make: function (b, c, id) {
        var cu = c.cust(b); if (!cu) return null; var ln = c.lines(b.items), sub = 0, disc = 0;
        ln.forEach(function (l) { sub += l.qty * l.price; disc += l.qty * l.price * (l.disc / 100); });
        var total = tot(b), paid = low(b.status) === 'paid' || b.paid === true ? total : Math.min(total, num(b.amountPaid));
        return { id: id, custId: cu.id, lines: ln, date: b.date || TODAY(), dueDate: b.dueDate || b.date || TODAY(), subtotal: sub, discount: disc, vat: num(b.vat), total: total, paid: paid, status: total > 0 && paid >= total ? 'Paid' : (paid > 0 ? 'Partially Paid' : 'Sent'), bulk: true };
      },
      apply: function (r, n) { ['custId', 'lines', 'date', 'dueDate', 'subtotal', 'discount', 'vat', 'total', 'paid', 'status'].forEach(function (k) { r[k] = n[k]; }); }
    }
  };

  /* ---- one pass for one Books list; returns {changed, count} ---- */
  function pass(key, rows, c, d) {
    var M = MOD[key], bArr = parseRow(rows, key), changed = false, list = M.list(d), count = 0;
    if (!bArr) return { changed: false, count: 0, missing: true };      /* Books has no row for it yet: nothing to import, nothing may be removed */
    var seen = {};
    bArr.forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      var no = M.no(b); if (!no) return; seen[no] = 1; count++;
      var bh = hash(b), mine = null;
      list.forEach(function (r) { if (!mine && r._bkd && r._bkd.k === key && r._bkd.no === no) mine = r; });
      if (mine) {
        mine._bkd.m = 0;
        if (mine._bkd.h !== bh) {
          var n = M.make(b, c, mine.id); if (!n) return;
          M.apply(mine, n); mine._bkd.h = bh; if (M.after) M.after(mine); changed = true;
        }
        return;
      }
      var id = no, taken = list.some(function (x) { return x.id === id; }); if (taken) id = 'B-' + no;
      if (list.some(function (x) { return x.id === id; })) return;
      var rec = M.make(b, c, id); if (!rec) return;                    /* customer not here yet: try again next pass */
      rec._bkd = { k: key, no: no, h: bh, m: 0 };
      if (M.after) M.after(rec);
      list.unshift(rec); changed = true;
    });
    /* removed in Books (two passes in a row) -> remove here, unless something in Sell already uses it */
    list.slice().forEach(function (r) {
      if (!r._bkd || r._bkd.k !== key || seen[r._bkd.no]) return;
      r._bkd.m = (r._bkd.m || 0) + 1;
      if (r._bkd.m < 2) return;
      var used = (key === 'orders' && d.invoices.some(function (i) { return i.orderId === r.id; })) || (key === 'quotes' && d.orders.some(function (o) { return o.quoteId === r.id; }));
      if (used) return;
      var ix = list.indexOf(r); if (ix > -1) { list.splice(ix, 1); changed = true; }
    });
    return { changed: changed, count: count };
  }

  var LABEL = { quotes: 'quotes', orders: 'orders', bulkInvoices: 'bulk invoices', creditNotes: 'credit notes', salesReturns: 'returns', receipts: 'receipts', recurringInvoices: 'recurring', deliveries: 'deliveries' };
  async function sync() {
    if (busy) return; var u = user(), d = db();
    if (!u || !d || !w.AcaciaCloud || !isBooksCo(u.companyId) || !d.customers || !d.seq) return;
    busy = true;
    var st = (w.AcaciaBridge && w.AcaciaBridge.status && w.AcaciaBridge.status()) || {};
    try {
      d.creditNotes = d.creditNotes || []; d.recurring = d.recurring || []; d.deliveries = d.deliveries || []; d.returns = d.returns || []; d.payments = d.payments || [];
      var res = await w.AcaciaCloud.rpc('acx_books_read', { p_company: u.companyId, p_keys: KEYS }), rows = {};
      (res || []).forEach(function (r) { rows[r.key] = r; });
      var c = ctx(rows), any = false, parts = [];
      Object.keys(MOD).forEach(function (k) { var r = pass(k, rows, c, d); if (r.changed) any = true; if (r.count) parts.push(r.count + ' ' + LABEL[k]); });
      st.docs = parts.length ? 'From Books: ' + parts.join(', ') + '.' : 'Books has no quotes, orders, credit notes, returns, receipts, recurring or delivery notes for this company yet.';
      if (any) {
        try { saveCompanyData(); } catch (e) {}
        try { var a = document.activeElement; if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) renderPage(); } catch (e) {}
      }
    } catch (e) {
      console.error('[acacia-bridge-docs]', e);
      st.docs = 'Books documents did not sync: ' + String((e && (e.message || e.code)) || e) + (/function|schema cache|permission/i.test(String(e && e.message)) ? ' — run acacia_sell_modules_read.sql in Supabase.' : '');
    }
    busy = false;
  }

  /* Delivery page: keep the order tracker and add Books' delivery notes underneath */
  if (typeof w.renderDelivery === 'function' && !w.renderDelivery.__bk) {
    var _rd = w.renderDelivery;
    w.renderDelivery = function () {
      var html = _rd.apply(this, arguments), d = db(), list = (d && d.deliveries) || [];
      var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
      var cn = function (r) { try { return r.custId ? custName(r.custId) : (r.customer || '—'); } catch (e) { return r.customer || '—'; } };
      return html + '<div class="card" style="margin-top:16px"><div class="card-body flush table-scroll"><div style="padding:12px 16px;font-weight:600">Delivery notes from Books</div><table><thead><tr><th>Note</th><th>Customer</th><th>Invoice</th><th>Date</th><th>Tracking</th><th>Driver</th><th>Truck</th><th>Location</th></tr></thead><tbody>' +
        (list.map(function (r) { return '<tr><td>' + esc(r.id) + '</td><td>' + esc(cn(r)) + '</td><td>' + esc(r.invoiceId || '—') + '</td><td>' + esc(r.date) + '</td><td>' + esc(r.track || '—') + '</td><td>' + esc(r.driver || '—') + '</td><td>' + esc(r.truck || '—') + '</td><td>' + esc(r.location || '—') + '</td></tr>'; }).join('') || '<tr class="empty-row"><td colspan="8">No delivery notes from Books yet.</td></tr>') +
        '</tbody></table></div></div>';
    };
    w.renderDelivery.__bk = 1;
  }

  /* run after the main bridge has brought customers/invoices/products across */
  setTimeout(function wait() { if (user() && db()) sync(); setTimeout(wait, user() ? 25000 : 1800); }, 5000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(sync, 1500); });
  w.AcaciaBridgeDocs = { sync: sync };
})(window);
