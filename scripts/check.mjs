// Verificações antes de publicar: HTML bem formado no essencial, scripts sem erro de sintaxe,
// nenhuma referência a marcas de terceiros e modelos de cálculo com resultados coerentes.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = new URL('../site/', import.meta.url).pathname;
const pages = [];
(function walk(d){ for (const f of readdirSync(d)) { const p = join(d,f); statSync(p).isDirectory() ? walk(p) : f.endsWith('.html') && pages.push(p); } })(root);
let fail = 0;
const err = (m) => { console.error('ERRO:', m); fail++; };

for (const p of pages) {
  const h = readFileSync(p, 'utf8');
  if (!/<title>[^<]+<\/title>/.test(h)) err(`${p}: sem <title>`);
  if (/�/.test(h)) err(`${p}: caractere inválido`);
  if (/\bGPA\b|Pão de Açúcar/.test(h)) err(`${p}: menção a marca de terceiros`);
  for (const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { new vm.Script(m[1], { filename: p }); } catch (e) { err(`${p}: ${e.message}`); }
  }
  for (const m of h.matchAll(/href="(\.\.?\/[^"#]*)"/g)) {
    const target = join(p, '..', m[1]);
    const ok = (() => { try { const s = statSync(target); return s.isFile() || statSync(join(target,'index.html')).isFile(); } catch { return false; } })();
    if (!ok) err(`${p}: link quebrado ${m[1]}`);
  }
}

function model(file) {
  const h = readFileSync(join(root, file), 'utf8');
  const s = h.indexOf('// MODEL-START'), e = h.indexOf('// MODEL-END');
  if (s < 0 || e < 0) { err(`${file}: marcadores do modelo ausentes`); return null; }
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(h.slice(s, e).replace(/^const /gm, 'var ').replace(/^function /gm, 'function '), ctx);
  return ctx;
}

const sim = model('simulador/index.html');
if (sim) {
  const S = JSON.parse(JSON.stringify(sim.DEFAULTS));
  const r26 = sim.model(S, S.base, 2026), r33 = sim.model(S, S.plan, 2033), b33 = sim.model(S, S.base, 2033);
  if (Math.abs(r26.net) > 0.01) err(`simulador: 2026 deveria ser neutro (${r26.net})`);
  if (!(r33.net > b33.net)) err('simulador: plano deveria superar o cenário base em 2033');
  console.log(`simulador ok · 2033 base ${b33.net.toFixed(1)} · plano ${r33.net.toFixed(1)} R$ mi`);
}
const neg = model('negociador/index.html');
if (neg) {
  const P = JSON.parse(JSON.stringify(neg.DEFAULT_P));
  const banana = { preco: 3.49, icmsC: 0, pcF: 0, pcV: 'zero', ncm: '08039000', qtd: 1, pv: 6.99 };
  const r = neg.calc(banana, 2027, P, { mode: 'preco' });
  if (Math.abs(r.neutral - 3.49) > 1e-9) err('negociador: banana com alíquota zero deveria manter o preço');
  const item = { preco: 10, icmsC: 18, pcF: 9.25, pcV: 'tributado', ncm: '19053100', qtd: 1, pv: 15, icmsV: 18 };
  const a = neg.calc(item, 2027, P, { mode: 'margem' });
  if (Math.abs(a.my - a.m0) > 1e-9) err('negociador: modo "manter margem" não manteve a margem');
  const t = neg.calc(item, 2026, P, { mode: 'preco' });
  if (Math.abs(t.neutral - 10) > 1e-9) err('negociador: 2026 deveria ser neutro');
  console.log(`negociador ok · item padrão: neutro 2027 ${a.neutral.toFixed(4)}, margem ${(a.m0*100).toFixed(2)}%`);
}

if (fail) { console.error(`${fail} problema(s).`); process.exit(1); }
console.log(`${pages.length} páginas verificadas.`);
