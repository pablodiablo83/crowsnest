const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:900,height:1000},deviceScaleFactor:2});
await p.goto('file://'+process.argv[2]+'/mock.html',{waitUntil:'networkidle'});await p.evaluate(()=>document.fonts.ready);
const s=await p.$$('.sheet');for(let i=0;i<s.length;i++)await s[i].screenshot({path:process.argv[2]+'/option-'+'AB'[i]+'.png'});
await p.pdf({path:process.argv[2]+'/atlantic-mockups.pdf',width:'900px',height:'1060px',printBackground:true});await b.close()})();
