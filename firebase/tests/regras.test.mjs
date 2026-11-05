// Testes das regras de isolamento entre empresas (rodam no emulador do Firestore).
// npx firebase emulators:exec --only firestore --project demo-contrapeso "node --test firebase/tests/regras.test.mjs"
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

let env;
const U = {
  alice: { sub: 'alice', email: 'alice@alfa.test', email_verified: true },
  bruno: { sub: 'bruno', email: 'bruno@alfa.test', email_verified: true },
  dora: { sub: 'dora', email: 'dora@alfa.test', email_verified: true },
  carla: { sub: 'carla', email: 'carla@beta.test', email_verified: true },
  intruso: { sub: 'intruso', email: 'bruno@alfa.test', email_verified: false },
  master: { sub: 'master', email: 'MarquettiRic@gmail.com', email_verified: true },
  masterFalso: { sub: 'mf', email: 'marquettiric@gmail.com', email_verified: false },
};
const db = (u) => env.authenticatedContext(u.sub, { email: u.email, email_verified: u.email_verified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const agora = new Date();

async function criarEmpresa(u, id, nome) {
  const f = db(u);
  const b = f.batch();
  b.set(f.doc(`empresas/${id}`), { nome, cnpj: null, criadaPor: u.sub, criadaEm: agora });
  b.set(f.doc(`empresas/${id}/membros/${u.sub}`), { uid: u.sub, email: u.email.toLowerCase(), nome: 'x', papel: 'admin', criadoEm: agora });
  return b.commit();
}
async function convidarEaceitar(admin, emp, u, papel) {
  await assertSucceeds(db(admin).doc(`empresas/${emp}/convites/${u.email}`).set({ email: u.email, nome: null, papel, empresaNome: emp, criadoPor: admin.sub, criadoEm: agora }));
  const f = db(u);
  const b = f.batch();
  b.set(f.doc(`empresas/${emp}/membros/${u.sub}`), { uid: u.sub, email: u.email, nome: null, papel, criadoEm: agora });
  b.delete(f.doc(`empresas/${emp}/convites/${u.email}`));
  return b.commit();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-contrapeso',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await assertSucceeds(criarEmpresa(U.alice, 'alfa', 'Mercado Alfa'));
  await assertSucceeds(criarEmpresa(U.carla, 'beta', 'Mercado Beta'));
  await assertSucceeds(convidarEaceitar(U.alice, 'alfa', U.bruno, 'leitor'));
  await assertSucceeds(convidarEaceitar(U.alice, 'alfa', U.dora, 'editor'));
  await assertSucceeds(db(U.alice).doc('empresas/alfa/dados/negociador').set({ versao: 1, partes: 0, formato: 'gzip-b64' }));
});

test('anônimo não lê nada', async () => {
  await assertFails(anon().doc('empresas/alfa').get());
  await assertFails(anon().doc('empresas/alfa/dados/negociador').get());
});
test('admin lê a própria empresa e os dados', async () => {
  await assertSucceeds(db(U.alice).doc('empresas/alfa').get());
  await assertSucceeds(db(U.alice).doc('empresas/alfa/dados/negociador').get());
  await assertSucceeds(db(U.alice).collection('empresas/alfa/membros').get());
});
test('outra empresa não lê, não lista e não grava', async () => {
  const c = db(U.carla);
  await assertFails(c.doc('empresas/alfa').get());
  await assertFails(c.doc('empresas/alfa/dados/negociador').get());
  await assertFails(c.collection('empresas/alfa/membros').get());
  await assertFails(c.collection('empresas/alfa/convites').get());
  await assertFails(c.doc('empresas/alfa/dados/negociador').set({ versao: 2 }));
  await assertFails(c.doc('empresas/alfa/dados/negociador/partes/0').set({ txt: 'x' }));
  await assertFails(c.collection('empresas').get());
});
test('outra empresa não se convida nem se adiciona', async () => {
  const c = db(U.carla);
  await assertFails(c.doc('empresas/alfa/convites/carla@beta.test').set({ email: 'carla@beta.test', papel: 'admin', empresaNome: 'x', criadoPor: 'carla', criadoEm: agora }));
  await assertFails(c.doc('empresas/alfa/membros/carla').set({ uid: 'carla', email: 'carla@beta.test', papel: 'admin', criadoEm: agora }));
});
test('não dá para sequestrar empresa existente com o lote de fundador', async () => {
  const c = db(U.carla);
  const b = c.batch();
  b.set(c.doc('empresas/alfa'), { nome: 'Sequestro', cnpj: null, criadaPor: 'carla', criadaEm: agora });
  b.set(c.doc('empresas/alfa/membros/carla'), { uid: 'carla', email: 'carla@beta.test', papel: 'admin', criadoEm: agora });
  await assertFails(b.commit());
});
test('criar empresa exige o vínculo de admin no mesmo lote', async () => {
  await assertFails(db(U.carla).doc('empresas/gama').set({ nome: 'Gama', cnpj: null, criadaPor: 'carla', criadaEm: agora }));
});
test('leitor lê mas não grava', async () => {
  const b = db(U.bruno);
  await assertSucceeds(b.doc('empresas/alfa/dados/negociador').get());
  await assertFails(b.doc('empresas/alfa/dados/negociador').update({ versao: 2 }));
  await assertFails(b.doc('empresas/alfa/dados/negociador/partes/0').set({ txt: 'x' }));
  await assertFails(b.doc('empresas/alfa').update({ nome: 'Outro' }));
});
test('editor grava respeitando a versão', async () => {
  const d = db(U.dora);
  await assertSucceeds(d.doc('empresas/alfa/dados/negociador/partes/0').set({ txt: 'x' }));
  await assertSucceeds(d.doc('empresas/alfa/dados/negociador').update({ versao: 2 }));
  await assertFails(d.doc('empresas/alfa/dados/negociador').update({ versao: 2 })); // versão velha
  await assertFails(d.doc('empresas/alfa/membros/bruno').update({ papel: 'admin' })); // não gerencia usuários
});
test('ninguém se promove', async () => {
  await assertFails(db(U.dora).doc('empresas/alfa/membros/dora').update({ papel: 'admin' }));
  await assertFails(db(U.bruno).doc('empresas/alfa/membros/bruno').update({ papel: 'editor' }));
});
test('membro atualiza o próprio último acesso', async () => {
  await assertSucceeds(db(U.bruno).doc('empresas/alfa/membros/bruno').update({ ultimoAcesso: agora }));
});
test('admin muda perfil e remove outros, mas não a si mesmo', async () => {
  const a = db(U.alice);
  await assertSucceeds(a.doc('empresas/alfa/membros/bruno').update({ papel: 'editor' }));
  await assertFails(a.doc('empresas/alfa/membros/alice').update({ papel: 'leitor' }));
  await assertFails(a.doc('empresas/alfa/membros/alice').delete());
  await assertSucceeds(a.doc('empresas/alfa/membros/bruno').delete());
  await assertFails(db(U.bruno).doc('empresas/alfa/dados/negociador').get()); // perdeu acesso
});
test('membro comum pode sair da empresa', async () => {
  await assertSucceeds(db(U.dora).doc('empresas/alfa/membros/dora').delete());
});
test('convite só é aceito com e-mail confirmado e no perfil convidado', async () => {
  const a = db(U.alice);
  await assertSucceeds(a.doc('empresas/alfa/convites/novo@alfa.test').set({ email: 'novo@alfa.test', nome: null, papel: 'leitor', empresaNome: 'Mercado Alfa', criadoPor: 'alice', criadoEm: agora }));
  const novo = { sub: 'novo', email: 'novo@alfa.test', email_verified: true };
  await assertFails(db(novo).doc('empresas/alfa/membros/novo').set({ uid: 'novo', email: 'novo@alfa.test', papel: 'admin', criadoEm: agora }));
  const naoConf = { sub: 'novo2', email: 'novo@alfa.test', email_verified: false };
  await assertFails(db(naoConf).doc('empresas/alfa/membros/novo2').set({ uid: 'novo2', email: 'novo@alfa.test', papel: 'leitor', criadoEm: agora }));
  await assertSucceeds(db(novo).doc('empresas/alfa/membros/novo').set({ uid: 'novo', email: 'novo@alfa.test', papel: 'leitor', criadoEm: agora }));
});
test('convidado vê só os próprios convites', async () => {
  await assertSucceeds(db(U.alice).doc('empresas/alfa/convites/x@y.test').set({ email: 'x@y.test', papel: 'leitor', empresaNome: 'Mercado Alfa', criadoPor: 'alice', criadoEm: agora }));
  const x = { sub: 'x', email: 'x@y.test', email_verified: true };
  await assertSucceeds(db(x).collectionGroup('convites').where('email', '==', 'x@y.test').get());
  await assertFails(db(x).collectionGroup('convites').where('email', '==', 'outro@y.test').get());
  await assertFails(db(U.intruso).collectionGroup('convites').where('email', '==', 'bruno@alfa.test').get());
});
test('minhas empresas: cada um só acha os próprios vínculos', async () => {
  await assertSucceeds(db(U.bruno).collectionGroup('membros').where('uid', '==', 'bruno').get());
  await assertFails(db(U.bruno).collectionGroup('membros').where('uid', '==', 'alice').get());
});
test('master vê, lista, grava e exclui qualquer empresa', async () => {
  const m = db(U.master);
  await assertSucceeds(m.collection('empresas').get());
  await assertSucceeds(m.doc('empresas/beta').get());
  await assertSucceeds(m.collection('empresas/beta/membros').get());
  await assertSucceeds(m.doc('empresas/alfa/dados/negociador').update({ versao: 2 }));
  await assertSucceeds(m.doc('empresas/beta/membros/carla').update({ papel: 'editor' }));
  await assertSucceeds(m.doc('empresas/beta').delete());
});
test('master com e-mail não confirmado não tem poder', async () => {
  await assertFails(db(U.masterFalso).collection('empresas').get());
  await assertFails(db(U.masterFalso).doc('empresas/beta').get());
});
test('dados inválidos de empresa são recusados', async () => {
  await assertFails(db(U.alice).doc('empresas/alfa').update({ nome: 'A' }));
  await assertFails(db(U.alice).doc('empresas/alfa').update({ cnpj: '123' }));
  await assertSucceeds(db(U.alice).doc('empresas/alfa').update({ cnpj: '11111111000111' }));
  await assertFails(db(U.alice).doc('empresas/alfa').update({ criadaPor: 'carla' }));
});
