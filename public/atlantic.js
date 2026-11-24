(() => {
'use strict';
// ---------- Zones (from the ARC 2026 forecast-zone GPX: grid lines + label waypoints) ----------
const ZONES = [
  ['AA',22.5,30,-17,-12,26.25,-14.5],['BB',22.5,30,-25,-17,26.25,-21],['CC',22.5,30,-33,-25,26.25,-29],['DD',22.5,30,-40,-33,26.25,-36.5],
  ['EE',22.5,27.5,-47,-40,25,-43.5],['FF',22.5,27.5,-55,-47,25,-51],
  ['GG',17.5,22.5,-25,-16,20,-20.5],['HH',17.5,22.5,-33,-25,20,-29],['II',17.5,22.5,-40,-33,20,-36.5],['JJ',17.5,22.5,-47,-40,20,-43.5],['KK',17.5,22.5,-55,-47,20,-51],['LL',17.5,22.5,-62.5,-55,20,-58.75],
  ['MM',12.5,17.5,-25,-16,15,-20.5],['NN',12.5,17.5,-33,-25,15,-29],['OO',12.5,17.5,-40,-33,15,-36.5],['PP',12.5,17.5,-47,-40,15,-43.5],['QQ',12.5,17.5,-55,-47,15,-51],['RR',12.5,17.5,-62.5,-55,15,-58.75],
  ['SS',7,12.5,-33,-25,9.75,-29],['TT',7,12.5,-40,-33,9.75,-36.5],['UU',7,12.5,-47,-40,9.75,-43.5],['VV',7,12.5,-55,-47,9.75,-51],['WW',10,12.5,-62.5,-55,11.25,-58.75]
].map(([id,s,n,w,e,la,lo]) => ({id,s,n,w,e,la,lo}));
const START = {name:'Las Palmas de Gran Canaria', lat:28.13, lon:-15.42};
const FINISH = {name:'Rodney Bay, Saint Lucia', lat:14.08, lon:-60.95};

// ---------- Colour scales ----------
const SCALES = {
  wind:{unit:'kn', title:'Mean wind, knots', stops:[[0,[38,58,128]],[6,[40,108,172]],[11,[36,158,166]],[16,[86,184,104]],[21,[232,206,66]],[27,[240,134,44]],[33,[214,52,52]],[40,[168,40,140]],[50,[100,30,110]]], ticks:[0,10,15,20,25,30,40]},
  gust:{unit:'kn', title:'Gusts, knots', stops:null, ticks:[0,10,15,20,25,30,40]},
  sea:{unit:'m', title:'Significant wave height, m', stops:[[0,[38,58,128]],[1,[40,118,178]],[2,[40,168,150]],[3,[120,190,84]],[4,[236,200,62]],[5,[240,130,44]],[6,[210,52,52]],[8,[150,40,130]]], ticks:[0,1,2,3,4,5,6,8]},
  swell:{unit:'m', title:'Primary swell height, m', stops:null, ticks:[0,1,2,3,4,5,6,8]},
  rain:{unit:'mm', title:'Rain, mm in 6 h (showers, squalls)', stops:[[0,[0,0,0,0]],[0.3,[120,170,220,.35]],[1,[70,130,225,.7]],[3,[60,190,120,.8]],[6,[236,200,62,.85]],[12,[236,110,44,.9]],[25,[200,40,90,.9]]], ticks:[0,1,3,6,12,25]}
};
SCALES.gust.stops = SCALES.wind.stops; SCALES.swell.stops = SCALES.sea.stops;
function colour(layer, v){
  const st = SCALES[layer].stops;
  if (v <= st[0][0]) return rgba(st[0][1]);
  for (let i=1;i<st.length;i++){ if (v <= st[i][0]){ const a=st[i-1], b=st[i], f=(v-a[0])/(b[0]-a[0]); return mix(a[1],b[1],f); } }
  return rgba(st[st.length-1][1]);
}
function mix(a,b,f){ return [0,1,2,3].map(k => (a[k]??1) + ((b[k]??1)-(a[k]??1))*f); }
function rgba(c){ return [c[0],c[1],c[2],c[3]??1]; }
const css = c => `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${(c[3]??1).toFixed(2)})`;

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const store = { get(k){ try { return JSON.parse(localStorage.getItem('arcwx_'+k)); } catch(e){ return null; } },
                set(k,v){ try { localStorage.setItem('arcwx_'+k, JSON.stringify(v)); } catch(e){} } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PTS16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const compass = d => PTS16[Math.round(((d%360)+360)%360/22.5)%16];
const BF = [1,4,7,11,17,22,28,34,41,48,56,64];
const beaufort = kn => { let i=0; while (i<BF.length && kn>=BF[i]) i++; return i; };
const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const pad = n => String(n).padStart(2,'0');
const tLabel = d => `${DAY[d.getUTCDay()]} ${d.getUTCDate()} · ${pad(d.getUTCHours())}Z`;
function ddm(v, pos, neg, w){ const h = v>=0?pos:neg; v=Math.abs(v); let d=Math.floor(v), m=(v-d)*60; if (m>=59.95){d++;m=0;} return `${String(d).padStart(w,'0')}°${m.toFixed(1).padStart(4,'0')}′${h}`; }
const fmtPos = (la,lo) => `${ddm(la,'N','S',2)} ${ddm(lo,'E','W',3)}`;
function parsePos(s){
  s = s.trim().toUpperCase().replace(/[°′'"]/g,' ').replace(/,/g,' ').replace(/\s+/g,' ');
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (m) return [+m[1], +m[2]];
  m = s.match(/^(\d+)\s+(\d+(?:\.\d+)?)\s*([NS])\s+(\d+)\s+(\d+(?:\.\d+)?)\s*([EW])$/);
  if (m) return [(+m[1]+m[2]/60)*(m[3]==='S'?-1:1), (+m[4]+m[5]/60)*(m[6]==='W'?-1:1)];
  m = s.match(/^(\d+(?:\.\d+)?)\s*([NS])\s+(\d+(?:\.\d+)?)\s*([EW])$/);
  if (m) return [m[1]*(m[2]==='S'?-1:1), m[3]*(m[4]==='W'?-1:1)];
  return null;
}
function gcPoints(a,b,n){ // great circle by slerp
  const r=Math.PI/180, toV=(la,lo)=>[Math.cos(la*r)*Math.cos(lo*r),Math.cos(la*r)*Math.sin(lo*r),Math.sin(la*r)];
  const A=toV(a.lat,a.lon), B=toV(b.lat,b.lon), om=Math.acos(A[0]*B[0]+A[1]*B[1]+A[2]*B[2]), out=[];
  for (let i=0;i<=n;i++){ const t=i/n, s1=Math.sin((1-t)*om)/Math.sin(om), s2=Math.sin(t*om)/Math.sin(om);
    const v=[0,1,2].map(k=>s1*A[k]+s2*B[k]); out.push([Math.atan2(v[2],Math.hypot(v[0],v[1]))/r, Math.atan2(v[1],v[0])/r]); }
  return {pts:out, nm: om*180/Math.PI*60};
}
function rhumbNm(a,b){ const r=Math.PI/180, dphi=(b.lat-a.lat)*r, dpsi=Math.log(Math.tan(Math.PI/4+b.lat*r/2)/Math.tan(Math.PI/4+a.lat*r/2));
  const q=Math.abs(dpsi)>1e-12?dphi/dpsi:Math.cos(a.lat*r), dl=(b.lon-a.lon)*r; return Math.hypot(dphi, q*dl)/r*60; }

// ---------- State ----------
const S = { wx:null, land:null, t:0, layer: store.get('layer') || 'wind', zone:null, pt:null,
  iso: store.get('iso') ?? true, route: store.get('route') ?? true, night:false, boat: store.get('boat'), gpx: store.get('gpx'), play:null };
let NLAT, NLON, LAT0, LON0, DLAT, DLON, sea = [], seaF = [];

// ---------- Map ----------
const map = L.map('map', { zoomControl:false, attributionControl:false, zoomAnimation:true, minZoom:3, maxZoom:9, zoomSnap:0.25, zoomDelta:0.5, wheelPxPerZoomLevel:90,
  maxBounds:[[-8,-85],[48,10]], worldCopyJump:false, preferCanvas:false });
map.fitBounds([[6,-63],[31,-12]]);
const pane = map.createPane('wx'); pane.style.zIndex = 350; pane.classList.add('wxpane');
const cv = document.createElement('canvas'); cv.className='leaflet-zoom-animated'; pane.appendChild(cv);
// zoom controls: bigger buttons, plus 'whole ocean' and 'my boat'
const ZC = L.Control.extend({ options:{position:'topleft'}, onAdd(){ const d=L.DomUtil.create('div','zc');
  d.innerHTML='<button id="zIn" aria-label="Zoom in">+</button><button id="zOut" aria-label="Zoom out">−</button><button id="zFit" aria-label="Show whole route" title="Whole route">⤢</button><button id="zBoat" aria-label="Zoom to my position" title="My position">◎</button>';
  L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
  d.querySelector('#zIn').onclick=()=>map.zoomIn(); d.querySelector('#zOut').onclick=()=>map.zoomOut();
  d.querySelector('#zFit').onclick=()=>map.flyToBounds([[6,-63],[31,-12]],{duration:.6});
  d.querySelector('#zBoat').onclick=()=>{ const t=S.boat||(S.zone?[S.zone.la,S.zone.lo]:null); if (t) map.flyTo(t, Math.max(map.getZoom(),6), {duration:.6}); else map.flyToBounds([[6,-63],[31,-12]],{duration:.6}); };
  return d; } });
new ZC().addTo(map);
const nmBar = L.DomUtil.create('div','nmbar', document.getElementById('map'));
const ctx = cv.getContext('2d');
const off = document.createElement('canvas'), offx = off.getContext('2d');
const zoneLayer = L.layerGroup().addTo(map), labelLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup(), gpxLayer = L.layerGroup().addTo(map), boatLayer = L.layerGroup().addTo(map), ptLayer = L.layerGroup().addTo(map);

// ---------- Data access ----------
const gi = (i,j) => i*NLON + j;
function val(arr, lat, lon){ // bilinear, ignoring missing corners
  const fi=(lat-LAT0)/DLAT, fj=(lon-LON0)/DLON;
  if (fi<-0.5||fj<-0.5||fi>NLAT-0.5||fj>NLON-0.5) return null;
  const i0=Math.max(0,Math.min(NLAT-2,Math.floor(fi))), j0=Math.max(0,Math.min(NLON-2,Math.floor(fj)));
  const a=Math.max(0,Math.min(1,fi-i0)), b=Math.max(0,Math.min(1,fj-j0));
  let s=0, w=0;
  const c=[[i0,j0,(1-a)*(1-b)],[i0,j0+1,(1-a)*b],[i0+1,j0,a*(1-b)],[i0+1,j0+1,a*b]];
  for (const [i,j,ww] of c){ const v=arr[gi(i,j)]; if (v!=null && ww>0){ s+=v*ww; w+=ww; } }
  return w>0.2 ? s/w : null;
}
function layerArr(layer, t){
  const d=S.wx.d;
  if (layer==='wind') return d.ws[t];
  if (layer==='gust') return d.wg[t];
  if (layer==='sea') return d.hs[t].map(v=>v==null?null:v/10);
  if (layer==='swell') return d.sh[t].map(v=>v==null?null:v/10);
  if (layer==='rain') return d.r[t].map((v,k)=>v==null||!sea[k]?null:v/10);
}
const cache = {};
function arrFor(layer,t){ const k=layer+t; return cache[k] || (cache[k] = layerArr(layer,t)); }

// ---------- Drawing ----------
let raf = 0;
function redraw(){ cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
function draw(){
  if (!S.wx) return;
  const size = map.getSize(), dpr = Math.min(2, window.devicePixelRatio||1);
  cv.width = size.x*dpr; cv.height = size.y*dpr; cv.style.width=size.x+'px'; cv.style.height=size.y+'px';
  L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0,0]));
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,size.x,size.y);
  const t=S.t, layer=S.layer;
  // field
  const cell=4, W=Math.ceil(size.x/cell), H=Math.ceil(size.y/cell);
  off.width=W; off.height=H; const img=offx.createImageData(W,H), px=img.data;
  const lons=new Float64Array(W), lats=new Float64Array(H);
  for (let x=0;x<W;x++) lons[x]=map.containerPointToLatLng([x*cell+cell/2,0]).lng;
  for (let y=0;y<H;y++) lats[y]=map.containerPointToLatLng([0,y*cell+cell/2]).lat;
  const arr = arrFor(layer,t);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const v=val(arr,lats[y],lons[x]); if (v==null) continue;
    const c=colour(layer,v), k=(y*W+x)*4; px[k]=c[0]; px[k+1]=c[1]; px[k+2]=c[2]; px[k+3]=(c[3]??1)*215;
  }
  offx.putImageData(img,0,0);
  ctx.imageSmoothingEnabled=true; ctx.drawImage(off,0,0,W*cell,H*cell);
  // land
  const st=getComputedStyle(document.documentElement);
  ctx.fillStyle=st.getPropertyValue('--land').trim(); ctx.strokeStyle=st.getPropertyValue('--coast').trim(); ctx.lineWidth=0.8;
  ctx.beginPath();
  for (const ring of S.land){ ring.forEach(([lo,la],k)=>{ const p=map.latLngToContainerPoint([la,lo]); k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y); }); ctx.closePath(); }
  ctx.fill('evenodd'); ctx.stroke();
  drawGraticule(size);
  if (S.iso) drawIsobars(t);
  if (layer==='sea') drawWaves(t,'hd','hs','tp');
  else if (layer==='swell') drawWaves(t,'sd','sh','sp');
  else drawBarbs(t);
}
function pxPerDeg(){ const a=map.latLngToContainerPoint([20,-40]), b=map.latLngToContainerPoint([20,-39]); return Math.abs(b.x-a.x); }
function lattice(minPx){ // lat/lon points fixed to the chart, spacing chosen for the zoom; interpolated between model grid points
  const ppd=pxPerDeg(), steps=[0.25,0.5,0.75,1,1.5,2,3,4]; let st=steps.find(s=>s*ppd>=minPx)||4;
  const b=map.getBounds(), out=[];
  const la0=Math.max(LAT0, Math.ceil(b.getSouth()/st)*st), la1=Math.min(LAT0+(NLAT-1)*DLAT, b.getNorth());
  const lo0=Math.max(LON0, Math.ceil(b.getWest()/st)*st), lo1=Math.min(LON0+(NLON-1)*DLON, b.getEast());
  for (let la=la0; la<=la1+1e-9; la+=st) for (let lo=lo0; lo<=lo1+1e-9; lo+=st){ if ((val(seaF,la,lo)??0) < 0.5) continue; out.push([la,lo]); }
  return {pts:out, st, ppd};
}
function uvArr(sp,di){ return [sp.map((s,k)=>s==null?null:-s*Math.sin(di[k]*Math.PI/180)), sp.map((s,k)=>s==null?null:-s*Math.cos(di[k]*Math.PI/180))]; }
function cached(key,f){ return cache[key] || (cache[key]=f()); }
const dirFrom=(a,b)=>(Math.atan2(-a,-b)*180/Math.PI+360)%360;
function drawBarbs(t){
  const d=S.wx.d, [u,v]=cached('uv'+t,()=>uvArr(d.ws[t],d.wd[t])), lat=lattice(30), L=Math.max(18,Math.min(26,lat.st*lat.ppd*0.72));
  ctx.lineCap='round'; ctx.lineJoin='round';
  for (const [la,lo] of lat.pts){
    const uu=val(u,la,lo), vv=val(v,la,lo), sp=val(d.ws[t],la,lo); if (uu==null||sp==null) continue;
    const p=map.latLngToContainerPoint([la,lo]), dir=dirFrom(uu,vv);
    for (const [col,w] of [['rgba(255,255,255,.75)',3.2],['#0a1118',1.3]]){ ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=w; barb(p.x,p.y,sp,dir,L); }
  }
}
function barb(x,y,kn,dir,L=24){
  const r=dir*Math.PI/180, dx=Math.sin(r), dy=-Math.cos(r), px=-dy, py=dx;
  let s=Math.round(kn/5)*5;
  if (s<5){ ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.stroke(); return; }
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+dx*L,y+dy*L); ctx.stroke();
  let pos=L; const F=10;
  while (s>=50){ ctx.beginPath(); ctx.moveTo(x+dx*pos,y+dy*pos); ctx.lineTo(x+dx*(pos)+px*F+dx*1,y+dy*pos+py*F+dy*1); ctx.lineTo(x+dx*(pos-6),y+dy*(pos-6)); ctx.closePath(); ctx.fill(); ctx.stroke(); pos-=8; s-=50; }
  while (s>=10){ ctx.beginPath(); ctx.moveTo(x+dx*pos,y+dy*pos); ctx.lineTo(x+dx*(pos+3)+px*F,y+dy*(pos+3)+py*F); ctx.stroke(); pos-=4.5; s-=10; }
  if (s>=5){ if (pos===L) pos-=4.5; ctx.beginPath(); ctx.moveTo(x+dx*pos,y+dy*pos); ctx.lineTo(x+dx*(pos+1.5)+px*F/2,y+dy*(pos+1.5)+py*F/2); ctx.stroke(); }
}
function drawWaves(t,dk,hk,pk){
  const D=S.wx.d, [u,v]=cached(dk+'uv'+t,()=>uvArr(D[hk][t],D[dk][t])), per=D[pk][t], lat=lattice(30);
  ctx.lineCap='round';
  for (const [la,lo] of lat.pts){
    const uu=val(u,la,lo), vv=val(v,la,lo), pp=val(per,la,lo); if (uu==null) continue;
    const p=map.latLngToContainerPoint([la,lo]);
    const r=(dirFrom(uu,vv)+180)*Math.PI/180, ux=Math.sin(r), uy=-Math.cos(r), len=10+Math.min(14,(pp||6)*1.1);
    const x0=p.x-ux*len/2, y0=p.y-uy*len/2, x1=p.x+ux*len/2, y1=p.y+uy*len/2;
    for (const [col,w] of [['rgba(255,255,255,.75)',3.4],['#0a1118',1.4]]){
      ctx.strokeStyle=col; ctx.lineWidth=w; ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1);
      ctx.moveTo(x1,y1); ctx.lineTo(x1-ux*6+uy*4, y1-uy*6-ux*4); ctx.moveTo(x1,y1); ctx.lineTo(x1-ux*6-uy*4, y1-uy*6+ux*4); ctx.stroke();
    }
  }
}
function drawGraticule(size){
  const ppd=pxPerDeg(), st=[1,2,5,10].find(s=>s*ppd>=70)||10, b=map.getBounds();
  ctx.save(); ctx.strokeStyle='rgba(10,17,24,.18)'; ctx.lineWidth=1; ctx.setLineDash([2,4]); ctx.beginPath();
  const labs=[];
  for (let la=Math.ceil(b.getSouth()/st)*st; la<=b.getNorth(); la+=st){ const y=map.latLngToContainerPoint([la,b.getWest()]).y; ctx.moveTo(0,y); ctx.lineTo(size.x,y); labs.push([`${Math.abs(la)}°${la>=0?'N':'S'}`, size.x-6, y-6, 'right']); }
  for (let lo=Math.ceil(b.getWest()/st)*st; lo<=b.getEast(); lo+=st){ const x=map.latLngToContainerPoint([b.getNorth(),lo]).x; ctx.moveTo(x,0); ctx.lineTo(x,size.y); labs.push([`${Math.abs(lo)}°${lo<0?'W':'E'}`, x+4, size.y-8, 'left']); }
  ctx.stroke(); ctx.setLineDash([]); ctx.font='500 10px "IBM Plex Mono",monospace'; ctx.textBaseline='alphabetic';
  for (const [t,x,y,al] of labs){ if (al==='left' && x<250 && y>size.y-80) continue; ctx.textAlign=al; ctx.fillStyle='rgba(255,255,255,.7)'; const w=ctx.measureText(t).width; ctx.fillRect(al==='right'?x-w-2:x-2,y-9,w+4,12); ctx.fillStyle='#0a1118'; ctx.fillText(t,x,y); }
  ctx.restore();
  // nautical-mile scale bar, measured at the chart centre (Mercator: 1 minute of latitude = 1 nm)
  const c=map.getCenter(), y0=map.latLngToContainerPoint([c.lat-0.5,c.lng]).y, y1=map.latLngToContainerPoint([c.lat+0.5,c.lng]).y, pxPerNm=Math.abs(y0-y1)/60;
  const nm=[10,20,25,50,100,200,250,500,1000].find(n=>n*pxPerNm>=80)||1000;
  nmBar.innerHTML=`<i style="width:${Math.round(nm*pxPerNm)}px"></i>${nm} nm`; 
  const zl=document.getElementById('zLvl'); if (zl) zl.textContent='×'+(map.getZoom()-2.5).toFixed(1).replace(/\.0$/,'');
}
function drawIsobars(t){
  const P=S.wx.d.p[t], f=4, ni=(NLAT-1)*f+1, nj=(NLON-1)*f+1, g=new Float32Array(ni*nj);
  let lo=1e9, hi=-1e9;
  for (let i=0;i<ni;i++) for (let j=0;j<nj;j++){ const v=val(P, LAT0+i*DLAT/f, LON0+j*DLON/f)/10; g[i*nj+j]=v; if(v<lo)lo=v; if(v>hi)hi=v; }
  const pt=(i,j)=>map.latLngToContainerPoint([LAT0+i*DLAT/f, LON0+j*DLON/f]);
  ctx.strokeStyle='rgba(10,17,24,.55)'; ctx.lineWidth=1; ctx.font='600 10px "IBM Plex Mono",monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const labels=[];
  for (let lev=Math.ceil(lo/2)*2; lev<=hi; lev+=2){
    ctx.beginPath(); let segs=[];
    for (let i=0;i<ni-1;i++) for (let j=0;j<nj-1;j++){
      const a=g[i*nj+j], b=g[i*nj+j+1], c=g[(i+1)*nj+j+1], d=g[(i+1)*nj+j], xs=[];
      const e=(v1,v2,p1,p2)=>{ if ((v1<lev)!==(v2<lev)){ const q=(lev-v1)/(v2-v1); xs.push([p1[0]+(p2[0]-p1[0])*q, p1[1]+(p2[1]-p1[1])*q]); } };
      e(a,b,[i,j],[i,j+1]); e(b,c,[i,j+1],[i+1,j+1]); e(c,d,[i+1,j+1],[i+1,j]); e(d,a,[i+1,j],[i,j]);
      for (let k=0;k+1<xs.length;k+=2){ const p1=pt(...xs[k]), p2=pt(...xs[k+1]); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); segs.push(p1); }
    }
    ctx.stroke();
    // label a few points per level, spaced apart
    const sz=map.getSize();
    for (let k=0;k<segs.length;k+=37){ const p=segs[k]; if (p.x<30||p.y<30||p.x>sz.x-30||p.y>sz.y-30) continue;
      if (labels.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<150)) continue; labels.push({x:p.x,y:p.y,t:String(lev)}); }
  }
  for (const l of labels){ ctx.fillStyle='rgba(255,255,255,.85)'; ctx.fillRect(l.x-15,l.y-7,30,14); ctx.fillStyle='#0a1118'; ctx.fillText(l.t,l.x,l.y+.5); }
}

// ---------- Zone statistics ----------
function zonePts(z){ const out=[]; for (let i=0;i<NLAT;i++){ const la=LAT0+i*DLAT; if (la<z.s-1e-9||la>z.n+1e-9) continue;
  for (let j=0;j<NLON;j++){ const lo=LON0+j*DLON; if (lo<z.w-1e-9||lo>z.e+1e-9) continue; const k=gi(i,j); if (sea[k]) out.push(k); } } return out; }
function circMean(dirs, wts){ let x=0,y=0; dirs.forEach((d,i)=>{ const w=wts?wts[i]:1, r=d*Math.PI/180; x+=Math.sin(r)*w; y+=Math.cos(r)*w; }); return (Math.atan2(x,y)*180/Math.PI+360)%360; }
const r5lo = v => Math.floor(v/5)*5, r5hi = v => Math.ceil(v/5)*5, h05 = v => (Math.round(v*2)/2).toFixed(1);
function zoneStat(z,t){
  const d=S.wx.d, ks=z.k; if (!ks.length) return null;
  const ws=ks.map(k=>d.ws[t][k]), wd=ks.map(k=>d.wd[t][k]), wg=ks.map(k=>d.wg[t][k]);
  const hs=ks.map(k=>d.hs[t][k]).filter(v=>v!=null).map(v=>v/10);
  const sh=ks.map(k=>d.sh[t][k]).filter(v=>v!=null).map(v=>v/10);
  const sd=ks.map(k=>d.sd[t][k]).filter(v=>v!=null), sp=ks.map(k=>d.sp[t][k]).filter(v=>v!=null), tp=ks.map(k=>d.tp[t][k]).filter(v=>v!=null);
  const r=ks.map(k=>d.r[t][k]??0), cape=ks.map(k=>d.cape[t][k]??0);
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const pct=(a,q)=>{ const b=[...a].sort((x,y)=>x-y), i=(b.length-1)*q, f=Math.floor(i); return b[f]+(b[Math.min(b.length-1,f+1)]-b[f])*(i-f); };
  let lo=r5lo(pct(ws,.15)), hi=r5hi(pct(ws,.85)); if (hi===lo) hi+=5;
  return { dir:circMean(wd,ws), wmean:mean(ws), wlo:lo, whi:hi, gust:Math.max(...wg),
    hlo:hs.length?pct(hs,.15):null, hhi:hs.length?pct(hs,.85):null, tp:tp.length?mean(tp):null,
    sdir:sd.length?circMean(sd,sh):null, sh:sh.length?mean(sh):null, sp:sp.length?mean(sp):null,
    rain:Math.max(...r)/10, cape:Math.max(...cape) };
}
const windTxt = s => `${compass(s.dir)} ${s.wlo}–${s.whi}`;
const seaTxt = s => s.hlo==null ? '–' : (h05(s.hlo)===h05(s.hhi) ? `${h05(s.hlo)}` : `${h05(s.hlo)}–${h05(s.hhi)}`);
const swellTxt = s => s.sh==null ? '–' : `${compass(s.sdir)} ${s.sh.toFixed(1)}m ${Math.round(s.sp)}s`;
function rainTxt(s){ if (s.rain>=5 || (s.rain>=1 && s.cape>=800)) return 'squalls'; if (s.rain>=1) return 'showers'; if (s.rain>=0.2) return 'isol.'; return ''; }

// ---------- Zones on the chart ----------
function buildZones(){
  zoneLayer.clearLayers();
  for (const z of ZONES){
    z.rect = L.rectangle([[z.s,z.w],[z.n,z.e]], { color:'#0a1118', weight:1.2, opacity:.65, fill:true, fillOpacity:0, interactive:false, dashArray:null }).addTo(zoneLayer);
  }
}
function updateLabels(){
  labelLayer.clearLayers();
  const a=map.latLngToContainerPoint([20,-40]), b=map.latLngToContainerPoint([20,-33]), compact=Math.abs(b.x-a.x)<100;
  for (const z of ZONES){
    const s=zoneStat(z,S.t); const sel=S.zone===z;
    z.rect.setStyle({ color: sel ? '#ffffff' : '#0a1118', weight: sel ? 3 : 1.2, opacity: sel ? 1 : .65 });
    if (sel) z.rect.bringToFront();
    const html = `<b>${z.id}</b>` + (s && !compact ? `<span>${S.layer==='sea'||S.layer==='swell' ? (S.layer==='sea' ? seaTxt(s)+' m' : swellTxt(s)) : windTxt(s)}</span>` : '');
    L.marker([z.la,z.lo], { interactive:false, keyboard:false, icon:L.divIcon({ className:'zlab'+(sel?' sel':''), html, iconSize:[96,34], iconAnchor:[48,17] }) }).addTo(labelLayer);
  }
}
const zoneAt = (la,lo) => ZONES.find(z => la>=z.s && la<=z.n && lo>=z.w && lo<=z.e) || null;

// ---------- Route, boat, GPX ----------
function buildRoute(){
  routeLayer.clearLayers();
  const gc = gcPoints(START, FINISH, 60), rh = rhumbNm(START, FINISH);
  L.polyline(gc.pts, { color:'#ffffff', weight:4, opacity:.6, interactive:false }).addTo(routeLayer);
  L.polyline(gc.pts, { color:'#0a1118', weight:1.6, dashArray:'6 5', interactive:false }).addTo(routeLayer);
  for (const p of [START, FINISH]) L.circleMarker([p.lat,p.lon], { radius:5, color:'#0a1118', weight:2, fillColor:'#ffffff', fillOpacity:1, interactive:false }).addTo(routeLayer);
  S.routeInfo = { gc: gc.nm, rh };
  if (S.route) routeLayer.addTo(map);
}
function drawBoat(){
  boatLayer.clearLayers();
  if (!S.boat) return;
  L.circleMarker([S.boat[0],S.boat[1]], { radius:9, color:'#ffffff', weight:3, fillColor:'#e0457b', fillOpacity:1, interactive:false }).addTo(boatLayer);
  L.circleMarker([S.boat[0],S.boat[1]], { radius:9, color:'#0a1118', weight:1, fill:false, interactive:false }).addTo(boatLayer);
}
function drawGpx(){
  gpxLayer.clearLayers(); if (!S.gpx) return;
  for (const line of S.gpx.lines){ L.polyline(line, { color:'#ffffff', weight:4.5, opacity:.7, interactive:false }).addTo(gpxLayer); L.polyline(line, { color:'#e0457b', weight:2.2, interactive:false }).addTo(gpxLayer); }
  for (const w of S.gpx.wpts) L.circleMarker(w, { radius:3, color:'#e0457b', weight:2, fillColor:'#fff', fillOpacity:1, interactive:false }).addTo(gpxLayer);
}
function parseGpx(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('not a GPX file');
  const num = el => [parseFloat(el.getAttribute('lat')), parseFloat(el.getAttribute('lon'))];
  const ok = p => isFinite(p[0]) && isFinite(p[1]);
  const lines = [];
  doc.querySelectorAll('rte').forEach(r => { const l=[...r.getElementsByTagName('rtept')].map(num).filter(ok); if (l.length>1) lines.push(l); });
  doc.querySelectorAll('trkseg').forEach(r => { const l=[...r.getElementsByTagName('trkpt')].map(num).filter(ok); if (l.length>1) lines.push(l); });
  const wpts = [...doc.getElementsByTagName('wpt')].map(num).filter(ok).slice(0,500);
  // thin very long tracks
  const thin = lines.map(l => l.length>2000 ? l.filter((_,i)=>i%Math.ceil(l.length/2000)===0) : l);
  if (!thin.length && !wpts.length) throw new Error('no route, track or waypoints found');
  return { lines: thin, wpts };
}

// ---------- Point readout ----------
function pointVals(la,lo,t){
  const d=S.wx.d, uv=(sp,di)=>{ const u=sp.map((s,k)=>s==null?null:-s*Math.sin(di[k]*Math.PI/180)), v=sp.map((s,k)=>s==null?null:-s*Math.cos(di[k]*Math.PI/180)); return [u,v]; };
  const key='uv'+t; if (!cache[key]) cache[key]=uv(d.ws[t],d.wd[t]);
  const [u,v]=cache[key], uu=val(u,la,lo), vv=val(v,la,lo), ws=val(d.ws[t],la,lo);
  if (ws==null) return null;
  const sdKey='swuv'+t; if (!cache[sdKey]) cache[sdKey]=uv(d.sh[t],d.sd[t]);
  const [su,sv]=cache[sdKey], su_=val(su,la,lo), sv_=val(sv,la,lo);
  const hKey='hwuv'+t; if (!cache[hKey]) cache[hKey]=uv(d.hs[t],d.hd[t]);
  const [hu,hv]=cache[hKey], hu_=val(hu,la,lo), hv_=val(hv,la,lo);
  const dirFrom=(a,b)=>(Math.atan2(-a,-b)*180/Math.PI+360)%360;
  return { ws, wd:dirFrom(uu,vv), wg:val(d.wg[t],la,lo), p:val(d.p[t],la,lo)/10, r:(val(d.r[t],la,lo)??0)/10, cape:val(d.cape[t],la,lo),
    hs:val(d.hs[t],la,lo), hd: hu_==null?null:dirFrom(hu_,hv_), tp:val(d.tp[t],la,lo), sh:val(d.sh[t],la,lo), sd: su_==null?null:dirFrom(su_,sv_), sp:val(d.sp[t],la,lo) };
}
function showReadout(){
  const el=$('readout'); ptLayer.clearLayers();
  if (!S.pt){ el.hidden=true; return; }
  const [la,lo]=S.pt, v=pointVals(la,lo,S.t), z=zoneAt(la,lo);
  L.circleMarker([la,lo], { radius:5, color:'#0a1118', weight:2, fillColor:'#fff', fillOpacity:1, interactive:false }).addTo(ptLayer);
  let rows='';
  if (v){
    const r=(a,b)=>rows+=`<dt>${a}</dt><dd>${b}</dd>`;
    r('Wind', `${compass(v.wd)} ${Math.round(v.ws)} kn · F${beaufort(v.ws)}`);
    r('Gusts', `${Math.round(v.wg)} kn`);
    r('Pressure', `${v.p.toFixed(0)} hPa`);
    if (v.hs!=null){ r('Sea', `${(v.hs/10).toFixed(1)} m · ${Math.round(v.tp)} s from ${compass(v.hd)}`); r('Swell', `${(v.sh/10).toFixed(1)} m · ${Math.round(v.sp)} s from ${compass(v.sd)}`); }
    r('Rain 6 h', `${v.r.toFixed(1)} mm`);
    r('CAPE', `${Math.round(v.cape/10)*10} J/kg`);
  } else rows='<dt>No forecast here</dt><dd></dd>';
  el.innerHTML = `<button class="x" aria-label="Close readout">×</button><h3>${fmtPos(la,lo)}${z?` · ${z.id}`:''}</h3><dl>${rows}</dl>`;
  el.querySelector('.x').onclick = () => { S.pt=null; showReadout(); };
  el.hidden=false;
}

// ---------- Side panel ----------
function overview(){
  const t=S.t, ri=S.routeInfo;
  const rows = ZONES.map(z => { const s=zoneStat(z,t); if (!s) return '';
    return `<tr data-z="${z.id}"><td><b>${z.id}</b></td><td><span class="sw" style="background:${css(colour('wind',s.wmean))}"></span>${windTxt(s)}</td><td>${Math.round(s.gust)}</td><td>${seaTxt(s)}</td><td>${rainTxt(s)}</td></tr>`; }).join('');
  const bz = S.boat ? zoneAt(S.boat[0],S.boat[1]) : null;
  return `<div class="eyebrow">All zones · ${tLabel(new Date(S.wx.times[t]))}</div>
  <h2>Fleet overview</h2>
  <p class="hint">Tap a zone on the chart, or a row below, for its bulletin. Tap anywhere for a point reading.</p>
  <div class="tbl"><table><thead><tr><th>Zone</th><th>Wind kn</th><th>Gust</th><th>Sea m</th><th>Rain</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${posBlock(bz)}
  <p class="note" style="margin-top:14px">Great circle ${Math.round(ri.gc).toLocaleString('en-GB')} nm · rhumb line ${Math.round(ri.rh).toLocaleString('en-GB')} nm, ${START.name} to ${FINISH.name}.</p>`;
}
function bulletin(z){
  const t0=S.t, steps=[]; for (let t=t0; t<S.wx.times.length && t<t0+4; t++) steps.push(zoneStat(z,t));
  const nxt=[]; for (let t=t0+4; t<S.wx.times.length && t<t0+8; t++) nxt.push(zoneStat(z,t));
  const sum = a => { if (!a.length) return ''; const dirs=[...new Set(a.map(s=>compass(s.dir)))];
    const lo=Math.min(...a.map(s=>s.wlo)), hi=Math.max(...a.map(s=>s.whi)), g=Math.max(...a.map(s=>s.gust));
    const hl=a.map(s=>s.hlo).filter(v=>v!=null), hh=a.map(s=>s.hhi).filter(v=>v!=null);
    const sq=a.map(rainTxt).includes('squalls') ? ' Squalls possible.' : a.map(rainTxt).includes('showers') ? ' Showers.' : '';
    const sw=a[0].sh!=null ? ` Swell ${compass(a[0].sdir)} ${a[0].sh.toFixed(1)} m, ${Math.round(a[0].sp)} s.` : '';
    return `${dirs.slice(0,3).join(' to ')} ${lo}–${hi} kn (F${beaufort(lo+1)}–${beaufort(hi)}), gusts ${Math.round(g)}.` +
      (hl.length ? ` Seas ${h05(Math.min(...hl))}–${h05(Math.max(...hh))} m.` : '') + sw + sq; };
  return `<div class="bulletin"><p><b>Next 24 h:</b> ${sum(steps)}</p>${nxt.length?`<p><b>Then:</b> ${sum(nxt)}</p>`:''}</div>`;
}
function zonePanel(z){
  const bz = S.boat ? zoneAt(S.boat[0],S.boat[1]) : null;
  let rows='', prevDay=null;
  S.wx.times.forEach((ts,t) => { const d=new Date(ts), s=zoneStat(z,t); const day=d.getUTCDate();
    const cls=[t===S.t?'cur':'', prevDay!==null&&day!==prevDay?'day':'', isLong(t)?'lr':''].filter(Boolean).join(' ');
    prevDay=day;
    rows += `<tr data-i="${t}" class="${cls}"><td>${DAY[d.getUTCDay()]} ${pad(day)} ${pad(d.getUTCHours())}Z</td><td><span class="sw" style="background:${css(colour('wind',s.wmean))}"></span>${windTxt(s)}</td><td>${beaufort(s.wmean)}</td><td>${Math.round(s.gust)}</td><td>${seaTxt(s)}</td><td>${swellTxt(s)}</td><td>${rainTxt(s)}</td></tr>`; });
  return `<button class="back" id="back">‹ All zones</button>
  <div class="eyebrow">Zone · ${z.s}°–${z.n}°N, ${Math.abs(z.e)}°–${Math.abs(z.w)}°W${bz===z?' · you are here':''}</div>
  <h2>${z.id}</h2>
  ${bulletin(z)}
  <div class="tbl"><table><thead><tr><th>UTC</th><th>Wind kn</th><th>Bf</th><th>Gust</th><th>Sea m</th><th>Swell</th><th>Rain</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note" style="margin-top:10px">Wind and sea ranges span the middle 70% of the zone's ${z.k.length} grid points (2° grid); wind rounded out to 5 kn. Gusts are the zone maximum.</p>
  ${posBlock(bz)}`;
}
function posBlock(bz){
  return `<div class="pos">
    <label for="posIn">Your position</label>
    <div class="row"><input type="text" id="posIn" inputmode="text" autocomplete="off" placeholder="17 32.5N 035 12.0W" value="${S.boat?esc(fmtPos(S.boat[0],S.boat[1]).replace(/[°′]/g,' ').replace(/\s+/g,' ')):''}">
    <button class="tbtn" id="posSet">Plot</button>${S.boat?'<button class="tbtn" id="posClr">Clear</button>':''}</div>
    <p class="note" id="posNote">${S.boat ? `Plotted ${fmtPos(S.boat[0],S.boat[1])}${bz?`, in zone <b>${bz.id}</b>`:', outside the zones'}.` : 'Degrees and decimal minutes, or decimal degrees (17.54, -35.2). Kept on this device only.'}</p>
    <label for="gpxIn">Your route (GPX from OpenCPN or a plotter)</label>
    <div class="row"><input type="file" id="gpxIn" accept=".gpx,application/gpx+xml,application/xml,text/xml" style="font-size:13px;max-width:100%">${S.gpx?'<button class="tbtn" id="gpxClr">Remove</button>':''}</div>
  </div>
  <p class="note" style="margin-top:16px"><b>Source.</b> ${esc(S.wx.model)}. 2° grid, 6-hourly. Fetched ${esc(S.wx.fetched.replace('T',' ').replace('Z',' UTC'))}. A model forecast, not an official bulletin: check against the ARC daily forecast, NOAA/NHC high-seas text and GRIBs. Squall flags are a rain/CAPE heuristic (low confidence); trade-wind squalls are smaller than this grid. Beyond 5 days (dashed on the time bar) treat as trend only.</p>`;
}
function renderSide(){
  const el=$('side'), keep=el.scrollTop;
  el.innerHTML = S.zone ? zonePanel(S.zone) : overview();
  el.querySelectorAll('tr[data-z]').forEach(tr => tr.onclick = () => selectZone(ZONES.find(z=>z.id===tr.dataset.z), true));
  el.querySelectorAll('tr[data-i]').forEach(tr => tr.onclick = () => setTime(+tr.dataset.i));
  const b=$('back'); if (b) b.onclick = () => selectZone(null);
  $('posSet').onclick = setPos; $('posIn').onkeydown = e => { if (e.key==='Enter') setPos(); };
  const pc=$('posClr'); if (pc) pc.onclick = () => { S.boat=null; store.set('boat',null); drawBoat(); if (window.CNAhead) CNAhead.boat(null); renderSide(); };
  const gc=$('gpxClr'); if (gc) gc.onclick = () => { S.gpx=null; store.set('gpx',null); drawGpx(); renderSide(); };
  $('gpxIn').onchange = e => { const f=e.target.files[0]; if (!f) return; const rd=new FileReader();
    rd.onload = () => { try { S.gpx=parseGpx(rd.result); store.set('gpx',S.gpx); drawGpx(); renderSide();
      const all=S.gpx.lines.flat().concat(S.gpx.wpts); if (all.length) map.fitBounds(all, {padding:[30,30], maxZoom:6}); }
      catch(err){ $('posNote').textContent = 'Could not read that file: ' + err.message + '.'; } };
    rd.readAsText(f); };
  if (S.zone){ const cur=el.querySelector('tr.cur'); if (cur && !renderSide.keep) cur.scrollIntoView({block:'center'}); else el.scrollTop=keep; }
  else el.scrollTop=keep;
  renderSide.keep=false;
}
function setPos(){
  const p=parsePos($('posIn').value);
  if (!p || Math.abs(p[0])>90 || Math.abs(p[1])>180){ $('posNote').textContent='Could not read that. Try 17 32.5N 035 12.0W or 17.54, -35.2.'; return; }
  S.boat=p; store.set('boat',p); drawBoat(); if (window.CNAhead) CNAhead.boat(S.boat); const z=zoneAt(p[0],p[1]); if (z) S.zone=z; updateLabels(); renderSide();
  map.panTo(p);
}
function selectZone(z, pan){ S.zone=z; updateLabels(); renderSide(); if (z && pan) map.panTo([z.la,z.lo]); }

// ---------- Time ----------
const isLong = t => (new Date(S.wx.times[t]) - new Date(S.wx.times[0])) > 5*86400e3;
function setTime(t){
  S.t=Math.max(0,Math.min(S.wx.times.length-1,t)); $('slider').value=S.t;
  const d=new Date(S.wx.times[S.t]), h=Math.round((d-Date.now())/3600e3);
  const rel = Math.abs(h)<=3 ? 'now' : (h>0 ? `+${h} h` : `${h} h`);
  $('tnow').innerHTML = `<span>${tLabel(d)}</span><em>${rel}</em>${isLong(S.t)?'<em class="lr">beyond 5 days: trend only</em>':''}`;
  redraw(); updateLabels(); showReadout(); renderSide.keep=false; renderSide();
}
function buildDays(){
  const el=$('days'), n=S.wx.times.length-1; let html='';
  const nd=S.wx.times.filter(ts=>new Date(ts).getUTCHours()===0).length, every=el.clientWidth/nd<46?2:1; let di=0;
  S.wx.times.forEach((ts,t)=>{ const d=new Date(ts); if (d.getUTCHours()===0 && (di++)%every===0) html+=`<i style="left:${t/n*100}%">${DAY[d.getUTCDay()]} ${d.getUTCDate()}</i>`; });
  const lr = S.wx.times.findIndex((_,t)=>isLong(t)); if (lr>0) html += `<span class="lrband" style="left:${lr/n*100}%"></span>`;
  el.innerHTML=html;
}
function legend(){
  const sc=SCALES[S.layer], el=$('legend'), max=sc.ticks[sc.ticks.length-1];
  const grad = sc.ticks.length ? Array.from({length:21},(_,i)=>{ const v=i/20*max; return `${css(colour(S.layer,v))} ${i*5}%`; }).join(',') : '';
  el.innerHTML = `<div class="ttl">${sc.title}</div><div class="bar" style="background:linear-gradient(90deg,${grad})"></div><div class="ticks">${sc.ticks.map(v=>`<i style="left:${v/max*100}%">${v}</i>`).join('')}</div>`;
  el.hidden=false;
}
function age(){
  const h=(Date.now()-new Date(S.wx.fetched.replace(/Z$/,':00Z')))/3600e3, el=$('age');
  el.textContent = `Forecast ${S.wx.fetched.slice(8,10)}/${S.wx.fetched.slice(5,7)} ${S.wx.fetched.slice(11,16)} UTC · ${h<1?'<1':Math.round(h)} h old`;
  el.className = 'age' + (h>48?' stale':h>18?' old':'');
}

// ---------- Wiring ----------
$('layers').onclick = e => { const b=e.target.closest('button'); if (!b) return; S.layer=b.dataset.l; store.set('layer',S.layer);
  $('layers').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed', x===b)); legend(); redraw(); updateLabels(); };
$('bIso').onclick = e => { S.iso=!S.iso; store.set('iso',S.iso); e.currentTarget.setAttribute('aria-pressed',S.iso); redraw(); };
$('bRoute').onclick = e => { S.route=!S.route; store.set('route',S.route); e.currentTarget.setAttribute('aria-pressed',S.route); S.route?routeLayer.addTo(map):routeLayer.remove(); };
$('bNight').onclick = e => { S.night=!S.night; document.body.classList.toggle('night',S.night); e.currentTarget.setAttribute('aria-pressed',S.night); };
$('slider').oninput = e => setTime(+e.target.value);
$('play').onclick = () => {
  if (S.play){ clearInterval(S.play); S.play=null; $('play').textContent='▶'; $('play').setAttribute('aria-label','Play forecast'); return; }
  $('play').textContent='❚❚'; $('play').setAttribute('aria-label','Pause');
  S.play = setInterval(()=>{ setTime(S.t>=S.wx.times.length-1?0:S.t+1); }, 900);
};
document.addEventListener('keydown', e => { if (e.target.matches('input[type=text]')) return;
  if (e.key==='ArrowRight'){ setTime(S.t+1); e.preventDefault(); } if (e.key==='ArrowLeft'){ setTime(S.t-1); e.preventDefault(); } });
map.on('moveend zoomend resize', redraw);
map.on('zoomend resize', () => S.wx && updateLabels());
map.on('click', e => { const {lat,lng}=e.latlng; S.pt=[lat,lng]; const z=zoneAt(lat,lng); if (z) S.zone=z; updateLabels(); showReadout(); renderSide(); });

// ---------- Load ----------
Promise.all([fetch('/atlantic/wx.json',{cache:'no-cache'}).then(r=>{ if(!r.ok) throw 0; return r.json(); }), fetch('/atlantic/land.json').then(r=>{ if(!r.ok) throw 0; return r.json(); })])
.then(([wx, land]) => {
  S.wx=wx; S.land=land;
  LAT0=wx.lats[0]; LON0=wx.lons[0]; DLAT=wx.lats[1]-wx.lats[0]; DLON=wx.lons[1]-wx.lons[0]; NLAT=wx.lats.length; NLON=wx.lons.length;
  sea = wx.d.hs[0].map(v => v!=null); seaF = sea.map(b => b?1:0);
  ZONES.forEach(z => z.k = zonePts(z));
  $('msg').remove();
  $('slider').max = wx.times.length-1;
  $('layers').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed', x.dataset.l===S.layer));
  $('bIso').setAttribute('aria-pressed',S.iso); $('bRoute').setAttribute('aria-pressed',S.route);
  buildZones(); buildRoute(); drawBoat(); drawGpx(); buildDays(); legend(); age(); setInterval(age, 600e3);
  let t0 = wx.times.findIndex(ts => new Date(ts) >= Date.now() - 3*3600e3); if (t0<0) t0=wx.times.length-1;
  if (window.CNAhead) CNAhead.ready(wx, S.boat, FINISH);   // option A list view (atlantic-ahead.js)
  if (!S.boat) fetch('/api/positions/latest').then(r=>r.ok?r.json():null).then(p=>{ if (p && p.lat!=null && Math.abs(p.lat)>0){ S.boat=[p.lat,p.lon]; S.boatAuto=true; drawBoat(); if (window.CNAhead) CNAhead.boat(S.boat); const z=zoneAt(p.lat,p.lon); if (z){ S.zone=z; updateLabels(); renderSide(); } } }).catch(()=>{});
  if (S.boat){ const z=zoneAt(S.boat[0],S.boat[1]); if (z) S.zone=z; }
  setTime(t0);
})
.catch(() => { $('msg').textContent = 'The forecast data did not load. Reload the page when you have signal.'; if (window.CNAhead) CNAhead.failed(); });
})();