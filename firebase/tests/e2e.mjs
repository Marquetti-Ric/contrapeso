// Teste de ponta a ponta com os emuladores de Auth e Firestore.
// Uso: npx firebase emulators:exec --only auth,firestore --project demo-contrapeso "node firebase/tests/e2e.mjs"
// Requer o site servido em http://127.0.0.1:8081 (python3 -m http.server 8081 -d site).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const W = 'http://127.0.0.1:8081/';
const P = 'demo-contrapeso';
const AUTH = 'http://127.0.0.1:9099';
const OUT = process.env.E2E_OUT || 'e2e-telas';
mkdirSync(OUT, { recursive: true });
const CFG = `window.CONTRAPESO_CONFIG={firebase:{apiKey:"fake-api-key",authDomain:"127.0.0.1",projectId:"${P}",appId:"1:1:web:1"},emulador:{auth:"${AUTH}",firestore:["127.0.0.1",8085]}};`;
const res = [];
const ok = (t, c) => { res.push([t, !!c]); console.log((c ? 'OK    ' : 'FALHA ') + t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oob(email, tipo) {
  for (let i = 0; i < 20; i++) {
    const r = await (await fetch(`${AUTH}/emulator/v1/projects/${P}/oobCodes`)).json();
    const c = (r.oobCodes || []).filter((x) => x.email === email && x.requestType === tipo).pop();
    if (c) return c.oobCode;
    await sleep(300);
  }
  throw new Error('sem código ' + tipo + ' para ' + email);
}
const api = (rota, corpo) => fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${rota}?key=fake-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).then((r) => r.json());

async function novaPagina(b) {
  const c = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await c.route('**/app/config.js', (r) => r.fulfill({ body: CFG, contentType: 'application/javascript' }));
  const p = await c.newPage();
  p.on('pageerror', (e) => console.log('  erro na página:', e.message));
  return p;
}
const salvo = (p) => p.waitForFunction(() => document.getElementById('conta-estado')?.textContent === 'Salvo', null, { timeout: 20000 });

async function criarEmpresa(p, empresa, nome, email, senha) {
  await p.goto(W + 'entrar/?aba=criar');
  await p.waitForSelector('#f-criar:not([hidden])');
  await p.fill('#c-empresa', empresa); await p.fill('#c-nome', nome); await p.fill('#c-email', email);
  await p.fill('#c-senha', senha); await p.fill('#c-senha2', senha);
  await p.click('#b-criar');
  await p.waitForURL(/empresa\//, { timeout: 20000 });
  await p.waitForFunction(() => document.getElementById('e-nome')?.textContent.length > 0, null, { timeout: 20000 });
}
async function confirmarEmail(p, email) {
  const code = await oob(email, 'VERIFY_EMAIL');
  await api('accounts:update', { oobCode: code });
  await p.click('#b-ja-confirmei');
  await p.waitForFunction(() => document.getElementById('c-verificar').hidden, null, { timeout: 20000 });
}
async function aceitarConvite(b, email, senha, nome) {
  const code = await oob(email, 'PASSWORD_RESET');
  await api('accounts:resetPassword', { oobCode: code, newPassword: senha });
  const p = await novaPagina(b);
  await p.goto(W + 'entrar/?fluxo=convite&email=' + encodeURIComponent(email));
  await p.waitForSelector('#f-entrar:not([hidden])');
  const preenchido = await p.inputValue('#e-email');
  await p.fill('#e-senha', senha); await p.click('#b-entrar');
  await p.waitForURL(/empresa\//, { timeout: 20000 });
  await p.waitForFunction(() => document.getElementById('quem')?.textContent.length > 0, null, { timeout: 20000 });
  const precisaConfirmar = !(await p.$eval('#c-verificar', (e) => e.hidden));
  if (precisaConfirmar) {
    await p.click('#b-reenviar-ver');
    await confirmarEmail(p, email);
  }
  return { p, preenchido, precisaConfirmar };
}

const b = await chromium.launch();
try {
  const a = await novaPagina(b);
  await a.goto(W + 'negociador/');
  await a.waitForURL(/entrar\//, { timeout: 20000 });
  ok('Ferramenta sem login leva ao login', a.url().includes('volta='));
  await a.screenshot({ path: OUT + '/login.png' });

  // Alice cria a empresa
  await criarEmpresa(a, 'Mercado Alfa', 'Alice Souza', 'alice@alfa.test', 'Senha1234');
  ok('Criar empresa leva ao painel como admin', (await a.textContent('#e-nome')) === 'Mercado Alfa' && (await a.textContent('#e-papel')).includes('Admin'));
  ok('Painel pede confirmação de e-mail', !(await a.$eval('#c-verificar', (e) => e.hidden)));
  await confirmarEmail(a, 'alice@alfa.test');
  ok('Confirmação de e-mail reconhecida', true);

  // Convites
  for (const [email, nome, papel] of [['bruno@alfa.test', 'Bruno Lima', 'leitor'], ['dora@alfa.test', null, 'editor']]) {
    await a.fill('#i-email', email); if (nome) await a.fill('#i-nome', nome); await a.selectOption('#i-papel', papel);
    await a.click('#b-convidar');
    await a.waitForFunction((e) => document.getElementById('m-usuarios').textContent.includes(e), email, { timeout: 20000 });
  }
  ok('Convites enviados', (await a.textContent('#m-usuarios')).includes('Convite enviado'));
  await a.waitForFunction(() => document.querySelectorAll('#t-usuarios .chip.w').length === 2, null, { timeout: 20000 });
  ok('Lista mostra 2 convites pendentes', true);
  await a.screenshot({ path: OUT + '/empresa.png', fullPage: true });

  // Negociador e Simulador salvam na empresa
  await a.goto(W + 'negociador/'); await a.waitForSelector('.conta', { timeout: 20000 });
  ok('Negociador de empresa nova abre vazio', !!(await a.$('#e_smp')));
  await a.click('#e_smp'); await salvo(a);
  ok('Exemplo salvo na empresa', true);
  await a.fill('#np_11111111000191', '-2'); await a.press('#np_11111111000191', 'Tab'); await salvo(a);
  await a.screenshot({ path: OUT + '/negociador.png' });
  await a.goto(W + 'simulador/'); await a.waitForSelector('.conta', { timeout: 20000 });
  await a.$eval('#L_migr', (e) => { e.value = 80; e.dispatchEvent(new Event('input')); }); await salvo(a);
  ok('Simulador salva premissas da empresa', true);
  await a.reload(); await a.waitForSelector('.conta', { timeout: 20000 });
  ok('Simulador recarrega o valor salvo', (await a.inputValue('#L_migr')) === '80');

  // Dados grandes: várias partes
  const grande = await a.evaluate(async () => {
    const id = localStorage.getItem('contrapeso-empresa');
    const itens = Array.from({ length: 40000 }, (_, i) => ({ sku: 'SKU' + i, d: Math.random().toString(36).repeat(4), p: Math.random() }));
    const v = await Conta.salvarDados(id, 'negociador', { items: itens, teste: true }, (await Conta.carregarDados(id, 'negociador')).versao);
    const r = await Conta.carregarDados(id, 'negociador');
    const snap = await Conta.fb().db.doc(`empresas/${id}/dados/negociador`).get();
    await Conta.salvarDados(id, 'negociador', { items: [], negPct: {}, log: [] }, v);
    return { ok: r.conteudo.items.length === 40000 && r.conteudo.items[39999].sku === 'SKU39999', partes: snap.data().partes, v };
  });
  ok(`Base grande salva e lida em ${grande.partes} partes`, grande.ok && grande.partes > 1);
  // volta ao exemplo para os próximos passos
  await a.goto(W + 'negociador/'); await a.waitForSelector('#e_smp', { timeout: 20000 });
  await a.click('#e_smp'); await salvo(a);
  await a.fill('#np_11111111000191', '-2'); await a.press('#np_11111111000191', 'Tab'); await salvo(a);

  // Bruno aceita o convite (leitor)
  const br = await aceitarConvite(b, 'bruno@alfa.test', 'Bruno1234');
  console.log('  (convite: e-mail já vem confirmado pela criação de senha? ' + (!br.precisaConfirmar) + ')');
  ok('Link do convite já traz o e-mail preenchido', br.preenchido === 'bruno@alfa.test');
  await br.p.waitForFunction(() => document.getElementById('e-nome')?.textContent === 'Mercado Alfa', null, { timeout: 20000 });
  ok('Convidado entra na empresa certa', (await br.p.textContent('#e-papel')).includes('Leitor'));
  await br.p.goto(W + 'negociador/'); await br.p.waitForSelector('#tree tr.g1', { timeout: 20000 });
  ok('Leitor vê os dados da empresa', (await br.p.$$eval('#tree tr.g1', (x) => x.length)) === 3);
  ok('Leitor vê aviso de somente leitura', (await br.p.textContent('#faixa-conta')).includes('leitura'));
  ok('Leitor vê o desconto salvo pela admin', (await br.p.inputValue('#np_11111111000191')) === '-2');
  await br.p.fill('#np_11111111000191', '-9'); await br.p.press('#np_11111111000191', 'Tab'); await sleep(1800);
  ok('Alteração do leitor não é gravada', (await br.p.textContent('#conta-estado')).includes('Somente leitura'));

  // Carla, de outra empresa
  const c = await novaPagina(b);
  await criarEmpresa(c, 'Mercado Beta', 'Carla Dias', 'carla@beta.test', 'Carla1234');
  await c.goto(W + 'negociador/'); await c.waitForSelector('.conta', { timeout: 20000 });
  ok('Empresa Beta não vê itens da Alfa', !!(await c.$('#e_smp')));
  const idAlfa = await a.evaluate(() => localStorage.getItem('contrapeso-empresa'));
  const tent = await c.evaluate(async (id) => {
    const db = Conta.fb().db; const r = {};
    const t = async (k, f) => { try { await f(); r[k] = 'permitido'; } catch (e) { r[k] = e.code; } };
    await t('lerEmpresa', () => db.doc(`empresas/${id}`).get());
    await t('lerDados', () => db.doc(`empresas/${id}/dados/negociador`).get());
    await t('listarMembros', () => db.collection(`empresas/${id}/membros`).get());
    await t('gravarDados', () => db.doc(`empresas/${id}/dados/negociador/partes/0`).set({ txt: 'x' }));
    await t('convidarSe', () => db.doc(`empresas/${id}/convites/carla@beta.test`).set({ email: 'carla@beta.test', papel: 'admin', empresaNome: 'x', criadoPor: 'x', criadoEm: new Date() }));
    await t('listarEmpresas', () => db.collection('empresas').get());
    return r;
  }, idAlfa);
  ok('Beta é bloqueada em tudo da Alfa: ' + JSON.stringify(tent), Object.values(tent).every((v) => v === 'permission-denied'));

  // Dora (editora) e conflito
  const d = await aceitarConvite(b, 'dora@alfa.test', 'Dora12345');
  await d.p.goto(W + 'negociador/'); await d.p.waitForSelector('#tree tr.g1', { timeout: 20000 });
  await a.goto(W + 'negociador/'); await a.waitForSelector('#tree tr.g1', { timeout: 20000 });
  await d.p.fill('#np_11111111000191', '-3'); await d.p.press('#np_11111111000191', 'Tab'); await salvo(d.p);
  ok('Editora grava', true);
  await a.fill('#np_11111111000191', '-5'); await a.press('#np_11111111000191', 'Tab');
  await a.waitForSelector('#faixa-conta', { timeout: 20000 });
  ok('Conflito entre duas pessoas é detectado', (await a.textContent('#faixa-conta')).includes('Outra pessoa'));
  await a.click('#faixa-conta button'); await sleep(2000);
  ok('Recarregar traz a versão da editora', (await a.inputValue('#np_11111111000191')) === '-3');

  // Master
  const m = await novaPagina(b);
  await criarEmpresa(m, 'MQT Assessoria', 'Ricardo', 'marquettiric@gmail.com', 'Master1234');
  ok('Master sem e-mail confirmado não vê as outras empresas', await m.$eval('#c-master', (e) => e.hidden));
  await confirmarEmail(m, 'marquettiric@gmail.com');
  await m.waitForSelector('#c-master:not([hidden])', { timeout: 20000 });
  await m.waitForFunction(() => document.querySelectorAll('#t-master tr').length === 3, null, { timeout: 20000 });
  ok('Master vê as 3 empresas', true);
  await m.screenshot({ path: OUT + '/master.png', fullPage: true });
  await m.click('#t-master tr:has-text("Mercado Alfa") [data-acessar]');
  await m.waitForFunction(() => document.getElementById('e-nome').textContent === 'Mercado Alfa', null, { timeout: 20000 });
  await m.goto(W + 'negociador/'); await m.waitForSelector('#tree tr.g1', { timeout: 20000 });
  ok('Master abre os dados da Alfa', (await m.inputValue('#np_11111111000191')) === '-3' && (await m.textContent('.conta .papel')).includes('Master'));

  // Admin remove o leitor
  await a.goto(W + 'empresa/'); await a.waitForSelector('[data-remover]', { timeout: 20000 });
  const idx = await a.$eval('#t-usuarios', (t) => { const tr = [...t.querySelectorAll('tr')].find((r) => r.textContent.includes('bruno@alfa.test')); return tr.querySelector('[data-remover]').dataset.remover; });
  await a.click(`[data-remover="${idx}"]`); await a.click(`[data-remover="${idx}"]`);
  await a.waitForFunction(() => document.getElementById('m-usuarios').textContent.includes('removido'), null, { timeout: 20000 });
  await br.p.goto(W + 'negociador/');
  await br.p.waitForURL(/empresa\//, { timeout: 20000 });
  const perdeu = await br.p.waitForFunction(() => document.getElementById('n-titulo').textContent.includes('Crie a sua empresa'), null, { timeout: 20000 }).then(() => true).catch(() => false);
  ok('Usuário removido perde acesso', perdeu);

  // Master exclui a empresa Beta
  await m.goto(W + 'empresa/'); await m.waitForSelector('#t-master tr:has-text("Mercado Beta")', { timeout: 20000 });
  await m.click('#t-master tr:has-text("Mercado Beta") [data-excluir]'); await m.click('#t-master tr:has-text("Mercado Beta") [data-excluir]');
  await m.waitForFunction(() => document.getElementById('m-geral').textContent.includes('excluída'), null, { timeout: 20000 });
  ok('Master exclui empresa', (await m.$$('#t-master tr')).length === 2);
} catch (e) {
  ok('Execução sem erro: ' + e.message, false);
} finally {
  await b.close();
}
const falhas = res.filter((r) => !r[1]).length;
console.log(`\nresultado: ${res.length - falhas} ok, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
