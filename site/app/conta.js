/* Contrapeso · conta, empresa e dados na nuvem.
   Usado pelo Simulador, pelo Negociador e pelas telas de login e de empresa.
   Sem configuração do Supabase (app/config.js vazio), tudo continua funcionando só no navegador. */
(function () {
  const SRC = document.currentScript && document.currentScript.src;
  const BASE = new URL("../", SRC || location.href).href;
  const CFG = window.CONTRAPESO_CONFIG || {};
  const ATIVO = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const EMP_KEY = "contrapeso-empresa";
  let cliente = null;

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function sb() {
    if (!ATIVO) throw new Error("Login não configurado.");
    if (!window.supabase) throw new Error("Não foi possível carregar o serviço de login. Verifique a conexão.");
    if (!cliente) cliente = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
    });
    return cliente;
  }

  function traduz(err) {
    const m = String((err && (err.message || err.error_description || err.erro)) || err || "");
    const t = [
      [/invalid login credentials/i, "E-mail ou senha incorretos."],
      [/email not confirmed/i, "Confirme o seu e-mail pelo link que enviamos antes de entrar."],
      [/user already registered|already been registered|email_exists/i, "Já existe uma conta com esse e-mail. Entre com ela e crie a nova empresa pelo painel."],
      [/password should be at least|weak password/i, "A senha precisa ter pelo menos 8 caracteres, com letras e números."],
      [/rate limit|too many requests|security purposes/i, "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo."],
      [/invalid email|unable to validate email/i, "E-mail inválido."],
      [/jwt expired|refresh token/i, "Sua sessão expirou. Entre de novo."],
      [/failed to fetch|network/i, "Sem conexão com o servidor. Verifique a internet."],
      [/conflito/i, "Outra pessoa salvou alterações antes de você."],
      [/permission denied|42501|row-level security/i, "Seu perfil não tem permissão para isso."]
    ];
    for (const [re, txt] of t) if (re.test(m)) return txt;
    return m || "Algo deu errado. Tente de novo.";
  }

  async function sessao() { const { data } = await sb().auth.getSession(); return data.session; }
  async function eu() { const { data, error } = await sb().rpc("eu"); if (error) throw error; return data; }
  async function minhasEmpresas() { const { data, error } = await sb().rpc("minhas_empresas"); if (error) throw error; return data || []; }
  async function sair() { try { await sb().auth.signOut(); } catch (e) {} location.href = BASE + "entrar/"; }
  function irParaLogin() { location.replace(BASE + "entrar/?volta=" + encodeURIComponent(location.pathname + location.search)); }
  function empresaEscolhida(lista) {
    const q = new URLSearchParams(location.search).get("empresa");
    const salvo = q || lsGet(EMP_KEY);
    const e = lista.find((x) => x.id === salvo) || lista[0] || null;
    if (e) lsSet(EMP_KEY, e.id);
    return e;
  }
  function escolherEmpresa(id) { lsSet(EMP_KEY, id); }

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
    let s;
    try { s = await sessao(); } catch (e) { carregando(true, traduz(e)); return new Promise(() => {}); }
    if (!s) { irParaLogin(); return new Promise(() => {}); }
    let usuario, empresas;
    try { [usuario, empresas] = await Promise.all([eu(), minhasEmpresas()]); }
    catch (e) { if (/jwt|refresh/i.test(String(e.message))) { irParaLogin(); return new Promise(() => {}); } carregando(true, traduz(e)); return new Promise(() => {}); }
    const empresa = empresaEscolhida(empresas);
    if (!empresa) { location.replace(BASE + "empresa/"); return new Promise(() => {}); }
    const papel = empresa.papel;
    const podeEditar = ["admin", "editor", "master"].includes(papel);

    async function buscar() {
      const { data, error } = await sb().from("dados").select("conteudo,versao,atualizado_em").eq("empresa_id", empresa.id).eq("ferramenta", ferramenta).maybeSingle();
      if (error) throw error;
      return data;
    }
    let linha;
    try { linha = await buscar(); } catch (e) { carregando(true, traduz(e)); return new Promise(() => {}); }
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
        try { const l = await buscar(); versao = l ? l.versao : 0; ctx.conteudo = l ? l.conteudo : null; ctx.aoRecarregar && ctx.aoRecarregar(ctx.conteudo); estado("Dados atualizados", "ok"); }
        catch (e) { estado(traduz(e), "err"); }
      }
    };
    async function enviar() {
      if (emVoo) { clearTimeout(timer); timer = setTimeout(enviar, 600); return; }
      if (!pendente) return;
      const obj = pendente; pendente = null; emVoo = true; estado("Salvando…");
      const { data, error } = await sb().rpc("salvar_dados", { p_empresa: empresa.id, p_ferramenta: ferramenta, p_conteudo: obj, p_versao: versao });
      emVoo = false;
      if (error) {
        if (/conflito/i.test(error.message) || error.code === "P0002") {
          travado = true; estado("Não salvo", "err");
          faixa("Outra pessoa da empresa salvou alterações nesta ferramenta enquanto você editava. Suas últimas mudanças não foram gravadas.", "Carregar a versão mais recente", () => ctx.recarregar());
        } else { pendente = pendente || obj; estado("Erro ao salvar: " + traduz(error), "err"); clearTimeout(timer); timer = setTimeout(enviar, 5000); }
        return;
      }
      versao = data; estado("Salvo", "ok");
    }
    window.addEventListener("beforeunload", (e) => { if (pendente || emVoo) { e.preventDefault(); e.returnValue = ""; } });

    barra(ctx);
    if (!podeEditar) faixa("Seu perfil nesta empresa é de leitura. Você pode simular à vontade, mas as alterações não são salvas.");
    estado(linha ? "Dados da empresa carregados" : "Empresa sem dados nesta ferramenta ainda", "ok");
    carregando(false);
    return ctx;
  }

  window.Conta = { ATIVO, BASE, sb, traduz, sessao, eu, minhasEmpresas, sair, escolherEmpresa, empresaEscolhida, iniciar, esc, estilos };
})();
