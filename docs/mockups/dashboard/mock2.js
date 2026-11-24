const fs=require('fs');
// ---------- icons: monoline, 2 pt strokes, rounded caps (SF Symbols feel) ----------
const IC={
 work:'<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.6 2.6-2.4-.6-.6-2.4z"/>',
 rest:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
 wind:'<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 14h15a3 3 0 1 1-3 3"/><path d="M3 19h6"/>',
 tide:'<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
 cloud:'<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18z"/>',
 pin:'<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
 route:'<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 17c6-1 2-8 8-9.3"/>',
 log:'<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>',
 globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
 doc:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
 pulse:'<path d="M3 12h4l2-6 4 12 2-6h6"/>',
 mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
 moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
 home:'<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
 more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
 anchor:'<circle cx="12" cy="5" r="2"/><path d="M12 7v14M7 11h10M4 15a8 8 0 0 0 16 0"/>',
 chev:'<path d="M9 6l6 6-6 6"/>'};
const ic=(n,s=28,w=2)=>`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
const arrow=(deg,s)=>`<svg width="${s}" height="${s}" viewBox="-10 -10 20 20" style="transform:rotate(${deg}deg)"><path d="M0 -8 L5 2 L1.6 1 L1.6 8 L-1.6 8 L-1.6 1 L-5 2Z" fill="currentColor"/></svg>`;
const dial=(s)=>`<svg width="${s}" height="${s}" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="3"/>${[0,90,180,270].map(a=>`<line x1="60" y1="8" x2="60" y2="18" transform="rotate(${a} 60 60)" stroke="currentColor" stroke-opacity=".6" stroke-width="3"/>`).join('')}<text x="60" y="30" text-anchor="middle" font-size="13" font-weight="900" fill="currentColor" fill-opacity=".8">N</text><g transform="rotate(45 60 60)" class="acc"><path d="M60 24 L74 62 L63 58 L63 98 L57 98 L57 58 L46 62Z" fill="currentColor"/></g></svg>`;
// tide curve: now marker at ~ 20:00 on a 3-3.3m semi-diurnal curve
const curve=(w,h)=>{let d='';for(let i=0;i<=48;i++){const x=i/48*w,y=h*.12+(h*.76)*(1-(Math.cos((i/48*24-11.7)/12.4*2*Math.PI)+1)/2);d+=(i?'L':'M')+x.toFixed(1)+','+y.toFixed(1)}const nx=20/24*w,ny=h*.12+(h*.76)*(1-(Math.cos((20-11.7)/12.4*2*Math.PI)+1)/2);return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="curve"><path d="${d}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><line x1="${nx}" y1="0" x2="${nx}" y2="${h}" stroke="currentColor" stroke-opacity=".5" stroke-dasharray="4 4"/><circle cx="${nx}" cy="${ny}" r="7" class="accf" stroke="#0008" stroke-width="2"/></svg>`};
const bar=(pct,mark)=>`<div class="bar"><i style="width:${pct}%"></i><b style="left:${mark}%"></b></div>`;

// ---------- shared css ----------
const base=`*{box-sizing:border-box}body{margin:0;background:#E3E9F1;font-family:Lato,Arial,sans-serif;color:#fff}.sheet{padding:30px 40px 36px;width:1420px}
h1{color:#00154C;font-size:30px;font-weight:900;margin:0 0 4px}.sub{color:#4A5B72;font-size:15px;margin:0 0 20px;max-width:1100px;line-height:1.45}.row{display:flex;gap:36px;margin-top:26px;align-items:flex-start}
.lab{color:#00154C;font-weight:900;font-size:14px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px}.note{color:#4A5B72;font-size:13px;margin-top:8px;line-height:1.4;max-width:600px}
.dev{border-radius:34px;background:#05070C;padding:12px;box-shadow:0 16px 36px rgba(0,21,76,.3);flex:none}.scr{overflow:hidden;position:relative;border-radius:24px}
.ipad{width:1180px;height:820px}.ipad .scr{width:1156px;height:796px}.duo{width:640px;height:790px}.duo .scr{width:616px;height:766px}
.ic{flex:none}svg{display:block}
/* theme tokens */
.day{--bg:#00154C;--t1:#0E2A66;--t2:#163A82;--line:rgba(255,255,255,.16);--tx:#fff;--mu:#C5D2E8;--acc:#F5B041;--rest:#38BDD9;--ok:#8FE3B0;--warn:#F5B041;--bad:#FF6B5B;--onacc:#00154C}
.night{--bg:#000;--t1:#120303;--t2:#220606;--line:rgba(255,70,50,.3);--tx:#FF6A4D;--mu:#B8503B;--acc:#FF6A4D;--rest:#FF6A4D;--ok:#FF6A4D;--warn:#FF8A66;--bad:#FF9C80;--onacc:#000}
.scr{background:var(--bg);color:var(--tx)}.acc{color:var(--acc)}.accf{fill:var(--acc)}
.bar{position:relative;height:16px;border-radius:8px;background:rgba(255,255,255,.12);overflow:visible}.night .bar{background:rgba(255,70,50,.15)}.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:8px;background:var(--rest)}.bar b{position:absolute;top:-5px;width:4px;height:26px;border-radius:2px;background:var(--tx)}
.tag{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--mu)}.big{font-weight:900;line-height:1}.mu{color:var(--mu)}.ok{color:var(--ok)}
.hdr{display:flex;align-items:center;gap:14px;padding:14px 22px}.hdr .nm{font-weight:900;font-size:22px}.hdr .vs{color:var(--mu);font-size:16px}.hdr .sp{margin-left:auto;display:flex;gap:12px;align-items:center}
.pillb{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:22px;padding:0 16px;height:44px;font-weight:700;font-size:15px;color:var(--tx)}
.logo{width:34px;height:34px;border-radius:9px;background:#fff;display:grid;place-items:center;color:#00154C}
`;
const logoSvg=`<div class="logo">${ic('anchor',22,2.4)}</div>`;
const hdr=(night)=>`<div class="hdr">${logoSvg}<div><div class="nm">Sea Lark</div></div><div class="vs">A. Morgan · Master · Voyage day 7</div><div class="sp"><div class="pillb">${ic(night?'sun':'moon',20)}${night?'Day':'Night'}</div><div class="pillb" style="font-variant-numeric:tabular-nums">20:07 UTC</div></div></div>`;
const assist=(w)=>`<div class="asst" style="width:${w}"><div class="mic">${ic('mic',26)}</div><span>Ask or tell Crow’s Nest…</span><em>Log rest</em><em>Add hours</em><em>Weather?</em></div>`;
const dock=(items,cur)=>`<div class="dock">${items.map(([i,t])=>`<div class="${t===cur?'on':''}">${ic(i,30)}<span>${t}</span></div>`).join('')}</div>`;
const DOCK=[['home','Home'],['clock','Hours'],['route','Map'],['tide','Tides'],['wind','Wind'],['globe','Atlantic'],['doc','Passage'],['pulse','Status']];


// ============================== C2: Split Deck with big pictures ==============================
const lonlat=(la,lo,w,h,b)=>[(lo-b.lo0)/(b.lo1-b.lo0)*w,(b.la1-la)/(b.la1-b.la0)*h];
const mapPic=(w,h)=>{const b={lo0:-6.02,lo1:-5.45,la0:55.40,la1:55.84};
 const P=pts=>pts.map(([la,lo])=>lonlat(la,lo,w,h,b).map(v=>v.toFixed(1)).join(',')).join(' ');
 const land=[[55.84,-5.45],[55.84,-5.57],[55.78,-5.62],[55.71,-5.66],[55.65,-5.64],[55.59,-5.69],[55.53,-5.72],[55.47,-5.67],[55.40,-5.61],[55.40,-5.45]];
 const isle=[[55.62,-5.97],[55.66,-5.93],[55.64,-5.88],[55.60,-5.90]];
 const track=[[55.40,-5.76],[55.47,-5.80],[55.56,-5.79],[55.62,-5.77],[55.68,-5.745]];
 const [bx,by]=lonlat(55.68,-5.745,w,h,b);
 let grid='';for(let la=55.4;la<=55.84;la+=.1){const y=lonlat(la,-6,w,h,b)[1];grid+=`<line x1="0" x2="${w}" y1="${y}" y2="${y}"/>`}for(let lo=-6;lo<=-5.45;lo+=.1){const x=lonlat(55.5,lo,w,h,b)[0];grid+=`<line y1="0" y2="${h}" x1="${x}" x2="${x}"/>`}
 return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;border-radius:16px"><rect width="${w}" height="${h}" fill="var(--sea)"/>
 <g stroke="var(--grid)" stroke-width="1">${grid}</g>
 <polygon points="${P(land)}" fill="var(--land)" stroke="var(--coast)" stroke-width="3" stroke-linejoin="round"/><polygon points="${P(isle)}" fill="var(--land)" stroke="var(--coast)" stroke-width="3"/>
 <polyline points="${P(track)}" fill="none" stroke="var(--acc)" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 11" opacity=".9"/>
 <g transform="translate(${bx},${by})"><circle r="30" fill="var(--acc)" opacity=".22"/><circle r="17" fill="none" stroke="var(--acc)" stroke-width="3"/><path d="M0 -13 L9 11 L0 6 L-9 11Z" fill="var(--acc)" stroke="#0009" stroke-width="2"/></g>
 <g fill="var(--tx)" font-weight="900" font-size="15" opacity=".9"><text x="${w*.62}" y="${h*.2}">KINTYRE</text></g>
 <g transform="translate(${w-34},34)" fill="var(--tx)"><circle r="20" fill="#0006"/><path d="M0 -14 L5 4 L0 1 L-5 4Z" fill="var(--acc)"/><text y="-22" text-anchor="middle" font-size="12" font-weight="900">N</text></g>
 <g transform="translate(40,${h-36})" fill="var(--tx)" font-size="14" font-weight="900"><rect y="-4" width="${w*.2}" height="4" fill="var(--tx)"/><text y="-10">5 nm</text></g></svg>`};
const windPic=(s)=>`<svg viewBox="0 0 220 250" style="width:100%;height:100%"><g transform="translate(110,100)"><circle r="92" fill="var(--sea)" stroke="var(--tx)" stroke-opacity=".5" stroke-width="3"/>${Array.from({length:36},(_,i)=>`<line y1="-92" y2="${i%9?-84:-76}" transform="rotate(${i*10})" stroke="var(--tx)" stroke-opacity="${i%9?.4:.9}" stroke-width="${i%9?2:4}"/>`).join('')}
 ${[['N',0],['E',90],['S',180],['W',270]].map(([t,a])=>`<text x="${Math.sin(a*Math.PI/180)*62}" y="${-Math.cos(a*Math.PI/180)*62+7}" text-anchor="middle" font-size="19" font-weight="900" fill="var(--tx)" fill-opacity=".85">${t}</text>`).join('')}
 <g transform="rotate(45)"><path d="M0 -70 L22 22 L5 14 L5 66 L-5 66 L-5 14 L-22 22Z" fill="var(--acc)" stroke="#0008" stroke-width="2"/></g><circle r="9" fill="var(--bg)" stroke="var(--tx)" stroke-width="3"/></g>
 <g transform="translate(8,222)">${Array.from({length:12},(_,i)=>`<rect x="${i*17}" width="15" height="16" rx="4" fill="${i<=4?'var(--acc)':'var(--tx)'}" fill-opacity="${i===4?1:i<4?.55:.18}"/>`).join('')}<text y="-6" font-size="12" font-weight="900" fill="var(--tx)" fill-opacity=".8">FORCE 4 · gentle→moderate</text></g></svg>`;
const gaugePic=()=>{const H=330,top=18,m=v=>top+(H-top*2)*(1-v/4);return `<svg viewBox="0 0 200 ${H}" style="width:100%;height:100%"><rect x="46" y="${top}" width="64" height="${H-top*2}" rx="14" fill="var(--sea)" stroke="var(--tx)" stroke-opacity=".5" stroke-width="3"/>
 <clipPath id="g"><rect x="46" y="${top}" width="64" height="${H-top*2}" rx="14"/></clipPath><g clip-path="url(#g)"><rect x="46" y="${m(1.4)}" width="64" height="${H}" fill="var(--rest)"/><path d="M46 ${m(1.4)} q16 -9 32 0 t32 0" stroke="var(--tx)" stroke-width="3" fill="none"/></g>
 ${[0,1,2,3,4].map(v=>`<line x1="110" x2="124" y1="${m(v)}" y2="${m(v)}" stroke="var(--tx)" stroke-width="3"/><text x="132" y="${m(v)+6}" font-size="17" font-weight="900" fill="var(--tx)">${v}</text>`).join('')}
 <g transform="translate(26,${m(1.4)})"><path d="M0 0 L14 -9 L14 9Z" fill="var(--acc)"/></g>
 <line x1="46" x2="128" y1="${m(3.3)}" y2="${m(3.3)}" stroke="var(--acc)" stroke-width="3" stroke-dasharray="6 5"/><text x="152" y="${m(3.3)-6}" font-size="14" font-weight="900" fill="var(--acc)">HW</text>
 <line x1="46" x2="128" y1="${m(.4)}" y2="${m(.4)}" stroke="var(--tx)" stroke-opacity=".6" stroke-width="3" stroke-dasharray="6 5"/><text x="152" y="${m(.4)-6}" font-size="14" font-weight="900" fill="var(--tx)" fill-opacity=".8">LW</text></svg>`};
const cloudPic=()=>`<svg viewBox="0 0 200 130" style="width:100%;height:100%"><g fill="var(--cl2)"><circle cx="62" cy="62" r="28"/><circle cx="96" cy="48" r="34"/><circle cx="132" cy="64" r="26"/><rect x="40" y="62" width="112" height="30" rx="15"/></g><g fill="var(--cl1)" transform="translate(18,24)"><circle cx="56" cy="66" r="24"/><circle cx="86" cy="52" r="30"/><circle cx="118" cy="68" r="22"/><rect x="34" y="68" width="106" height="26" rx="13"/></g></svg>`;
const voyPic=()=>{const wp=[[55.796,-4.870],[55.760,-4.905],[55.700,-4.960],[55.620,-5.030],[55.535,-5.085],[55.440,-5.230],[55.420,-5.540],[55.320,-5.580],[55.280,-5.700],[55.400,-5.760],[55.560,-5.790],[55.680,-5.745]];const b={lo0:-5.9,lo1:-4.8,la0:55.24,la1:55.84},w=240,h=130;
 const pts=wp.map(([la,lo])=>lonlat(la,lo,w,h,b));const [sx,sy]=pts[0],[ex,ey]=pts[pts.length-1];
 return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%"><polyline points="${pts.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--tx)" stroke-opacity=".25" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${pts.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--rest)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="${sx}" cy="${sy}" r="9" fill="var(--ok)" stroke="#0009" stroke-width="3"/><circle cx="${ex}" cy="${ey}" r="10" fill="var(--acc)" stroke="#0009" stroke-width="3"/></svg>`};
const logPic=()=>`<svg viewBox="0 0 220 130" style="width:100%;height:100%"><rect x="14" y="8" width="192" height="116" rx="12" fill="var(--cl1)"/><rect x="14" y="8" width="26" height="116" rx="12" fill="var(--cl2)"/>${[0,1,2,3].map(i=>`<line x1="54" x2="194" y1="${38+i*24}" y2="${38+i*24}" stroke="var(--land)" stroke-width="3" stroke-linecap="round" ${i==3?'stroke-dasharray="40 100"':''}/>`).join('')}<text x="54" y="30" font-size="14" font-weight="900" fill="var(--land)">19:40 Engine check</text>${[0,1,2].map(i=>`<circle cx="27" cy="${30+i*34}" r="5" fill="var(--bg)"/>`).join('')}</svg>`;
const atlPic=()=>`<svg viewBox="0 0 240 130" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;border-radius:14px"><defs><linearGradient id="ag" x1="0" x2="1"><stop offset="0" stop-color="var(--w1)"/><stop offset=".5" stop-color="var(--w2)"/><stop offset="1" stop-color="var(--w3)"/></linearGradient></defs><rect width="240" height="130" fill="url(#ag)"/>
 ${[[30,28],[90,22],[150,30],[205,26],[40,70],[100,66],[160,72],[212,64],[28,108],[92,104],[152,110]].map(([x,y])=>`<g transform="translate(${x},${y}) rotate(65)" fill="var(--tx)"><path d="M0 -12 L5 4 L1.6 2 L1.6 12 L-1.6 12 L-1.6 2 L-5 4Z"/></g>`).join('')}
 <path d="M16 112 Q90 80 140 70 T226 24" stroke="#fff" stroke-width="5" stroke-dasharray="1 10" stroke-linecap="round" fill="none"/><circle cx="140" cy="70" r="9" fill="var(--acc)" stroke="#0009" stroke-width="3"/></svg>`;

const tileC=(cls,icn,label,pic,big,sub)=>`<div class="t2 ${cls}"><div class="tag">${ic(icn,22)}${label}</div><div class="pic">${pic}</div><div class="cap"><b>${big}</b><span>${sub}</span></div></div>`;
const cssC2=`
.day{--sea:#0F3A7A;--land:#4C5C77;--coast:#9DB0CF;--grid:rgba(255,255,255,.14);--cl1:#EEF3FB;--cl2:#9FB3D3;--w1:#2B6CB0;--w2:#3FA36B;--w3:#E8C547}
.night{--sea:#160404;--land:#3A0E09;--coast:#FF6A4D;--grid:rgba(255,70,50,.22);--cl1:#FF6A4D;--cl2:#7E2E22;--w1:#2A0805;--w2:#7A2418;--w3:#D2492F}
.C .body{display:grid;grid-template-columns:300px 1fr;gap:14px;padding:0 20px;height:604px}
.C .rail{background:#050B22;border:1px solid var(--line);border-radius:28px;padding:18px;display:flex;flex-direction:column}.night .C .rail,.C.night .rail{background:#0A0101}
.C .rail .glyph{width:84px;height:84px;border-radius:24px;background:var(--acc);color:var(--onacc);display:grid;place-items:center}
.C .rail .st{font-size:38px;font-weight:900;line-height:1}.C .rail .tm{font-size:20px;color:var(--mu);font-weight:700;margin-top:4px}
.C .tog{flex:1;border-radius:28px;background:var(--rest);color:var(--onacc);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;margin:14px 0;font-size:32px;font-weight:900;text-align:center;min-height:150px}.C.night .tog{color:#000}.C .tog small{font-size:14px;font-weight:700;opacity:.8}
.C .m{margin-bottom:14px}.C .m .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}.C .m .top b{font-size:26px;font-weight:900}
.C .area{display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(7,minmax(0,1fr));gap:12px;height:604px;min-height:0}.C .body{overflow:hidden}
.t2{background:var(--t1);border:1px solid var(--line);border-radius:24px;padding:12px 14px 12px;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.t2 .tag{margin-bottom:6px}.t2 .tag .ic{color:var(--acc)}.t2 .pic{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}.t2 .cap{margin-top:8px}
.t2 .cap b{display:block;font-size:30px;font-weight:900;line-height:1.05;white-space:nowrap}.t2 .cap span{display:block;font-size:15px;font-weight:700;color:var(--mu);margin-top:3px;white-space:nowrap}
.C .pos{grid-column:1/6;grid-row:1/5}.C .wind{grid-column:6/10;grid-row:1/5}.C .tides{grid-column:10/13;grid-row:1/5}
.C .wx{grid-column:1/4;grid-row:5/8}.C .voy{grid-column:4/7;grid-row:5/8}.C .atl{grid-column:7/10;grid-row:5/8}.C .lg{grid-column:10/13;grid-row:5/8}
.C .pos .cap b{font-size:25px}.C .wind .cap b{font-size:46px}.C .wind .cap b small{font-size:20px;color:var(--mu)}.C .tides .cap b{font-size:36px}
.t2.sm .cap b{font-size:24px}.t2.sm .cap span{font-size:13px}.t2.sm .tag{font-size:11px;margin-bottom:2px}
.C .dock{position:absolute;left:20px;right:20px;bottom:10px;height:72px;display:flex;gap:14px;align-items:center}
.C .dock .items{display:flex;flex:1;justify-content:space-around}.C .dock .items div{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--mu);font-size:12px;font-weight:700;width:76px}.C .dock .items .on{color:var(--tx)}
.C .micb{width:64px;height:64px;border-radius:50%;background:var(--acc);color:var(--onacc);display:grid;place-items:center;flex:none}
`;
const DK=[['home','Home'],['clock','Hours'],['route','Map'],['tide','Tides'],['wind','Wind'],['globe','Atlantic'],['log','Log'],['doc','Passage'],['pulse','Status']];
const rail=(compact)=>``;
const C2_ipad=(n)=>`<div class="dev ipad"><div class="scr C ${n?'night':'day'}">${hdr(n)}<div class="body">
 <div class="rail"><div class="tag">${ic('work',20)}WATCH · A. MORGAN</div><div style="display:flex;gap:14px;align-items:center;margin-top:8px"><div class="glyph">${ic('work',50,2.2)}</div><div><div class="st">Working</div><div class="tm">0h 12m</div></div></div>
  <div class="tog">${ic('rest',64,2)}<div>Tap to rest</div><small>hold ½ s · undo for 5 s</small></div>
  <div class="m"><div class="top"><span class="tag">✓ Rest 24 h</span><b>12h 59m</b></div>${bar(100,77)}</div><div class="m" style="margin-bottom:0"><div class="top"><span class="tag">✓ Rest 7 days</span><b>104h 59m</b></div>${bar(100,60)}</div></div>
 <div class="area">
  ${tileC('pos','pin','POSITION',mapPic(420,400),'55°40.8′N 005°44.7′W','4 nm off Kintyre · fix 1 h ago')}
  ${tileC('wind','wind','WIND · NOW',windPic(),'14 <small>kn</small> SW','gusts 21 kn · peak 22 at 02:00')}
  ${tileC('tides','tide','TIDES · MILLPORT',gaugePic(),'1.4 m ↑','HW 00:01 · LW 05:49')}
  ${tileC('wx sm','cloud','WEATHER',cloudPic(),'9°C','overcast · SW 14')}
  ${tileC('voy sm','route','VOYAGE',voyPic(),'72.3 nm','day 7 · 161 fixes')}
  ${tileC('atl sm','globe','ATLANTIC',atlPic(),'F4–5 ahead','Rodney Bay Sat 06:00')}
  ${tileC('lg sm','log','LOG',logPic(),'3 today','Engine checks done')}
 </div></div>
 <div class="dock"><div class="items">${DK.map(([i,t])=>`<div class="${t==='Home'?'on':''}">${ic(i,30)}<span>${t}</span></div>`).join('')}</div><div class="micb">${ic('mic',32)}</div></div></div></div>`;
const C2_duo=(n)=>`<div class="dev duo"><div class="scr C ${n?'night':'day'}"><div class="hdr" style="padding:12px 18px">${logoSvg}<div class="nm" style="font-size:20px">Sea Lark</div><div class="vs" style="font-size:14px">day 7</div><div class="sp"><div class="pillb" style="height:40px">${ic(n?'sun':'moon',18)}</div><div class="pillb" style="height:40px">20:07</div></div></div>
 <div style="padding:0 16px"><div class="rail" style="flex-direction:row;gap:14px;height:240px;padding:14px;border-radius:26px">
   <div class="tog" style="flex:none;width:226px;margin:0;font-size:28px;min-height:0">${ic('rest',52,2)}<div>Tap to rest</div><small>hold ½ s · undo 5 s</small></div>
   <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between"><div><div class="tag">${ic('work',18)}WORKING</div><div class="st" style="font-size:36px;margin-top:2px">0h 12m</div></div>
    <div class="m" style="margin:0"><div class="top" style="margin-bottom:6px"><span class="tag">✓ Rest 24 h</span><b style="font-size:20px">12h 59m</b></div>${bar(100,77)}</div>
    <div class="m" style="margin:0"><div class="top" style="margin-bottom:6px"><span class="tag">✓ Rest 7 d</span><b style="font-size:20px">105h</b></div>${bar(100,60)}</div></div></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:152px 152px 120px;gap:10px;margin-top:10px">
   <div class="t2" style="grid-row:1/3;padding:10px 12px">${'<div class="tag">'+ic('pin',20)+'POSITION</div>'}<div class="pic">${mapPic(300,300)}</div><div class="cap"><b style="font-size:18px;white-space:normal">55°40.8′N<br>005°44.7′W</b></div></div>
   <div class="t2" style="padding:10px 12px"><div class="tag">${ic('wind',20)}WIND</div><div style="display:flex;align-items:center;gap:8px;flex:1;min-height:0"><div style="width:96px;height:100%">${windPic()}</div><div class="cap" style="margin:0"><b style="font-size:38px">14<small style="font-size:16px;color:var(--mu)"> kn</small></b><span style="font-size:13px">SW · g 21</span></div></div></div>
   <div class="t2" style="padding:10px 12px"><div class="tag">${ic('tide',20)}TIDES</div><div style="display:flex;align-items:center;gap:8px;flex:1;min-height:0"><div style="width:74px;height:100%">${gaugePic()}</div><div class="cap" style="margin:0"><b style="font-size:26px">1.4 m ↑</b><span style="font-size:13px">HW 00:01</span></div></div></div>
   <div class="t2 sm" style="padding:10px 12px"><div class="tag">${ic('cloud',18)}WEATHER</div><div class="pic">${cloudPic()}</div><div class="cap"><b>9°C</b></div></div>
   <div class="t2 sm" style="padding:10px 12px"><div class="tag">${ic('route',18)}VOYAGE</div><div class="pic">${voyPic()}</div><div class="cap"><b>72.3 nm</b></div></div>
  </div></div>
 <div style="position:absolute;left:0;right:0;bottom:88px;height:36px;background:linear-gradient(transparent,var(--bg))"></div>
 <div class="dock" style="left:0;right:0;bottom:0;height:92px;padding:0 14px 6px;background:var(--bg);border-top:1px solid var(--line)"><div class="items">${[['home','Home'],['clock','Hours'],['route','Map'],['globe','Atlantic'],['more','More']].map(([i,t],k)=>`<div class="${k?'':'on'}" style="width:70px">${ic(i,28)}<span>${t}</span></div>`).join('')}</div><div class="micb" style="width:56px;height:56px">${ic('mic',28)}</div></div>
</div></div>`;
const common2=`<link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap" rel="stylesheet"><style>${base}${cssC2}`;
const out=process.argv[2];
fs.writeFileSync(out+'/C2a.html',`<!doctype html><html><head><meta charset="utf-8">${common2}</style></head><body><div class="sheet" style="width:1260px"><h1>C · Split Deck, with a picture for every feature</h1><p class="sub">The control rail stays put on the left. Every tile now leads with its own large picture: a chart with your boat for Position, a compass for Wind, a tide gauge for Tides, a cloud, a route sketch, an ocean chart and a logbook. Pictures use real values from the demo data; the coastline is a schematic.</p><p class="lab">iPad landscape · day</p>${C2_ipad(false)}<p class="lab" style="margin-top:30px">iPad landscape · night (red light)</p>${C2_ipad(true)}</div></body></html>`);
fs.writeFileSync(out+'/C2b.html',`<!doctype html><html><head><meta charset="utf-8">${common2}</style></head><body><div class="sheet"><h1>C · iPhone Duo, inner display upright</h1><p class="sub">Control strip on top, picture tiles under it (Position takes two rows). Weather, Voyage, Atlantic and Log scroll in beneath; the faded edge shows there is more.</p><div class="row" style="margin-top:0"><div><p class="lab">Day</p>${C2_duo(false)}</div><div><p class="lab">Night (red light)</p>${C2_duo(true)}</div></div></div></body></html>`);
