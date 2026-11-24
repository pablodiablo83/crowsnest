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

// =====================================================  A: Bridge Instruments
const cssA=`
.A .grid{display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(6,1fr);gap:14px;padding:0 22px;height:604px}
.A .t{background:var(--t1);border:1px solid var(--line);border-radius:24px;padding:18px 20px;position:relative;overflow:hidden;display:flex;flex-direction:column}
.A .t .tag{display:flex;align-items:center;gap:8px;margin-bottom:8px}.A .t .tag .ic{color:var(--acc)}
.A .watch{grid-column:1/6;grid-row:1/7;background:var(--t1)}
.A .state{display:flex;align-items:center;gap:16px;margin:4px 0 0}.A .state .glyph{width:76px;height:76px;border-radius:24px;background:var(--acc);color:var(--onacc);display:grid;place-items:center}
.A .state b{font-size:48px;font-weight:900}.A .state small{display:block;font-size:20px;color:var(--mu);font-weight:700;margin-top:2px}
.A .slab{flex:none;height:104px;border-radius:26px;background:var(--rest);color:var(--onacc);display:flex;align-items:center;gap:18px;padding:0 28px;font-weight:900;font-size:32px;margin:12px 0 10px}.night .A .slab{color:#000}
.A .slab small{font-size:16px;font-weight:700;display:block;opacity:.8}
.A .m{margin:8px 0 10px}.A .m .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}.A .m .top b{font-size:34px;font-weight:900}.A .m .top span{font-size:16px;color:var(--mu);font-weight:700}
.A .wind{grid-column:6/10;grid-row:1/5}.A .tides{grid-column:10/13;grid-row:1/4}.A .wx{grid-column:10/13;grid-row:4/7}.A .pos{grid-column:6/8;grid-row:5/7}.A .voy{grid-column:8/10;grid-row:5/7}
.A .wind .body{display:flex;align-items:center;gap:20px;flex:1}.A .wind .n{font-size:64px;font-weight:900;line-height:.95;white-space:nowrap}.A .wind .body>div:last-child{white-space:nowrap}.A .wind .n small{font-size:26px;color:var(--mu)}
.A .t .v{font-size:34px;font-weight:900;line-height:1.05}.A .t .s{font-size:17px;color:var(--mu);font-weight:700;margin-top:4px}
.A .asst{position:absolute;left:22px;bottom:12px;height:68px;border-radius:32px;background:var(--t2);border:1px solid var(--line);display:flex;align-items:center;gap:14px;padding:0 10px;font-size:18px;color:var(--mu)}
.A .asst .mic{width:48px;height:48px;border-radius:50%;background:var(--acc);color:var(--onacc);display:grid;place-items:center}.A .asst span{flex:1}.A .asst em{font-style:normal;border:1px solid var(--line);border-radius:18px;padding:7px 14px;font-weight:700;font-size:15px;color:var(--tx)}
.A .dock{position:absolute;right:22px;bottom:12px;left:620px;height:68px;display:flex;justify-content:space-between}.A .dock div{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--mu);font-size:12px;font-weight:700;width:68px}.A .dock .on{color:var(--tx)}
.A .curve{color:var(--rest);margin-top:auto}.A .wxn{display:flex;align-items:center;gap:14px;margin-top:6px}
`;
const A_ipad=(n)=>`<div class="dev ipad"><div class="scr A ${n?'night':'day'}">${hdr(n)}<div class="grid">
 <div class="t watch"><div class="tag">${ic('work',22)}WATCH · A. MORGAN</div>
  <div class="state"><div class="glyph">${ic('work',52,2.2)}</div><div><b>Working</b><small>since 19:55 · 0h 12m</small></div></div>
  <div class="slab">${ic('rest',48,2.2)}<div>Tap to rest<small>hold ½ s · undo for 5 s</small></div></div>
  <div class="m"><div class="top"><span class="tag">Rest, last 24 h</span><b>12h 59m</b></div>${bar(100,77)}<div class="top" style="margin-top:8px"><span class="ok">✓ 2h 59m above the 10 h minimum</span></div></div>
  <div class="m"><div class="top"><span class="tag">Rest, last 7 days</span><b>104h 59m</b></div>${bar(100,60)}<div class="top" style="margin-top:8px"><span class="ok">✓ 27h 59m above the 77 h minimum</span></div></div>
  <div class="m" style="margin-bottom:0"><div class="top" style="margin-bottom:6px"><span class="tag">Longest work stretch</span><b>5h 55m</b></div>${bar(42,100)}</div></div>
 <div class="t wind"><div class="tag">${ic('wind',22)}WIND · NOW</div><div class="body"><div style="color:var(--tx)">${dial(150)}</div><div><div class="n">14<small> kn</small></div><div class="v" style="margin-top:10px">from SW</div><div class="s">gusts 21 kn · Force 4</div><div class="s ok">peak 22 kn at 02:00</div></div></div></div>
 <div class="t tides"><div class="tag">${ic('tide',22)}TIDES · MILLPORT</div><div class="v">1.4 m rising</div><div class="s">HW 00:01 · 3.3 m</div><div class="s">LW 05:49 · 0.4 m</div>${curve(220,110)}</div>
 <div class="t wx"><div class="tag">${ic('cloud',22)}WEATHER</div><div class="wxn">${ic('cloud',64,1.8)}<div class="v" style="font-size:50px">9°C</div></div><div class="s">overcast · wind SW 14 kn</div></div>
 <div class="t pos"><div class="tag">${ic('pin',22)}POSITION</div><div class="v" style="font-size:24px">55°40.8′N<br>005°44.7′W</div><div class="s">fix 1 h ago</div></div>
 <div class="t voy"><div class="tag">${ic('route',22)}VOYAGE</div><div class="v" style="font-size:44px">72.3<span style="font-size:20px"> nm</span></div><div class="s">day 7 · 161 fixes</div></div>
 </div>${assist('560px')}${dock(DOCK,'Home')}</div></div>`;
const A_duo=(n)=>`<div class="dev duo"><div class="scr A ${n?'night':'day'}" style="--w:1">
 <div class="hdr" style="padding:12px 18px">${logoSvg}<div class="nm" style="font-size:20px">Sea Lark</div><div class="vs" style="font-size:14px">day 7</div><div class="sp"><div class="pillb" style="height:40px">${ic(n?'sun':'moon',18)}</div><div class="pillb" style="height:40px">20:07</div></div></div>
 <div style="padding:0 16px;display:grid;grid-template-columns:repeat(6,1fr);gap:10px;grid-auto-rows:68px">
  <div class="t" style="grid-column:1/7;grid-row:span 4;padding:16px 18px"><div class="tag">${ic('work',20)}WATCH · A. MORGAN</div>
   <div class="state" style="margin:4px 0"><div class="glyph" style="width:70px;height:70px;border-radius:20px">${ic('work',42,2.2)}</div><div><b style="font-size:40px">Working</b><small style="font-size:17px">since 19:55 · 0h 12m</small></div></div>
   <div class="slab" style="height:96px;font-size:28px;margin:8px 0 12px">${ic('rest',40,2.2)}<div>Tap to rest<small style="font-size:14px">hold ½ s · undo 5 s</small></div></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px"><div class="m" style="margin:0"><div class="top"><span class="tag">✓ Rest 24 h</span><b style="font-size:26px">12h 59m</b></div>${bar(100,77)}</div><div class="m" style="margin:0"><div class="top"><span class="tag">✓ Rest 7 d</span><b style="font-size:26px">105h</b></div>${bar(100,60)}</div></div></div>
  <div class="t" style="grid-column:1/5;grid-row:span 2;padding:14px 16px"><div class="tag">${ic('wind',20)}WIND</div><div style="display:flex;align-items:center;gap:12px"><div>${dial(104)}</div><div><div class="big" style="font-size:50px">14<small style="font-size:20px;color:var(--mu)"> kn</small></div><div class="s" style="font-size:15px">SW · gusts 21</div></div></div></div>
  <div class="t" style="grid-column:5/7;grid-row:span 2;padding:14px 16px"><div class="tag">${ic('cloud',20)}WX</div><div class="big" style="font-size:40px;margin-top:6px">9°C</div><div class="s" style="font-size:14px">overcast</div></div>
  <div class="t" style="grid-column:1/4;grid-row:span 2;padding:14px 16px"><div class="tag">${ic('tide',20)}TIDES</div><div class="v" style="font-size:24px">1.4 m ↑</div><div class="s" style="font-size:14px">HW 00:01 · 3.3 m</div></div>
  <div class="t" style="grid-column:4/7;grid-row:span 2;padding:14px 16px"><div class="tag">${ic('pin',20)}POSITION</div><div class="v" style="font-size:20px">55°40.8′N<br>005°44.7′W</div></div>
 </div><div style="position:absolute;left:12px;right:12px;bottom:8px;height:66px;display:flex;align-items:center;gap:10px"><div style="display:flex;flex:1;justify-content:space-around">${[['home','Home'],['clock','Hours'],['route','Map'],['globe','Atlantic'],['more','More']].map(([i,t],k)=>`<div class="${k?'':'on'}" style="width:70px;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:12px;font-weight:700;color:${k?'var(--mu)':'var(--tx)'}">${ic(i,28)}<span>${t}</span></div>`).join('')}</div><div style="width:58px;height:58px;border-radius:50%;background:var(--acc);color:var(--onacc);display:grid;place-items:center">${ic('mic',28)}</div></div>
</div></div>`;

// =====================================================  B: Big Buttons
const cssB=`
.B .grid{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);gap:16px;padding:0 22px;height:640px}
.B .t{border-radius:30px;padding:20px 22px;position:relative;display:flex;flex-direction:column;justify-content:space-between;color:#fff;overflow:hidden}
.B .t .gl{width:68px;height:68px;border-radius:20px;background:rgba(255,255,255,.2);display:grid;place-items:center}
.B .t b{font-size:46px;font-weight:900;line-height:1;display:block}.B .t b small{font-size:20px;font-weight:700;opacity:.85}.B .t span.l{font-size:19px;font-weight:900;letter-spacing:.02em}.B .t i{font-style:normal;font-size:17px;font-weight:700;opacity:.9;display:block;margin-top:4px}
.B .hero{grid-column:span 2;background:#E8A21F;color:#00154C}.B .hero .gl{background:rgba(0,21,76,.15);width:96px;height:96px;border-radius:28px}.B .hero b{font-size:60px}
.B .c1{background:#1B6FB8}.B .c2{background:#0E8A9C}.B .c3{background:#3F7F4D}.B .c4{background:#5B4FA3}.B .c5{background:#B25E2A}.B .c6{background:#2F4A7A}.B .c7{background:#7A3F5C}.B .c8{background:#3A5F6F}
.night .B .t,.B.night .t{background:#120303!important;border:2px solid rgba(255,70,50,.45);color:#FF6A4D}.B.night .hero{background:#2A0707!important;color:#FF6A4D}.B.night .t .gl{background:rgba(255,70,50,.15)}
.B .duo .t{padding:12px 14px;border-radius:24px}.B .duo .t .gl{width:46px;height:46px;border-radius:14px}.B .duo .t .gl .ic{width:30px;height:30px}.B .duo .t b{font-size:34px}.B .duo .t span.l{font-size:16px}.B .duo .t i{font-size:13px;margin-top:2px}
.B .dock{position:absolute;left:22px;right:22px;bottom:14px;height:68px;display:flex;gap:16px;align-items:center}
.B .ask{flex:1;height:60px;border-radius:30px;background:var(--t2);border:1px solid var(--line);display:flex;align-items:center;gap:14px;padding:0 10px;font-size:18px;color:var(--mu)}.B .ask .mic{width:46px;height:46px;border-radius:50%;background:var(--acc);color:var(--onacc);display:grid;place-items:center}
`;
const tile=(c,icn,val,lab,sub)=>`<div class="t ${c}"><div class="gl">${ic(icn,40,2.2)}</div><div><b>${val}</b><span class="l">${lab}</span>${sub?`<i>${sub}</i>`:''}</div></div>`;
const B_ipad=(n)=>`<div class="dev ipad"><div class="scr B ${n?'night':'day'}">${hdr(n)}<div class="grid">
 <div class="t hero"><div class="gl">${ic('rest',58,2.2)}</div><div><span class="l" style="font-size:22px">WORKING · 0h 12m</span><b>Tap to rest</b><i style="font-size:20px">hold ½ s · rest 12h 59m (24 h) ✓ legal</i></div></div>
 ${tile('c1','wind','14 <small>kn SW</small>','Wind','gusts 21 · Force 4')}${tile('c2','tide','1.4 m ↑','Tides','HW 00:01 · 3.3 m')}
 ${tile('c3','cloud','9°C','Weather','overcast')}${tile('c4','pin','55°40′N','Position','005°44′W')}${tile('c5','route','72.3 <small>nm</small>','Voyage','day 7')}${tile('c6','globe','F4–5','Atlantic','ahead: 6.5 kn')}
 ${tile('c7','log','3','Log','entries today')}${tile('c8','clock','105 h','Hours of rest','7 days ✓')}${tile('c1','doc','PDF','Passage pack','print · save')}${tile('c3','pulse','OK','Status','all healthy')}
 </div><div class="dock"><div class="ask"><div class="mic">${ic('mic',24)}</div><span>Ask or tell Crow’s Nest…</span></div></div></div></div>`;
const B_duo=(n)=>`<div class="dev duo"><div class="scr B ${n?'night':'day'}"><div class="hdr" style="padding:12px 18px">${logoSvg}<div class="nm" style="font-size:20px">Sea Lark</div><div class="sp"><div class="pillb" style="height:40px">${ic(n?'sun':'moon',18)}</div></div></div>
 <div style="padding:0 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;grid-template-rows:150px repeat(3,138px)">
  <div class="t hero" style="grid-column:1/4"><div class="gl" style="width:56px;height:56px;border-radius:16px">${ic('rest',36,2.2)}</div><div><span class="l">WORKING · 0h 12m</span><b style="font-size:40px">Tap to rest</b><i style="margin-top:0">rest 12h 59m ✓ legal</i></div></div>
  ${tile('c1','wind','14 <small>kn</small>','Wind','SW · gusts 21')}${tile('c2','tide','1.4 m','Tides','HW 00:01')}${tile('c3','cloud','9°C','Weather','overcast')}
  ${tile('c4','pin','55°40′','Position','N · 005°44′W')}${tile('c5','route','72.3','Voyage nm','day 7')}${tile('c6','globe','F4–5','Atlantic','ahead')}
  ${tile('c7','log','3','Log','today')}${tile('c8','clock','105 h','Hours','7 d ✓')}${tile('c2','pulse','OK','Status','healthy')}
 </div><div class="dock" style="left:16px;right:16px;bottom:12px"><div class="ask"><div class="mic">${ic('mic',24)}</div><span>Ask or tell Crow’s Nest…</span></div></div></div></div>`;
// fix grid row heights for Duo: hero + 3 rows of 150
// =====================================================  C: Split Deck
const cssC=`
.C .body{display:grid;grid-template-columns:330px 1fr;gap:16px;padding:0 22px;height:604px}
.C .rail{background:#050B22;border:1px solid var(--line);border-radius:28px;padding:20px;display:flex;flex-direction:column;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
.night .C .rail,.C.night .rail{background:#0A0101}
.C .rail .glyph{width:96px;height:96px;border-radius:28px;background:var(--acc);color:var(--onacc);display:grid;place-items:center;margin:8px 0 10px}
.C .rail .st{font-size:44px;font-weight:900;line-height:1}.C .rail .tm{font-size:22px;color:var(--mu);font-weight:700;margin-top:6px}
.C .tog{flex:1;border-radius:30px;background:var(--rest);color:var(--onacc);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;margin:16px 0;font-size:34px;font-weight:900;text-align:center;min-height:180px}.C.night .tog{color:#000}
.C .tog small{font-size:15px;font-weight:700;opacity:.8}
.C .m{margin-bottom:16px}.C .m .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px}.C .m .top b{font-size:28px;font-weight:900}
.C .area{display:grid;grid-template-columns:repeat(9,1fr);grid-template-rows:repeat(6,1fr);gap:14px}
.C .t{background:var(--t1);border:1px solid var(--line);border-radius:24px;padding:16px 18px;overflow:hidden;display:flex;flex-direction:column}.C .t .tag{display:flex;gap:8px;align-items:center;margin-bottom:6px}
.C .t .v{font-size:32px;font-weight:900;line-height:1.05}.C .t .s{font-size:16px;color:var(--mu);font-weight:700;margin-top:3px}
.C .wind{grid-column:1/5;grid-row:1/5}.C .tides{grid-column:5/10;grid-row:1/4}.C .wx{grid-column:5/7;grid-row:4/7}.C .pos{grid-column:7/10;grid-row:4/7}.C .voy{grid-column:1/3;grid-row:5/7}.C .lg{grid-column:3/5;grid-row:5/7}
.C .dock{position:absolute;left:22px;right:22px;bottom:12px;height:72px;display:flex;gap:14px;align-items:center}
.C .dock .items{display:flex;flex:1;justify-content:space-around}.C .dock .items div{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--mu);font-size:12px;font-weight:700;width:84px}.C .dock .items .on{color:var(--tx)}
.C .micb{width:64px;height:64px;border-radius:50%;background:var(--acc);color:var(--onacc);display:grid;place-items:center;flex:none}
.C .curve{color:var(--rest);margin-top:auto;width:100%}
`;
const C_ipad=(n)=>`<div class="dev ipad"><div class="scr C ${n?'night':'day'}">${hdr(n)}<div class="body">
 <div class="rail"><div class="tag">${ic('work',20)}WATCH · A. MORGAN</div><div style="display:flex;gap:16px;align-items:center"><div class="glyph">${ic('work',58,2.2)}</div><div><div class="st">Working</div><div class="tm">0h 12m</div></div></div>
  <div class="tog">${ic('rest',70,2)}<div>Tap to rest</div><small>hold ½ s · undo for 5 s</small></div>
  <div class="m"><div class="top"><span class="tag">Rest 24 h</span><b>12h 59m</b></div>${bar(100,77)}<div class="ok" style="font-size:15px;font-weight:700;margin-top:7px">✓ 2h 59m above minimum</div></div>
  <div class="m" style="margin-bottom:0"><div class="top"><span class="tag">Rest 7 days</span><b>104h 59m</b></div>${bar(100,60)}<div class="ok" style="font-size:15px;font-weight:700;margin-top:7px">✓ 27h 59m above minimum</div></div></div>
 <div class="area">
  <div class="t wind"><div class="tag">${ic('wind',22)}WIND · NOW</div><div style="display:flex;align-items:center;gap:22px;flex:1"><div>${dial(150)}</div><div style="white-space:nowrap"><div class="big" style="font-size:66px">14<small style="font-size:24px;color:var(--mu)"> kn</small></div><div class="v" style="margin-top:8px">from SW</div><div class="s">gusts 21 · Force 4</div></div></div></div>
  <div class="t tides"><div class="tag">${ic('tide',22)}TIDES · MILLPORT</div><div style="display:flex;gap:26px;align-items:baseline;white-space:nowrap"><div class="v">1.4 m ↑</div><div class="s">HW 00:01 · 3.3 m</div><div class="s">LW 05:49 · 0.4 m</div></div>${curve(470,140)}</div>
  <div class="t wx"><div class="tag">${ic('cloud',22)}WEATHER</div><div style="display:flex;align-items:center;gap:8px">${ic('cloud',34,1.8)}<div class="v" style="font-size:38px">9°C</div></div><div class="s">overcast</div></div>
  <div class="t pos"><div class="tag">${ic('pin',22)}POSITION</div><div class="v" style="font-size:26px">55°40.8′N<br>005°44.7′W</div><div class="s">fix 1 h ago</div></div>
  <div class="t voy"><div class="tag">${ic('route',22)}VOYAGE</div><div class="v" style="font-size:40px">72.3<span style="font-size:18px"> nm</span></div><div class="s">day 7</div></div>
  <div class="t lg"><div class="tag">${ic('log',22)}LOG</div><div class="v" style="font-size:40px">3</div><div class="s">entries today</div></div>
 </div></div>
 <div class="dock"><div class="items">${[['home','Home'],['clock','Hours'],['route','Map'],['tide','Tides'],['wind','Wind'],['globe','Atlantic'],['doc','Passage'],['pulse','Status']].map(([i,t])=>`<div class="${t==='Home'?'on':''}">${ic(i,30)}<span>${t}</span></div>`).join('')}</div><div class="micb">${ic('mic',32)}</div></div></div></div>`;
const C_duo=(n)=>`<div class="dev duo"><div class="scr C ${n?'night':'day'}"><div class="hdr" style="padding:12px 18px">${logoSvg}<div class="nm" style="font-size:20px">Sea Lark</div><div class="vs" style="font-size:14px">day 7</div><div class="sp"><div class="pillb" style="height:40px">${ic(n?'sun':'moon',18)}</div><div class="pillb" style="height:40px">20:07</div></div></div>
 <div style="padding:0 16px"><div class="rail" style="flex-direction:row;gap:16px;height:296px;padding:16px;border-radius:26px">
   <div class="tog" style="flex:none;width:250px;margin:0;font-size:30px;min-height:0">${ic('rest',58,2)}<div>Tap to rest</div><small>hold ½ s · undo 5 s</small></div>
   <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between"><div><div class="tag">${ic('work',18)}WORKING</div><div class="st" style="font-size:38px;margin-top:4px">0h 12m</div><div class="tm" style="font-size:16px">since 19:55</div></div>
    <div class="m" style="margin:0"><div class="top"><span class="tag">Rest 24 h</span><b style="font-size:22px">12h 59m</b></div>${bar(100,77)}<div class="ok" style="font-size:13px;margin-top:5px;font-weight:700">✓ +2h 59m</div></div>
    <div class="m" style="margin:0"><div class="top"><span class="tag">Rest 7 d</span><b style="font-size:22px">105h</b></div>${bar(100,60)}<div class="ok" style="font-size:13px;margin-top:5px;font-weight:700">✓ +28h</div></div></div></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:136px;gap:12px;margin-top:12px">
   <div class="t" style="padding:12px 14px"><div class="tag">${ic('wind',18)}WIND</div><div style="display:flex;align-items:center;gap:8px"><div>${dial(70)}</div><div><div class="big" style="font-size:38px">14<small style="font-size:16px;color:var(--mu)"> kn</small></div><div class="s" style="font-size:14px">SW · g 21</div></div></div></div>
   <div class="t" style="padding:12px 14px"><div class="tag">${ic('tide',18)}TIDES</div><div class="v" style="font-size:26px">1.4 m ↑</div><div class="s" style="font-size:14px">HW 00:01 · 3.3 m</div></div>
   <div class="t" style="padding:12px 14px"><div class="tag">${ic('cloud',18)}WEATHER</div><div class="v" style="font-size:38px">9°C</div><div class="s" style="font-size:14px">overcast</div></div>
   <div class="t" style="padding:12px 14px"><div class="tag">${ic('pin',18)}POSITION</div><div class="v" style="font-size:20px">55°40.8′N<br>005°44.7′W</div></div>
  </div></div>
 <div class="dock" style="left:12px;right:12px;bottom:8px;height:64px"><div class="items">${[['home','Home'],['clock','Hours'],['route','Map'],['globe','Atlantic'],['more','More']].map(([i,t],k)=>`<div class="${k?'':'on'}" style="width:70px">${ic(i,28)}<span>${t}</span></div>`).join('')}</div><div class="micb" style="width:56px;height:56px">${ic('mic',28)}</div></div>
</div></div>`;

const common=`<link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap" rel="stylesheet"><style>${base}`;
const page=(css,title,sub,ipD,ipN,duoD,duoN,notes)=>`<!doctype html><html><head><meta charset="utf-8">${common}${css}</style></head><body><div class="sheet"><h1>${title}</h1><p class="sub">${sub}</p>
<p class="lab">iPad landscape · day</p>${ipD}<p class="note">${notes[0]}</p>
<div class="row"><div><p class="lab">iPhone Duo, inner display upright · day</p>${duoD}<p class="note">${notes[1]}</p></div><div><p class="lab">iPhone Duo · night (red light)</p>${duoN}<p class="note">${notes[2]}</p></div></div></div></body></html>`;
const out=process.argv[2];
fs.writeFileSync(out+'/A.html',page(cssA,'A · Bridge Instruments','A dense glass-cockpit: one big Watch panel on the left (state, one huge rest control, margin bars), live instrument tiles on the right, assistant and a dock for every page along the bottom. Monoline icons, two brightness steps, amber = working/attention, teal = rest/info.',A_ipad(false),A_ipad(true),A_duo(false),A_duo(true),['12 columns × 6 rows. The Watch panel never scrolls. The rest ring becomes two margin bars with a threshold tick (time above the minimum, not a pass/fail chip).','Watch panel on top, a 2×2 of Wind, Weather, Tides, Position beneath; 5-icon dock with a mic button (the assistant) at the thumb edge.','Night: black, one red hue, values dimmed; same layout so nothing moves.']));
fs.writeFileSync(out+'/B.html',page(cssB,'B · Big Buttons','A touch launchpad: every feature is one big colour-coded tile with a glyph, one number and a one-word label. Hero tile is the rest control. Easiest with wet or gloved hands; shows the least detail at a glance.',B_ipad(false),B_ipad(true),B_duo(false),B_duo(true),['4 × 3 grid of ~260 pt tiles, hero 2×1. Every page of the app is one tap from here (Hours, Passage, Status, Atlantic are tiles, not a menu).','3 × 4 on the Duo; the rest control is a full-width slab. Compliance is only “✓ legal” on the hero; the margin detail is one tap away.','Night: tiles become dark outlines with red glyphs and numbers.']));
fs.writeFileSync(out+'/C.html',page(cssC,'C · Split Deck (recommended)','A permanent control rail on the left (state, timer, one huge toggle, rest margins) beside a live tile area. The controls never move or scroll, so muscle memory works in a swell. On a Duo held upright the rail becomes a top strip.',C_ipad(false),C_ipad(true),C_duo(false),C_duo(true),['Rail 330 pt (3 of 12 columns) always visible; 9-column live area with Wind 4×4, Tides 5×3 and a bottom dock for all pages plus a mic button.','Upright Duo: control strip on top (toggle left, margins right), 2×2 live tiles under it, dock with mic at the bottom edge.','Night: same geometry, red on black; the toggle stays the brightest object.']));
