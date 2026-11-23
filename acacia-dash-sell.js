/* Acacia Sell — dashboard rebuilt to the suite design. Loaded after script.js; replaces renderDashboard(). */
(function(){
  var D = window.AcxDash, E = D.esc;
  function sum(a,f){ return a.reduce(function(s,x){ return s+(Number(f(x))||0); },0); }
  var ST = {Paid:'g',Delivered:'g',Accepted:'g',Confirmed:'b',Sent:'b',Packed:'o','Partially Paid':'o',Pending:'o',Draft:'m',Overdue:'r',Cancelled:'r',Rejected:'r'};

  window.renderDashboard = function(){
    var per = D.getPeriod('sell','month'), cur = D.range(per,0), prv = D.range(per,1);
    var inv = DB.invoices||[], ord = DB.orders||[];
    var iC = inv.filter(function(i){return D.within(i.date,cur);}), iP = inv.filter(function(i){return D.within(i.date,prv);});
    var oC = ord.filter(function(o){return D.within(o.date,cur);}), oP = ord.filter(function(o){return D.within(o.date,prv);});
    var sales = sum(iC,function(i){return i.total;}), psales = sum(iP,function(i){return i.total;});
    var avg = iC.length ? sales/iC.length : 0, pavg = iP.length ? psales/iP.length : 0;
    var custC = {}; iC.forEach(function(i){custC[i.custId]=1;}); var custP = {}; iP.forEach(function(i){custP[i.custId]=1;});
    var vs = 'vs last ' + (per==='today'?'day':per);

    // 6-month sales trend (always monthly, ending this month)
    var labels=[], vals=[], n=new Date();
    for(var k=5;k>=0;k--){ var d=new Date(n.getFullYear(),n.getMonth()-k,1), key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      labels.push(d.toLocaleDateString('en-GB',{month:'short'})); vals.push(sum(inv.filter(function(i){return String(i.date).slice(0,7)===key;}),function(i){return i.total;})); }

    // top products by units sold in the period
    var sold = {}; iC.forEach(function(i){ (i.lines||[]).forEach(function(l){ sold[l.pid]=(sold[l.pid]||0)+(Number(l.qty)||0); }); });
    var top = (DB.products||[]).map(function(p){ return {p:p,q:sold[p.id]||0}; }).filter(function(x){return x.q>0;}).sort(function(a,b){return b.q-a.q;}).slice(0,5);
    var topH = top.length ? top.map(function(x){ return '<div class="ad-rank"><div class="ad-thumb">'+D.icon('box')+'</div><span>'+E(x.p.name)+'</span><b>'+D.num(x.q)+'</b></div>'; }).join('') : '<div class="ad-empty">No product sales in this period.</div>';

    var recent = ord.slice().sort(function(a,b){return String(b.date).localeCompare(String(a.date));}).slice(0,5);
    var recH = recent.length ? '<div class="ad-scroll"><table class="ad-tbl"><thead><tr><th>Order #</th><th>Customer</th><th class="r">Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>'
      + recent.map(function(o){ return '<tr><td>'+E(o.id)+'</td><td>'+E(custName(o.custId))+'</td><td class="r">'+D.money(o.total)+'</td><td>'+D.pill(o.status,ST[o.status])+'</td><td>'+E(D.dstr(o.date,{day:'numeric',month:'short'}))+'</td></tr>'; }).join('')
      + '</tbody></table></div>' : '<div class="ad-empty">No orders yet. Create a sale to see it here.</div>';

    var kp = [
      D.kpi({icon:'cart',color:'green',label:'Total Sales',value:D.money(sales),delta:D.delta(sales,psales,vs)}),
      D.kpi({icon:'bag',color:'blue',label:'Orders',value:D.num(oC.length),delta:D.delta(oC.length,oP.length,vs)}),
      D.kpi({icon:'users',color:'green',label:'Customers',value:D.num(Object.keys(custC).length),delta:D.delta(Object.keys(custC).length,Object.keys(custP).length,vs)}),
      D.kpi({icon:'trend',color:'green',label:'Average Order',value:D.money(avg),delta:D.delta(avg,pavg,vs)})
    ].join('');

    return '<div class="ad">'
      + D.head({icon:'cart',title:'Sales Dashboard',sub:'Sell Smarter. Grow Faster.',right:D.periodSelect('sell',per)})
      + '<div class="ad-kpis">'+kp+'</div>'
      + '<div class="ad-row ad-r-32">'
        + D.card('Sales Trend', D.line(labels,vals,{pad:84,tipFmt:function(v){return D.money(v);}}), {icon:'trend'})
        + D.card('Top Products', topH, {icon:'tag'})
      + '</div>'
      + '<div class="ad-row ad-r-32">'
        + D.card('Recent Orders', recH, {icon:'receipt',right:'<button class="ad-link" onclick="goTo(\'orders\')">View all</button>'})
        + D.promo({icon:'cart',title:'Grow Your Sales',text:'Offer special discounts for loyal customers.',btn:'Create Offer',on:"goTo('quotes')"})
      + '</div></div>';
  };
  D.onPeriod('sell', function(){ if(typeof currentPage!=='undefined' && currentPage==='dashboard') renderPage(); });
  function tag(){ D.polishTopbar('Sell Smarter. Grow Faster.', '.topbar'); }
  tag(); document.addEventListener('DOMContentLoaded', tag);
})();
