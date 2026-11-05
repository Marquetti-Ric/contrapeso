const { chromium } = require('playwright');
(async()=>{const M=process.argv[2];const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'}).catch(()=>chromium.launch());
const p=await b.newPage();await p.goto('file://'+M+'/manual.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(500);
// cover only
await p.addStyleTag({content:'body>section:not(.cover){display:none}'});
await p.pdf({path:M+'/cover.pdf',format:'A4',printBackground:true,preferCSSPageSize:true});
await p.reload();await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(400);
await p.addStyleTag({content:'.cover{display:none}'});
await p.pdf({path:M+'/body.pdf',format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,outline:true,tagged:true,headerTemplate:'<div></div>',
 footerTemplate:'<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#56645E;padding:0 17mm;display:flex;justify-content:space-between"><span>Contrapeso · Manual de uso</span><span class="pageNumber"></span></div>'});
await b.close();})();
