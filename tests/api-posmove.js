const B=process.env.BASE||'http://localhost:8091', J={'Content-Type':'application/json'};
const req=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:J,body:b?JSON.stringify(b):undefined});return {s:r.status,d:await r.json().catch(()=>null)};};
let fails=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) fails++;};
(async()=>{
  await require('./lib/session')(B);
  const ts=new Date(Date.now()-3600000).toISOString();
  let r=await req('POST','/api/positions',{id:'pm1',ts,lat:55.8,lon:-4.9,acc:20,source:'tap'});
  ok(r.s===201,'position created');
  r=await req('PUT','/api/positions/pm1',{lat:55.8687,lon:-4.7613});
  ok(r.s===200&&r.d.lat===55.8687&&r.d.lon===-4.7613&&r.d.acc===null&&r.d.source==='typed'&&r.d.ts===ts,'move keeps time, clears accuracy, marks typed');
  r=await req('PUT','/api/positions/pm1',{lat:91,lon:0}); ok(r.s===400,'lat out of range rejected');
  r=await req('PUT','/api/positions/pm1',{lat:0,lon:0}); ok(r.s===400,'0,0 rejected');
  r=await req('PUT','/api/positions/pm1',{lat:'x',lon:1}); ok(r.s===400,'non-number rejected');
  r=await req('PUT','/api/positions/nope',{lat:55,lon:-4}); ok(r.s===404,'unknown id 404');
  r=await req('DELETE','/api/positions/pm1'); r=await req('PUT','/api/positions/pm1',{lat:55,lon:-4}); ok(r.s===404,'deleted position cannot be moved');
  const un=await fetch.unsigned(B+'/api/positions/pm1',{method:'PUT',headers:J,body:'{"lat":55,"lon":-4}'});
  ok(un.status===401||un.status===302||un.status===403,'closed without a session');
  process.exit(fails?1:0);
})();
