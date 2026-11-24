const wx = require('/home/user/crowsnest/public/atlantic/wx.json');
const NLAT=wx.lats.length,NLON=wx.lons.length,LAT0=wx.lats[0],LON0=wx.lons[0],DL=2;
const gi=(i,j)=>i*NLON+j;
function val(arr,lat,lon){const fi=(lat-LAT0)/DL,fj=(lon-LON0)/DL;const i0=Math.max(0,Math.min(NLAT-2,Math.floor(fi))),j0=Math.max(0,Math.min(NLON-2,Math.floor(fj)));const a=Math.max(0,Math.min(1,fi-i0)),b=Math.max(0,Math.min(1,fj-j0));let s=0,w=0;for(const[i,j,ww]of[[i0,j0,(1-a)*(1-b)],[i0,j0+1,(1-a)*b],[i0+1,j0,a*(1-b)],[i0+1,j0+1,a*b]]){const v=arr[gi(i,j)];if(v!=null&&ww>0){s+=v*ww;w+=ww}}return w>.2?s/w:null}
function dirv(sarr,darr,lat,lon){ // average direction via vectors
  const u=[],v=[];const fi=(lat-LAT0)/DL,fj=(lon-LON0)/DL;const i=Math.round(fi),j=Math.round(fj);return darr[gi(Math.max(0,Math.min(NLAT-1,i)),Math.max(0,Math.min(NLON-1,j)))];}
const bf=k=>[1,3,6,10,16,21,27,33,40,47,55,63].findIndex(x=>k<x)<0?12:[1,3,6,10,16,21,27,33,40,47,55,63].findIndex(x=>k<x);
const pt=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];const card=d=>pt[Math.round(((d%360)+360)%360/22.5)%16];
const boat={lat:17.19,lon:-52.43}, fin={lat:14.08,lon:-60.95}, kn=6.5;
const nowIdx=wx.times.indexOf('2026-11-24T18:00Z');
const dlat=fin.lat-boat.lat, dlon=(fin.lon-boat.lon)*Math.cos((boat.lat+fin.lat)/2*Math.PI/180), dist=Math.hypot(dlat,dlon)*60;
const out=[];
for(let k=nowIdx;k<wx.times.length;k++){const h=(k-nowIdx)*6;const f=Math.min(1,h*kn/dist);const lat=boat.lat+(fin.lat-boat.lat)*f,lon=boat.lon+(fin.lon-boat.lon)*f;
  const D=wx.d, g=n=>val(D[n][k],lat,lon);
  const ws=g('ws');out.push({t:wx.times[k],h,lat:+lat.toFixed(2),lon:+lon.toFixed(2),nm:Math.round(Math.min(dist,h*kn)),ws:Math.round(ws),bf:bf(ws),wd:card(dirv(0,D.wd[k],lat,lon)),wdd:Math.round(dirv(0,D.wd[k],lat,lon)),wg:Math.round(g('wg')),hs:+(g('hs')/10).toFixed(1),tp:Math.round(g('tp')),hd:card(dirv(0,D.hd[k],lat,lon)),sh:+(g('sh')/10).toFixed(1),sd:card(dirv(0,D.sd[k],lat,lon)),r:+(g('r')/10).toFixed(1),cape:Math.round(g('cape')),p:Math.round(g('p')/10),arr:f>=1});
  if(f>=1&&out.filter(o=>o.arr).length>1)break;}
// field for the map: ws at now and +48h for the box 8..24N, -64..-44
const field=t=>{const a=[];for(let i=0;i<NLAT;i++)for(let j=0;j<NLON;j++)a.push([wx.lats[i],wx.lons[j],wx.d.ws[t][gi(i,j)],wx.d.wd[t][gi(i,j)],wx.d.hs[t][gi(i,j)]]);return a};
require('fs').writeFileSync(process.argv[2],JSON.stringify({dist:Math.round(dist),rows:out,field:{now:field(nowIdx)},fetched:wx.fetched}));
console.log('dist',Math.round(dist));out.forEach(o=>console.log(o.t,o.h,o.lat,o.lon,'F'+o.bf,o.wd,o.ws,'g'+o.wg,o.hs+'m',o.tp+'s',o.r,'mm cape',o.cape));
