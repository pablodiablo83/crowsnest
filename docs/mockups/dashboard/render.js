const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1260,height:1000}});
for(const k of ['A','B','C']){await p.goto('file://'+process.argv[2]+'/'+k+'.html',{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);
 const el=await p.$('.sheet');await el.screenshot({path:process.argv[2]+'/option-'+k+'.png'});
 // a night iPad crop too
 await p.evaluate(()=>{document.querySelector('.ipad .scr').classList.remove('day');document.querySelector('.ipad .scr').classList.add('night')});await (await p.$('.ipad')).screenshot({path:process.argv[2]+'/ipad-night-'+k+'.png'});}
await b.close()})();
