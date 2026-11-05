// Função "usuarios": convida pessoas para uma empresa.
// Só administradores da empresa (ou master) podem convidar. A verificação é feita
// com o token de quem chamou; a criação do convite usa a chave de serviço, que
// fica apenas no servidor do Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://marquetti-ric.github.io/contrapeso";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? "https://marquetti-ric.github.io,http://localhost:8080")
  .split(",").map((s) => s.trim());
const PAPEIS = ["admin", "editor", "leitor"];

function cors(origin: string | null) {
  const ok = origin && ORIGENS.includes(origin) ? origin : ORIGENS[0];
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function resposta(status: number, corpo: unknown, origin: string | null) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return resposta(405, { erro: "Use POST." }, origin);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return resposta(401, { erro: "Faça login." }, origin);

  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: quem, error: errQuem } = await comoUsuario.auth.getUser();
  if (errQuem || !quem?.user) return resposta(401, { erro: "Sessão expirada. Entre de novo." }, origin);

  let corpo: { acao?: string; empresa_id?: string; email?: string; papel?: string; nome?: string };
  try { corpo = await req.json(); } catch { return resposta(400, { erro: "Requisição inválida." }, origin); }

  const acao = corpo.acao ?? "convidar";
  const empresa = String(corpo.empresa_id ?? "");
  const email = String(corpo.email ?? "").trim().toLowerCase();
  const papel = String(corpo.papel ?? "leitor");
  const nome = corpo.nome ? String(corpo.nome).trim().slice(0, 120) : null;

  if (!["convidar", "reenviar"].includes(acao)) return resposta(400, { erro: "Ação desconhecida." }, origin);
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return resposta(400, { erro: "Empresa inválida." }, origin);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resposta(400, { erro: "E-mail inválido." }, origin);
  if (!PAPEIS.includes(papel)) return resposta(400, { erro: "Perfil inválido." }, origin);

  const { data: ehAdmin, error: errAdmin } = await comoUsuario.rpc("e_admin", { p_empresa: empresa });
  if (errAdmin) return resposta(500, { erro: "Não foi possível verificar a permissão." }, origin);
  if (!ehAdmin) return resposta(403, { erro: "Só administradores da empresa podem convidar usuários." }, origin);

  const admin = createClient(url, servico, { auth: { persistSession: false } });
  const redirectTo = `${SITE_URL}/entrar/?fluxo=convite`;

  let userId: string | null = null;
  let convidado = false;
  const { data: existente } = await admin.rpc("id_por_email", { p_email: email });
  if (existente) {
    userId = existente as string;
    if (acao === "reenviar") {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) {
        // já ativo: manda link de acesso por e-mail em vez de convite
        const { error: e2 } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${SITE_URL}/entrar/?fluxo=senha` });
        if (e2) return resposta(502, { erro: "Não foi possível reenviar o e-mail: " + e2.message }, origin);
      }
      convidado = true;
    }
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: nome ? { nome } : {} });
    if (error || !data?.user) return resposta(502, { erro: "Não foi possível enviar o convite: " + (error?.message ?? "erro desconhecido") }, origin);
    userId = data.user.id;
    convidado = true;
  }

  if (acao === "convidar") {
    const { data: jaMembro } = await admin.from("membros").select("papel").eq("empresa_id", empresa).eq("user_id", userId).maybeSingle();
    if (jaMembro) return resposta(409, { erro: "Essa pessoa já faz parte da empresa." }, origin);
    const { error } = await admin.from("membros").insert({ empresa_id: empresa, user_id: userId, email, nome, papel });
    if (error) return resposta(500, { erro: "Convite enviado, mas não foi possível vincular à empresa: " + error.message }, origin);
  }

  return resposta(200, { ok: true, user_id: userId, email_enviado: convidado }, origin);
});
