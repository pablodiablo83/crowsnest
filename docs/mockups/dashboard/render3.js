const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1420,height:1000}});
for(const k of ['C3a','C3b']){await p.goto('file://'+process.argv[2]+'/'+k+'.html',{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);await (await p.$('.sheet')).screenshot({path:process.argv[2]+'/'+k+'.png'});}
await b.close()})();
