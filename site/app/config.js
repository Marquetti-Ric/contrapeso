// Configuração pública do Contrapeso.
// A chave "anon" do Supabase é pública por natureza: o isolamento entre empresas é feito
// pelas regras do banco (Row Level Security), não por esconder esta chave.
// Com os dois campos vazios, as ferramentas funcionam sem login, com dados só no navegador.
window.CONTRAPESO_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: ""
};
