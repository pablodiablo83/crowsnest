const fs=require('fs'),D=process.argv[2];
const X=JSON.parse(fs.readFileSync(D+'/data.json'));
const land=JSON.parse(fs.readFileSync('/home/user/crowsnest/public/atlantic/land.json'));
const R=X.rows, now=R[0];
const BC=['#2B6CB0','#2B6CB0','#2E8FA8','#2E8FA8','#3FA36B','#9BC34A','#E8C547','#F08A2C','#D6453A','#B02A6E','#8A2390','#6B1E8A','#4B1470'];
const BT=b=>b>=5&&b<=7?'#10151F':'#fff';
const day=t=>{const d=new Date(t);return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]+' '+d.getUTCDate()};
const hh=t=>t.slice(11,13)+':00';
const ll=(la,lo)=>{const f=(v,p,n)=>{const a=Math.abs(v),d=Math.floor(a),m=((a-d)*60).toFixed(0).padStart(2,'0');return d+'°'+m+'′'+(v>=0?p:n)};return f(la,'N','S')+' '+f(lo,'E','W')};
const squall=r=>r.cape>=1000&&r.r>=0.5;
// arrow pointing downwind (wd = from)
const arrow=(deg,sz,col)=>`<svg width="${sz}" height="${sz}" viewBox="-10 -10 20 20" style="transform:rotate(${deg+180}deg)"><path d="M0 -8 L5 2 L1.6 1 L1.6 8 L-1.6 8 L-1.6 1 L-5 2Z" fill="${col}"/></svg>`;
const worst=R.slice(1).reduce((a,b)=>(b.wg>a.wg?b:a));
const eta=R.find(r=>r.arr);

// ---------- Option A: Now + Ahead list ----------
const rowsA=R.filter(r=>r.h%12===0&&r.h>0&&!(r.arr&&r!==eta)).map(r=>`
 <div class="ar">
  <div class="aw"><b>${day(r.t)}</b><span>${hh(r.t)} · +${r.h} h</span></div>
  <div class="ab" style="background:${BC[r.bf]};color:${BT(r.bf)}">F${r.bf}</div>
  <div class="ad">${arrow(r.wdd,22,'#E9EFF2')}<div><b>${r.wd} ${r.ws}</b><span>gust ${r.wg}</span></div></div>
  <div class="as"><b>${r.hs} m</b><span>${r.tp} s</span></div>
  <div class="ax">${squall(r)?'<i>⚡︎ squalls</i>':''}${r.arr?'<i class="arr">Arrive</i>':''}</div>
 </div>`).join('');
const spark=R.filter(r=>!r.arr||r===eta).map(r=>`<i style="height:${8+r.wg*2.1}px;background:${BC[r.bf]}" title=""></i>`).join('');
const A=`
<div class="scr a">
 <div class="top"><span class="back">‹ Dashboard</span><span class="age">Forecast 8 h old · ECMWF</span></div>
 <div class="now">
  <div class="lab">NOW · YOUR POSITION · 18:00 UTC</div>
  <div class="pos">${ll(now.lat,now.lon)}</div>
  <div class="big"><div class="bf" style="background:${BC[now.bf]}">F${now.bf}</div>
   <div class="wind">${arrow(now.wdd,46,'#fff')}<div><b>${now.wd} ${now.ws}<small> kn</small></b><span>gusts ${now.wg} kn</span></div></div></div>
  <div class="trio"><div><span>Sea</span><b>${now.hs} m</b><em>${now.tp} s · from ${now.hd}</em></div><div><span>Swell</span><b>${now.sh} m</b><em>from ${now.sd}</em></div><div><span>Squalls</span><b class="${squall(now)?'warn':''}">${squall(now)?'Likely':'Unlikely'}</b><em>rain ${now.r} mm/6 h</em></div></div>
 </div>
 <div class="worst"><span>Worst ahead</span><b>${day(worst.t)} ${hh(worst.t)}: F${worst.bf}, gusts ${worst.wg} kn</b></div>
 <div class="sp"><div class="spb">${spark}</div><div class="spx"><span>Now</span><span>Wed</span><span>Thu</span><span>${day(eta.t).split(' ')[0]} ${hh(eta.t)} arrive</span></div></div>
 <div class="hd2"><b>Ahead on your route</b><span>at 6.5 kn · ${X.dist} nm to Rodney Bay ›</span></div>
 <div class="list">${rowsA}</div>
 <div class="mapbtn">Show on chart</div>
</div>`;

// ---------- Option B: one-layer chart + docked readout ----------
const W=390,H=360,LO0=-64.5,LO1=-46,LA0=8.5,LA1=22;
const kx=W/(LO1-LO0), ky=kx/Math.cos(15*Math.PI/180);
const Hh=(LA1-LA0)*ky, oy=(H-Hh)/2;
const px=lo=>(lo-LO0)*kx, py=la=>oy+(LA1-la)*ky;
let cells='';const col=v=>{const S=[[0,[38,58,128]],[6,[40,108,172]],[11,[36,158,166]],[16,[86,184,104]],[21,[232,206,66]],[27,[240,134,44]],[33,[214,52,52]],[40,[168,40,140]]];for(let i=1;i<S.length;i++)if(v<=S[i][0]){const t=(v-S[i-1][0])/(S[i][0]-S[i-1][0]);return 'rgb('+S[i][1].map((c,k)=>Math.round(S[i-1][1][k]+(c-S[i-1][1][k])*t)).join(',')+')'}return 'rgb(168,40,140)'};
for(const [la,lo,ws] of X.field.now){if(ws==null)continue;cells+=`<rect x="${px(lo-1)}" y="${py(la+1)}" width="${2*kx+1}" height="${2*ky+1}" fill="${col(ws)}"/>`}
let arrows='';for(const [la,lo,ws,wd] of X.field.now){if(ws==null||((la-6)%4)||((lo+64)%4))continue;if(lo<LO0||lo>LO1||la<LA0||la>LA1)continue;arrows+=`<g transform="translate(${px(lo)},${py(la)}) rotate(${wd+180})"><path d="M0 -11 L6 2 L2 1 L2 11 L-2 11 L-2 1 L-6 2Z" fill="rgba(255,255,255,.8)" stroke="rgba(0,0,0,.35)" stroke-width=".8"/></g>`}
let lp='';for(const poly of land){const pts=poly.filter(([lo,la])=>lo>LO0-3&&lo<LO1+3&&la>LA0-3&&la<LA1+3);if(pts.length<3)continue;lp+=`<path d="M${poly.map(([lo,la])=>px(lo).toFixed(1)+','+py(la).toFixed(1)).join('L')}Z" fill="#2A2F38" stroke="#4A5160" stroke-width=".8"/>`}
const ticks=[0,24,48,72].map(h=>R.find(r=>r.h===h)).filter(Boolean);
const tk=ticks.map((r,i)=>i===0?'':`<circle cx="${px(r.lon)}" cy="${py(r.lat)}" r="7" fill="#fff" stroke="#0E1420" stroke-width="2.5"/><g transform="translate(${px(r.lon)},${py(r.lat)-24})"><rect x="-27" y="-12" width="54" height="22" rx="11" fill="#0E1420"/><text x="0" y="4" text-anchor="middle" font-size="12.5" font-weight="900" fill="#fff">+${r.h}h F${r.bf}</text></g>`).join('');
const sel=(r,on)=>`<div class="tb ${on?'on':''}"><b>${r.h?'+'+r.h+' h':'Now'}</b><span>${day(r.t)} ${hh(r.t)}</span></div>`;
const readout=r=>`
 <div class="ro">
  <div class="rl">${r.h?'WHERE YOU’LL BE · '+day(r.t).toUpperCase()+' '+hh(r.t)+' UTC':'YOUR POSITION · NOW 18:00 UTC'}</div>
  <div class="rp">${ll(r.lat,r.lon)}${r.h?' · '+r.nm+' nm on':''}</div>
  <div class="rg">
   <div class="c1"><span>Wind</span><div class="rw">${arrow(r.wdd,30,'#fff')}<b>${r.wd} ${r.ws}</b></div><em>F${r.bf} · gusts ${r.wg} kn</em></div>
   <div class="c2"><span>Sea</span><b>${r.hs} m</b><em>${r.tp} s from ${r.hd}</em></div>
   <div class="c2"><span>Squalls</span><b class="${squall(r)?'warn':''}">${squall(r)?'Likely':'Unlikely'}</b><em>${r.r} mm / 6 h</em></div>
  </div>
 </div>`;
const B=(selH)=>{const r=R.find(x=>x.h===selH);const b=R.find(x=>x.h===selH);return `
<div class="scr b">
 <div class="top"><span class="back">‹ Dashboard</span><span class="age">Forecast 8 h old · ECMWF</span></div>
 <div class="seg3"><div class="on">Wind</div><div>Waves</div><div>Rain</div></div>
 <div class="map"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="bl"><feGaussianBlur stdDeviation="9"/></filter><clipPath id="cp"><rect width="${W}" height="${H}"/></clipPath></defs>
  <rect width="${W}" height="${H}" fill="#1B2A44"/><g clip-path="url(#cp)"><g filter="url(#bl)" opacity=".9">${cells}</g>${lp}${arrows}
  <path d="M${px(now.lon)},${py(now.lat)}L${px(eta.lon)},${py(eta.lat)}" stroke="#0E1420" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M${px(now.lon)},${py(now.lat)}L${px(eta.lon)},${py(eta.lat)}" stroke="#fff" stroke-width="2.6" stroke-dasharray="7 6" fill="none"/>
  ${tk}
  ${selH?`<circle cx="${px(b.lon)}" cy="${py(b.lat)}" r="15" fill="none" stroke="#F5B041" stroke-width="4"/>`:''}
  <g transform="translate(${px(now.lon)},${py(now.lat)})"><circle r="17" fill="rgba(245,176,65,.25)"/><circle r="9" fill="#F5B041" stroke="#0E1420" stroke-width="3"/></g>
  <g transform="translate(${px(eta.lon)},${py(eta.lat)})"><rect x="-6" y="-6" width="12" height="12" fill="#fff" stroke="#0E1420" stroke-width="2.5"/></g>
  <text x="${px(eta.lon)+10}" y="${py(eta.lat)+22}" font-size="12" font-weight="900" fill="#fff" stroke="#0E1420" stroke-width="3" paint-order="stroke">St Lucia · ${day(eta.t).split(' ')[0]} ${hh(eta.t)}</text>
  </g></svg>
  <div class="leg"><span>kn</span>${[0,10,15,20,25,30,40].map(v=>`<i style="background:${col(v+2)}">${v}</i>`).join('')}</div>
  <div class="mbtn"><div>＋</div><div>－</div><div>◎</div></div>
 </div>
 <div class="tbar">${[0,12,24,48,72].map(h=>sel(R.find(x=>x.h===h),h===selH)).join('')}</div>
 ${readout(r)}
 <div class="rs"><div class="rsh"><b>Along your route</b><span>arrive ${day(eta.t)} ${hh(eta.t)} UTC</span></div><div class="rsr">${R.filter(x=>x.h%12===0&&(!x.arr||x===eta)).map(x=>`<div class="${x.h===selH?'on':''}"><i style="background:${BC[x.bf]};color:${BT(x.bf)}">F${x.bf}</i><span>${x.h?'+'+x.h:'Now'}</span></div>`).join('')}</div><p>Gusts peak ${worst.wg} kn (${day(worst.t)} ${hh(worst.t)}). Squalls likely on ${R.filter(x=>x.h%12===0&&squall(x)).length} of ${R.filter(x=>x.h%12===0&&(!x.arr||x===eta)).length} steps.</p></div>
</div>`};

const css=fs.readFileSync(D+'/mock.css','utf8');
const phone=(inner,cap)=>`<figure><div class="ph"><div class="sb"><span>20:07</span><i></i><span>84%</span></div>${inner}</div><figcaption>${cap}</figcaption></figure>`;
const html=`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<section class="sheet"><h1>Atlantic weather: two calmer layouts</h1><p class="sub">Real forecast snapshot (24/11 12:35 UTC), your position near zone QQ, route to Rodney Bay at 6.5 kn. Mock-ups, not built.</p>
<div class="opt"><h2><span>A</span> “Now and ahead”: a list first, the chart on request</h2><div class="pair">${phone(A,'Opens on your position now, then where you’ll be every 12 h to arrival')}${phone(A.replace('class="scr a"','class="scr a s2"'),'Scrolled: every row is the place you will be at that time')}</div></div>
</section>
<section class="sheet"><div class="opt"><h2><span>B</span> “One-layer chart”: a quiet chart and a docked readout</h2><div class="pair">${phone(B(0),'One layer at a time, sparse arrows, no zone grid; readout docked below, never over the chart')}${phone(B(48),'Tap +48 h: the ring moves to where you’ll be, the readout follows')}</div></div></section>
</body></html>`;
fs.writeFileSync(D+'/mock.html',html);
