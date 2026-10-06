const B=process.env.BASE||'http://localhost:8091', J={'Content-Type':'application/json'};
const req=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:J,body:b?JSON.stringify(b):undefined});return {s:r.status,d:await r.json().catch(()=>null)};};
let fails=0; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) fails++;};
const iso=ms=>new Date(ms).toISOString();
(async()=>{
  const decl={rested:'yes',ackRecords:true,ackEmergency:true,under18:false,declaredBy:'seafarer'};
  const c=(await req('POST','/api/crew',{name:'Pabs'})).d;
  const now=Date.now();
  // queued first WORK with declaration, 50 min ago -> starts voyage at that time
  let r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'t1',at:iso(now-50*60000),declaration:decl});
  ok(r.s===200&&r.d.startedVoyage&&r.d.start===iso(now-50*60000),'queued first WORK starts voyage at tap time');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'t1',at:iso(now-50*60000),declaration:decl});
  ok(r.s===200&&r.d.duplicate,'replay of same tapId is a duplicate');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'rest',tapId:'t2',at:iso(now-30*60000)});
  ok(r.s===200&&r.d.closedId&&r.d.start===iso(now-30*60000),'queued REST closes WORK at tap time');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'t0',at:iso(now-40*60000)});
  ok(r.s===409&&r.d.code==='tap_out_of_order','older tap after newer one -> 409 tap_out_of_order');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'t3',at:iso(now+20*60000)});
  ok(r.s===400,'future tap rejected');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'bad id!'});
  ok(r.s===400,'bad tapId rejected');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',at:'2026-10-06T10:00:00'});
  ok(r.s===400,'zone-less at rejected');
  // live tap, no at -> server time
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'t4'});
  ok(r.s===200&&Math.abs(Date.parse(r.d.start)-Date.now())<5000,'live tap uses server time');
  // undo then replay -> still duplicate (not re-applied)
  const u=await req('POST',`/api/crew/${c.id}/quicklog-undo`,{newId:r.d.id,prevId:r.d.closedId});
  ok(u.s===200,'undo of live tap via closedId');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'t4',at:iso(now)});
  ok(r.d&&r.d.duplicate,'undone tap is not re-applied on replay');
  const es=(await req('GET',`/api/crew/${c.id}/entries`)).d;
  ok(es.length===2&&!es[0].end&&es[0].type==='rest','entries: WORK closed, REST open');
  const au=(await req('GET','/api/entries-audit?limit=50')).d;
  ok(au.some(a=>a.source==='quicklog-queued'),'audit marks queued taps');
  // voyage ended, then queued REST arrives -> voyage_not_started
  await req('POST',`/api/crew/${c.id}/voyage/end`,{});
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'rest',tapId:'t5',at:iso(Date.now()-60000)});
  ok(r.s===409&&r.d.code==='voyage_not_started','queued REST after voyage end -> 409');
  r=await req('POST',`/api/crew/${c.id}/quicklog`,{type:'work',tapId:'t6',at:iso(now-10*60000),declaration:decl});
  ok(r.s===409&&r.d.code==='tap_conflict','queued voyage start overlapping the ended voyage -> 409');
  console.log(fails?fails+' FAILED':'ALL PASS'); process.exit(fails?1:0);
})();
