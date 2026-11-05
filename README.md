# Contrapeso

Ferramentas gratuitas para o varejo medir e negociar o impacto da reforma tributária do consumo (EC 132/2023 e LC 214/2025): CBS, IBS e Imposto Seletivo, de 2026 a 2033.

- **Simulador** (`site/simulador/`): impacto no resultado da rede por estado, bandeira, canal e categoria, com alavancas de decisão.
- **Negociador** (`site/negociador/`): preço neutro, preço máximo e margem por fornecedor e SKU; importa XML de NF-e, Excel, CSV, TXT, JSON e API; exporta memória de cálculo para o fornecedor.

Tudo roda no navegador. Nenhum dado importado sai do computador de quem usa.

## Publicação

Cada push na branch `main` roda `scripts/check.mjs` e, se passar, publica a pasta `site/` no GitHub Pages pelo workflow `.github/workflows/publicar.yml`. Pull requests rodam só as verificações.

O que a verificação cobre:
- sintaxe de todos os scripts das páginas;
- links internos;
- ausência de marcas de terceiros;
- testes do modelo de cálculo (2026 neutro, alíquota zero mantém preço, modo "manter margem").

Rodar localmente:

```bash
node scripts/check.mjs
npx serve site   # ou qualquer servidor estático
```

## Integração por API (Negociador)

Veja a aba **Integração e API** da página: contrato de dados, busca por URL REST (requer CORS liberado para o domínio do site), `postMessage` para portais e a função `Contrapeso.carregar(itens)`.

## Aviso

Estimativas para apoio à decisão. Não é parecer fiscal. Alíquotas de referência baseadas na estimativa do Comitê Gestor do IBS (Res. CGIBS 14/2026), sujeitas à definição do Senado.

## Manual

O manual em PDF fica em `site/manual/contrapeso-manual.pdf` e é publicado junto com o site. As fontes do manual (texto, modelo e scripts de captura de tela e geração do PDF) estão em `docs/manual/`.

## Multiempresa e login

Com o Supabase configurado, cada empresa tem seu próprio espaço:

- **Criar empresa:** qualquer pessoa cria a conta da empresa em `entrar/` e vira admin dela.
- **Usuários:** o admin convida por e-mail em `empresa/`. Perfis: **admin** (gerencia usuários e dados), **editor** (importa, negocia, altera premissas) e **leitor** (consulta; nada é salvo).
- **Isolamento:** feito no banco com Row Level Security (`supabase/migrations/`). Uma empresa não lê, não grava e não lista usuários de outra, nem chamando a API direto.
- **Master:** e-mails na tabela `masters` veem e administram todas as empresas.
- **Dados:** Simulador e Negociador salvam por empresa na tabela `dados`, com controle de versão: se duas pessoas editam ao mesmo tempo, a segunda é avisada em vez de sobrescrever.

Sem configuração (`site/app/config.js` vazio), as ferramentas funcionam como antes, com dados só no navegador.

### Publicação automática do banco

O workflow `.github/workflows/banco.yml` roda a cada mudança em `supabase/`:

1. testa as regras de isolamento (`supabase/tests/rls_test.sql`) num Postgres temporário;
2. aplica as migrações, publica a função `usuarios` e configura o login (endereços, senha mínima de 8 caracteres e e-mails em português).

Secrets do repositório (Settings → Secrets and variables → Actions):

| Secret | Obrigatório | O que é |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | sim | Token pessoal do Supabase (Account → Access Tokens) |
| `SUPABASE_PROJECT_REF` | sim | Identificador do projeto (o `xxxx` de `https://xxxx.supabase.co`) |
| `SUPABASE_DB_PASSWORD` | sim | Senha do banco definida na criação do projeto |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER` | recomendado | SMTP próprio. Sem ele, o e-mail padrão do Supabase só entrega para membros da equipe do projeto |

### Testar localmente

`supabase/tests/stub_auth.sql` simula o mínimo do Supabase para rodar `rls_test.sql` em qualquer Postgres 16.
