/* Contrapeso · conta, empresa e dados na nuvem (Firebase).
   Usado pelo Simulador, pelo Negociador e pelas telas de login e de empresa.
   Sem configuração do Firebase (app/config.js vazio), tudo continua funcionando só no navegador.
   As regras de acesso ficam em firebase/firestore.rules: o isolamento entre empresas é garantido no servidor. */
(function () {
  const SRC = document.currentScript && document.currentScript.src;
  const BASE = new URL("../", SRC || location.href).href;
  const CFG = window.CONTRAPESO_CONFIG || {};
  const FB = CFG.firebase || {};
  const ATIVO = !!(FB.apiKey && FB.projectId);
  const MASTERS = ["marquettiric@gmail.com"]; // só para exibição; quem decide é firestore.rules
  const EMP_KEY = "contrapeso-empresa";
  const PARTE = 800000;
  let app = null, auth = null, db = null, prontoAuth = null;

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const agora = () => firebase.firestore.FieldValue.serverTimestamp();

  function iniciarFirebase() {
    if (!ATIVO) throw new Error("Login não configurado.");
    if (!window.firebase) throw new Error("Não foi possível carregar o serviço de login. Verifique a conexão.");
    if (app) return;
    app = firebase.initializeApp(FB);
    auth = firebase.auth(); db = firebase.firestore();
    auth.languageCode = "pt_BR";
    if (CFG.emulador) {
      auth.useEmulator(CFG.emulador.auth);
      db.useEmulator(CFG.emulador.firestore[0], CFG.emulador.firestore[1]);
    }
    prontoAuth = new Promise((ok) => { const off = auth.onAuthStateChanged((u) => { off(); ok(u); }); });
  }
  function fb() { iniciarFirebase(); return { auth, db }; }

  function traduz(err) {
    const code = String((err && err.code) || "");
    const m = String((err && (err.message || err.erro)) || err || "");
    const t = {
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/wrong-password": "E-mail ou senha incorretos.",
      "auth/user-not-found": "E-mail ou senha incorretos.",
      "auth/invalid-login-credentials": "E-mail ou senha incorretos.",
      "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Entre com ela e crie a nova empresa pelo painel.",
      "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres, com letras e números.",
      "auth/too-many-requests": "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
      "auth/invalid-email": "E-mail inválido.",
      "auth/network-request-failed": "Sem conexão com o servidor. Verifique a internet.",
      "auth/requires-recent-login": "Por segurança, entre de novo antes de trocar a senha.",
      "auth/expired-action-code": "O link expirou. Peça um novo.",
      "auth/invalid-action-code": "O link é inválido ou já foi usado. Peça um novo.",
      "auth/quota-exceeded": "O limite diário de e-mails foi atingido. Tente de novo amanhã.",
      "permission-denied": "Seu perfil não tem permissão para isso.",
      "unavailable": "Sem conexão com o servidor. Verifique a internet.",
      "conflito": "Outra pessoa salvou alterações antes de você.",
    };
    if (t[code]) return t[code];
    if (/conflito/i.test(m)) return t.conflito;
    if (/permission|insufficient/i.test(m)) return t["permission-denied"];
    return m.replace(/^Firebase: /, "") || "Algo deu errado. Tente de novo.";
  }

  /* ---------- sessão e usuário ---------- */
  async function sessao() { iniciarFirebase(); return prontoAuth.then(() => auth.currentUser); }
  async function eu() {
    const u = auth.currentUser; if (!u) return null;
    const email = (u.email || "").toLowerCase();
    return { id: u.uid, email, nome: u.displayName || "", verificado: !!u.emailVerified, master: !!u.emailVerified && MASTERS.includes(email) };
  }
  async function sair() { try { iniciarFirebase(); await auth.signOut(); } catch (e) {} location.href = BASE + "entrar/"; }
  function irParaLogin() { location.replace(BASE + "entrar/?volta=" + encodeURIComponent(location.pathname + location.search)); }

  async function entrar(email, senha) { iniciarFirebase(); await auth.signInWithEmailAndPassword(email.trim(), senha); await aceitarConvites(); }
  async function criarConta({ empresa, cnpj, nome, email, senha }) {
    iniciarFirebase();
    const cred = await auth.createUserWithEmailAndPassword(email.trim(), senha);
    await cred.user.updateProfile({ displayName: nome });
    const id = await criarEmpresa(empresa, cnpj, nome);
    try { await cred.user.sendEmailVerification({ url: BASE + "entrar/?fluxo=confirmado" }); } catch (e) {}
    return id;
  }
  async function recuperarSenha(email) { iniciarFirebase(); await auth.sendPasswordResetEmail(email.trim(), { url: BASE + "entrar/?fluxo=senha-criada" }); }
  async function reenviarVerificacao() { const u = auth.currentUser; if (u) await u.sendEmailVerification({ url: BASE + "entrar/?fluxo=confirmado" }); }
  async function atualizarUsuario() { const u = auth.currentUser; if (u) { await u.reload(); await u.getIdToken(true); } return eu(); }

  /* ---------- empresas ---------- */
  async function criarEmpresa(nome, cnpj, nomePessoa) {
    const u = auth.currentUser;
    const ref = db.collection("empresas").doc();
    const b = db.batch();
    b.set(ref, { nome: String(nome).trim(), cnpj: cnpj || null, criadaPor: u.uid, criadaEm: agora() });
    b.set(ref.collection("membros").doc(u.uid), { uid: u.uid, email: (u.email || "").toLowerCase(), nome: nomePessoa || u.displayName || null, papel: "admin", criadoEm: agora() });
    await b.commit();
    escolherEmpresa(ref.id);
    return ref.id;
  }
  async function aceitarConvites() {
    const u = auth.currentUser; if (!u || !u.emailVerified) return 0;
    const email = (u.email || "").toLowerCase();
    let snap; try { snap = await db.collectionGroup("convites").where("email", "==", email).get(); } catch (e) { return 0; }
    let n = 0;
    for (const c of snap.docs) {
      const d = c.data(); const empresaRef = c.ref.parent.parent;
      const b = db.batch();
      b.set(empresaRef.collection("membros").doc(u.uid), { uid: u.uid, email, nome: u.displayName || d.nome || null, papel: d.papel, criadoEm: agora() });
      b.delete(c.ref);
      try { await b.commit(); n++; escolherEmpresa(empresaRef.id); } catch (e) {}
    }
    return n;
  }
  async function minhasEmpresas() {
    const u = auth.currentUser; if (!u) return [];
    const me = await eu();
    const vinc = await db.collectionGroup("membros").where("uid", "==", u.uid).get();
    const papeis = {}; vinc.docs.forEach((d) => { papeis[d.ref.parent.parent.id] = d.data().papel; });
    let docs;
    if (me.master) docs = (await db.collection("empresas").get()).docs;
    else docs = (await Promise.all(Object.keys(papeis).map((id) => db.collection("empresas").doc(id).get()))).filter((d) => d.exists);
    const lista = docs.map((d) => ({ id: d.id, nome: d.data().nome, cnpj: d.data().cnpj || null, papel: papeis[d.id] || "master" }));
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }
  async function contarMembros(id) { try { const s = await db.collection("empresas").doc(id).collection("membros").count().get(); return s.data().count; } catch (e) { return null; } }
  function empresaEscolhida(lista) {
    const q = new URLSearchParams(location.search).get("empresa");
    const salvo = q || lsGet(EMP_KEY);
    const e = lista.find((x) => x.id === salvo) || lista[0] || null;
    if (e) lsSet(EMP_KEY, e.id);
    return e;
  }
  function escolherEmpresa(id) { lsSet(EMP_KEY, id); }
  async function salvarEmpresa(id, dados) { await db.collection("empresas").doc(id).update({ nome: dados.nome, cnpj: dados.cnpj || null }); }
  async function excluirEmpresa(id) {
    const ref = db.collection("empresas").doc(id);
    for (const sub of ["membros", "convites"]) {
      const s = await ref.collection(sub).get();
      await Promise.all(s.docs.filter((d) => !(sub === "membros" && d.id === auth.currentUser.uid)).map((d) => d.ref.delete()));
    }
    const dados = await ref.collection("dados").get();
    for (const d of dados.docs) { const p = await d.ref.collection("partes").get(); await Promise.all(p.docs.map((x) => x.ref.delete())); await d.ref.delete(); }
    const meu = ref.collection("membros").doc(auth.currentUser.uid);
    if ((await meu.get().catch(() => null))?.exists) await meu.delete();
    await ref.delete();
  }

  /* ---------- usuários da empresa ---------- */
  async function usuariosDaEmpresa(id, admin) {
    const ref = db.collection("empresas").doc(id);
    const m = await ref.collection("membros").get();
    const linhas = m.docs.map((d) => { const x = d.data(); return { tipo: "membro", uid: d.id, email: x.email, nome: x.nome, papel: x.papel, situacao: "ativo", ultimoAcesso: x.ultimoAcesso ? x.ultimoAcesso.toDate() : null }; });
    if (admin) {
      const c = await ref.collection("convites").get();
      c.docs.forEach((d) => { const x = d.data(); linhas.push({ tipo: "convite", uid: null, email: x.email, nome: x.nome, papel: x.papel, situacao: "convite pendente", ultimoAcesso: null }); });
    }
    const ordem = { admin: 0, editor: 1, leitor: 2 };
    return linhas.sort((a, b) => (ordem[a.papel] - ordem[b.papel]) || a.email.localeCompare(b.email));
  }
  async function alterarPapel(id, linha, papel) {
    const ref = db.collection("empresas").doc(id);
    if (linha.tipo === "convite") await ref.collection("convites").doc(linha.email).update({ papel });
    else await ref.collection("membros").doc(linha.uid).update({ papel });
  }
  async function removerUsuario(id, linha) {
    const ref = db.collection("empresas").doc(id);
    if (linha.tipo === "convite") await ref.collection("convites").doc(linha.email).delete();
    else await ref.collection("membros").doc(linha.uid).delete();
  }
  // Convite: cria o convite e a conta da pessoa (num app secundário, sem tirar o admin da sessão)
  // e manda o e-mail de criação de senha. Quem já tem conta só ganha o convite: a empresa aparece no próximo acesso.
  async function convidar(id, { email, nome, papel }, empresaNome) {
    email = email.trim().toLowerCase();
    const ref = db.collection("empresas").doc(id);
    const ja = await ref.collection("membros").where("email", "==", email).get();
    if (!ja.empty) throw new Error("Essa pessoa já faz parte da empresa.");
    await ref.collection("convites").doc(email).set({ email, nome: nome || null, papel, empresaNome: empresaNome || null, criadoPor: auth.currentUser.uid, criadoEm: agora() });
    const sec = firebase.apps.find((a) => a.name === "convites") || firebase.initializeApp(FB, "convites");
    const secAuth = sec.auth();
    if (CFG.emulador && !secAuth.emulatorConfig) secAuth.useEmulator(CFG.emulador.auth);
    secAuth.languageCode = "pt_BR";
    let novo = false;
    try {
      const senha = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("") + "Aa1";
      const cred = await secAuth.createUserWithEmailAndPassword(email, senha);
      if (nome) await cred.user.updateProfile({ displayName: nome });
      novo = true;
    } catch (e) {
      if (e.code !== "auth/email-already-in-use") { await ref.collection("convites").doc(email).delete().catch(() => {}); throw e; }
    } finally { await secAuth.signOut().catch(() => {}); }
    if (novo) await auth.sendPasswordResetEmail(email, { url: BASE + "entrar/?fluxo=convite&email=" + encodeURIComponent(email) });
    return { emailEnviado: novo };
  }
  async function reenviarConvite(email) { await auth.sendPasswordResetEmail(email, { url: BASE + "entrar/?fluxo=convite&email=" + encodeURIComponent(email) }); }

  /* ---------- dados das ferramentas (comprimidos e divididos em partes) ---------- */
  function b64(buf) { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
  function deB64(t) { const s = atob(t); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  async function comprimir(obj) { const st = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("gzip")); return b64(await new Response(st).arrayBuffer()); }
  async function descomprimir(txt) { const st = new Blob([deB64(txt)]).stream().pipeThrough(new DecompressionStream("gzip")); return JSON.parse(await new Response(st).text()); }
  async function carregarDados(empresaId, ferramenta) {
    const ref = db.collection("empresas").doc(empresaId).collection("dados").doc(ferramenta);
    const s = await ref.get();
    if (!s.exists) return null;
    const meta = s.data();
    if (!meta.partes) return { conteudo: null, versao: meta.versao };
    const partes = await Promise.all(Array.from({ length: meta.partes }, (_, i) => ref.collection("partes").doc(String(i)).get()));
    const txt = partes.map((p) => (p.exists ? p.data().txt : "")).join("");
    return { conteudo: await descomprimir(txt), versao: meta.versao };
  }
  async function salvarDados(empresaId, ferramenta, obj, versaoEsperada) {
    const txt = await comprimir(obj);
    const partes = []; for (let i = 0; i < txt.length; i += PARTE) partes.push(txt.slice(i, i + PARTE));
    const ref = db.collection("empresas").doc(empresaId).collection("dados").doc(ferramenta);
    return db.runTransaction(async (t) => {
      const s = await t.get(ref);
      const atual = s.exists ? s.data().versao : 0;
      if (atual !== versaoEsperada) { const e = new Error("conflito"); e.code = "conflito"; throw e; }
      const antigas = s.exists ? (s.data().partes || 0) : 0;
      partes.forEach((p, i) => t.set(ref.collection("partes").doc(String(i)), { txt: p }));
      for (let i = partes.length; i < antigas; i++) t.delete(ref.collection("partes").doc(String(i)));
      t.set(ref, { versao: atual + 1, partes: partes.length, formato: "gzip-b64", tamanho: txt.length, atualizadoEm: agora(), atualizadoPor: auth.currentUser.uid });
      return atual + 1;
    });
  }

  /* ---------- estilos da barra de conta ---------- */
  function estilos() {
    if (document.getElementById("conta-css")) return;
    const st = document.createElement("style");
    st.id = "conta-css";
    st.textContent = `
      [data-modo="nuvem"] .so-local{display:none!important}
      body:not([data-modo="nuvem"]) .so-nuvem{display:none!important}
      .conta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px}
      .conta select{font:inherit;font-size:13px;font-weight:600;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg);max-width:240px}
      .conta .papel{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--sunk);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
      .conta .estado{font-size:12px;color:var(--muted);min-width:0}
      .conta .estado.ok{color:var(--gain)} .conta .estado.err{color:var(--loss)} .conta .estado.warn{color:var(--warn)}
      .conta details{position:relative}
      .conta summary{list-style:none;cursor:pointer;width:32px;height:32px;border-radius:50%;background:var(--fg);color:var(--surface);display:grid;place-items:center;font-weight:700;font-size:13px}
      .conta summary::-webkit-details-marker{display:none}
      .conta summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      .conta .menu{position:absolute;right:0;top:40px;z-index:50;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:6px;min-width:230px;display:grid}
      .conta .menu .quem{padding:8px 10px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line);margin-bottom:4px;overflow-wrap:anywhere}
      .conta .menu a,.conta .menu button{font:inherit;text-align:left;background:none;border:0;color:var(--fg);padding:8px 10px;border-radius:6px;cursor:pointer;text-decoration:none}
      .conta .menu a:hover,.conta .menu button:hover{background:var(--sunk)}
      .faixa-conta{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:8px;font-size:13px;background:var(--warn-soft);color:var(--warn)}
      .faixa-conta button{font:inherit;font-weight:600;border:1px solid currentColor;background:none;color:inherit;border-radius:6px;padding:5px 10px;cursor:pointer}
      .carregando-conta{position:fixed;inset:0;z-index:100;background:var(--bg);display:grid;place-items:center;font-size:14px;color:var(--muted)}
    `;
    document.head.appendChild(st);
  }
  function carregando(on, msg) {
    let el = document.getElementById("carregando-conta");
    if (on) {
      if (!el) { el = document.createElement("div"); el.id = "carregando-conta"; el.className = "carregando-conta"; el.setAttribute("role", "status"); document.body.appendChild(el); }
      el.textContent = msg || "Carregando os dados da empresa…";
    } else if (el) el.remove();
  }
  function faixa(msg, botao, acao) {
    let el = document.getElementById("faixa-conta");
    if (!msg) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div"); el.id = "faixa-conta"; el.className = "faixa-conta"; el.setAttribute("role", "alert");
      const bar = document.querySelector(".brandbar");
      bar ? bar.insertAdjacentElement("afterend", el) : document.body.prepend(el);
    }
    el.innerHTML = `<span>${esc(msg)}</span>` + (botao ? `<button type="button">${esc(botao)}</button>` : "");
    if (botao) el.querySelector("button").onclick = acao;
  }

  function barra(ctx) {
    const bar = document.querySelector(".brandbar");
    if (!bar) return;
    const papelTxt = { admin: "Admin", editor: "Editor", leitor: "Leitor", master: "Master" }[ctx.papel] || ctx.papel;
    const opts = ctx.empresas.map((e) => `<option value="${esc(e.id)}" ${e.id === ctx.empresa.id ? "selected" : ""}>${esc(e.nome)}</option>`).join("");
    const div = document.createElement("div");
    div.className = "conta";
    div.innerHTML = `
      <label class="so-leitor-tela" for="conta-empresa" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Empresa</label>
      ${ctx.empresas.length > 1 ? `<select id="conta-empresa" title="Trocar de empresa">${opts}</select>` : `<b>${esc(ctx.empresa.nome)}</b>`}
      <span class="papel">${esc(papelTxt)}</span>
      <span class="estado" id="conta-estado" role="status"></span>
      <details><summary aria-label="Menu da conta">${esc((ctx.usuario.nome || ctx.usuario.email || "?").trim()[0].toUpperCase())}</summary>
        <div class="menu"><div class="quem">${esc(ctx.usuario.nome || "")}<br>${esc(ctx.usuario.email)}${ctx.usuario.master ? "<br><b>Usuário master</b>" : ""}</div>
          <a href="${BASE}empresa/">Empresa e usuários</a>
          <button type="button" id="conta-sair">Sair</button></div></details>`;
    bar.appendChild(div);
    const sel = div.querySelector("#conta-empresa");
    if (sel) sel.onchange = () => { escolherEmpresa(sel.value); location.reload(); };
    div.querySelector("#conta-sair").onclick = sair;
    document.addEventListener("click", (e) => { const d = div.querySelector("details"); if (d.open && !d.contains(e.target)) d.open = false; });
  }
  function estado(txt, cls) { const el = document.getElementById("conta-estado"); if (el) { el.textContent = txt; el.className = "estado " + (cls || ""); } }

  /* ---------- ferramentas: carrega e salva os dados da empresa ---------- */
  async function iniciar(ferramenta) {
    estilos();
    if (!ATIVO) return { modo: "local" };
    document.body.dataset.modo = "nuvem";
    carregando(true);
    const falha = (e) => { carregando(true, traduz(e)); return new Promise(() => {}); };
    let u;
    try { u = await sessao(); } catch (e) { return falha(e); }
    if (!u) { irParaLogin(); return new Promise(() => {}); }
    let usuario, empresas;
    try { await aceitarConvites(); usuario = await eu(); empresas = await minhasEmpresas(); } catch (e) { return falha(e); }
    const empresa = empresaEscolhida(empresas);
    if (!empresa) { location.replace(BASE + "empresa/"); return new Promise(() => {}); }
    const papel = empresa.papel;
    const podeEditar = ["admin", "editor", "master"].includes(papel);
    if (papel !== "master") db.collection("empresas").doc(empresa.id).collection("membros").doc(u.uid).update({ ultimoAcesso: agora() }).catch(() => {});

    let linha;
    try { linha = await carregarDados(empresa.id, ferramenta); } catch (e) { return falha(e); }
    let versao = linha ? linha.versao : 0;
    let pendente = null, timer = null, emVoo = false, travado = false;

    const ctx = {
      modo: "nuvem", ferramenta, usuario, empresas, empresa, papel, podeEditar,
      conteudo: linha ? linha.conteudo : null,
      aoRecarregar: null,
      salvar(obj) {
        if (!podeEditar) { estado("Somente leitura: alterações não são salvas", "warn"); return; }
        if (travado) return;
        pendente = obj; estado("Alterações não salvas…");
        clearTimeout(timer); timer = setTimeout(enviar, 1200);
      },
      async recarregar() {
        faixa(null); travado = false; estado("Recarregando…");
        try { const l = await carregarDados(empresa.id, ferramenta); versao = l ? l.versao : 0; ctx.conteudo = l ? l.conteudo : null; ctx.aoRecarregar && ctx.aoRecarregar(ctx.conteudo); estado("Dados atualizados", "ok"); }
        catch (e) { estado(traduz(e), "err"); }
      }
    };
    async function enviar() {
      if (emVoo) { clearTimeout(timer); timer = setTimeout(enviar, 600); return; }
      if (!pendente) return;
      const obj = pendente; pendente = null; emVoo = true; estado("Salvando…");
      try { versao = await salvarDados(empresa.id, ferramenta, obj, versao); emVoo = false; estado("Salvo", "ok"); }
      catch (error) {
        emVoo = false;
        if (error.code === "conflito" || /conflito/.test(error.message) || (error.code === "permission-denied" && podeEditar)) {
          travado = true; estado("Não salvo", "err");
          faixa("Outra pessoa da empresa salvou alterações nesta ferramenta enquanto você editava. Suas últimas mudanças não foram gravadas.", "Carregar a versão mais recente", () => ctx.recarregar());
        } else { pendente = pendente || obj; estado("Erro ao salvar: " + traduz(error), "err"); clearTimeout(timer); timer = setTimeout(enviar, 5000); }
      }
    }
    window.addEventListener("beforeunload", (e) => { if (pendente || emVoo) { e.preventDefault(); e.returnValue = ""; } });

    barra(ctx);
    if (!podeEditar) faixa("Seu perfil nesta empresa é de leitura. Você pode simular à vontade, mas as alterações não são salvas.");
    estado(linha ? "Dados da empresa carregados" : "Empresa sem dados nesta ferramenta ainda", "ok");
    carregando(false);
    return ctx;
  }

  window.Conta = { ATIVO, BASE, fb, traduz, sessao, eu, sair, entrar, criarConta, recuperarSenha, reenviarVerificacao, atualizarUsuario,
    criarEmpresa, aceitarConvites, minhasEmpresas, contarMembros, escolherEmpresa, empresaEscolhida, salvarEmpresa, excluirEmpresa,
    usuariosDaEmpresa, alterarPapel, removerUsuario, convidar, reenviarConvite, carregarDados, salvarDados, iniciar, esc, estilos };
})();
