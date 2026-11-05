const { chromium } = require('playwright');const fs=require('fs');const path=require('path');
const M=process.argv[2], XLSX=process.argv[3], SITE='file:///home/claude/contrapeso/site/';
const boxes={};
(async()=>{
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'}).catch(()=>chromium.launch());
const ctx=await b.newContext({viewport:{width:1360,height:900},deviceScaleFactor:2,colorScheme:'light',acceptDownloads:true});
await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:fs.readFileSync(M+'/fonts.css','utf8'),contentType:'text/css'}));
await ctx.route('https://cdnjs.cloudflare.com/**',r=>r.fulfill({body:fs.readFileSync(XLSX),contentType:'application/javascript'}));
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
async function shot(name,clip,marks){
  // clip: element selector or {x,y,width,height}
  let c=clip; if(typeof clip==='string'){const el=await p.$(clip);await el.scrollIntoViewIfNeeded();const bb=await el.boundingBox();c=bb;}
  if(c.maxH&&c.height>c.maxH)c.height=c.maxH;
  const sx=await p.evaluate(()=>[scrollX,scrollY]);
  await p.screenshot({path:`${M}/img/${name}.png`,clip:{x:c.x,y:c.y,width:c.width,height:c.height}});
  const mk=[];
  for(const [n,sel] of (marks||[])){const el=await p.$(sel);if(!el){console.log('miss',name,sel);continue}const bb=await el.boundingBox();
    mk.push({n,x:(bb.x-c.x)/c.width,y:(bb.y-c.y)/c.height,w:bb.width/c.width,h:bb.height/c.height});}
  boxes[name]={ratio:c.width/c.height,marks:mk};
}
async function el(sel,maxH){const e=await p.$(sel);await e.scrollIntoViewIfNeeded();const bb=await e.boundingBox();return {...bb,height:Math.min(bb.height,maxH||bb.height)}}
// LANDING
await p.goto(SITE+'index.html');await p.waitForTimeout(600);
await shot('landing',{x:0,y:0,width:1360,height:860},[[1,'a.tool[href="simulador/"]'],[2,'a.tool[href="negociador/"]']]);
// SIMULADOR
await p.goto(SITE+'simulador/index.html');await p.evaluate(()=>localStorage.clear());await p.reload();await p.waitForTimeout(700);
await shot('sim-topo',{x:0,y:0,width:1360,height:900},[[1,'#years'],[2,'aside.levers'],[3,'.kpis'],[4,'.prodnav']]);
await shot('sim-grafico',await el('section[aria-labelledby="h-time"]'),[[1,'#legend'],[2,'#chart'],[3,'#timeline']]);
await shot('sim-acoes',await el('section[aria-labelledby="h-act"]',620),[]);
await shot('sim-uf',await el('section[aria-labelledby="h-uf"]'),[[1,'#btnCopy'],[2,'#tUF tbody tr:first-child td:last-child']]);
await p.click('#ptabs button:nth-child(2)');await p.waitForTimeout(200);
await shot('sim-premissas',await el('section[aria-labelledby="h-par"]',700),[[1,'#ptabs'],[2,'#btnReset']]);
// NEGOCIADOR
await p.goto(SITE+'negociador/index.html');await p.evaluate(()=>localStorage.clear());await p.reload();await p.waitForTimeout(800);
const c1=await el('.controls'),k1=await el('.kpis');
await p.evaluate(()=>scrollTo(0,0));
const cc=await p.$eval('.controls',e=>e.getBoundingClientRect().toJSON()), kk=await p.$eval('.kpis',e=>e.getBoundingClientRect().toJSON());
await shot('neg-controles',{x:cc.x-4,y:cc.y-4,width:cc.width+8,height:kk.bottom-cc.y+8},[[1,'#c_year'],[2,'#c_mode'],[3,'#c_forn'],[4,'#b_open'],[5,'#b_xls'],[6,'#b_forn'],[7,'.kpis']]);
// open items under first supplier: click Bebidas, Cervejas, Horizonte Core
await p.evaluate(()=>{const k='contrapeso-negociador-v1';const o=JSON.parse(localStorage.getItem(k));const f='/11111111000191';o.open={[f]:true,[f+'/Bebidas']:true,[f+'/Bebidas/Cervejas']:true,[f+'/Bebidas/Cervejas/Horizonte Core']:true,[f+'/Bebidas/Cervejas/Horizonte High End']:true};localStorage.setItem(k,JSON.stringify(o))});
await p.reload();await p.waitForTimeout(700);
await p.setViewportSize({width:1900,height:900});await p.waitForTimeout(300);await shot('neg-mesa',await el('#tree',640),[[1,'#tree tr.g1 .cell-in'],[2,'#tree tr.it .cell-in'],[3,'#tree tr.it td:last-child .chip']]);
await p.setViewportSize({width:1360,height:900});await p.waitForTimeout(200);await p.click('#tree tr.it');await p.waitForTimeout(300);
await shot('neg-memoria',await el('#memo'),[]);
await p.click('[data-tab=imp]');await p.waitForTimeout(200);
await shot('neg-importar',await el('#tab-imp .card',560),[[1,'#drop'],[2,'#f_mode'],[3,'#b_tpl'],[4,'#b_sample']]);
await p.setInputFiles('#f_in',[M+'/cad-exemplo.csv']);await p.waitForTimeout(400);
await shot('neg-mapear',await el('#mapper'),[[1,'#mapper select[data-h="2"]'],[2,'#m_ok']]);
await p.click('#m_no');
await p.click('[data-tab=api]');await p.waitForTimeout(200);
await shot('neg-api',await el('#tab-api .card'),[[1,'#a_url'],[2,'#a_hv'],[3,'#a_path'],[4,'#a_go']]);
await p.click('[data-tab=par]');await p.waitForTimeout(200);
await shot('neg-regras',await el('#tab-par .card:nth-child(2)',560),[[1,'#b_addrule']]);
fs.writeFileSync(M+'/boxes.json',JSON.stringify(boxes,null,1));
console.log('ok',Object.keys(boxes).length,'errors',errs);await b.close();
})();
