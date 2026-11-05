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

## Multiempresa e login (Firebase)

Com o Firebase configurado em `site/app/config.js`, cada empresa tem o próprio espaço:

- **Criar empresa:** qualquer pessoa cria a conta da empresa em `entrar/` e vira admin dela.
- **Usuários:** o admin convida em `empresa/`. A pessoa recebe um e-mail para criar a senha, que também confirma o e-mail. Perfis: **admin** (gerencia usuários e dados), **editor** (importa, negocia, altera premissas) e **leitor** (consulta; nada é salvo).
- **Isolamento:** feito no servidor pelas regras do Firestore (`firebase/firestore.rules`). Uma empresa não lê, não grava e não lista usuários de outra, nem acessando o banco direto.
- **Master:** os e-mails da função `master()` nas regras (e da lista `MASTERS` em `site/app/conta.js`, só para exibição) veem e administram todas as empresas. Exige e-mail confirmado.
- **Dados:** Simulador e Negociador salvam por empresa, comprimidos e divididos em partes (cabem bases grandes). Há controle de versão: se duas pessoas editam ao mesmo tempo, a segunda é avisada em vez de sobrescrever.

Sem configuração, as ferramentas funcionam como antes, com dados só no navegador.

### Limites do plano gratuito (Spark)

- 150 e-mails de criação/redefinição de senha por dia (usados nos convites e no "esqueci a senha").
- 1.000 e-mails de confirmação por dia.
- Firestore: 50 mil leituras e 20 mil gravações por dia, 1 GB armazenado.

### Testes e publicação automática

O workflow `.github/workflows/firebase.yml` roda a cada mudança:

1. **Regras de isolamento** (`firebase/tests/regras.test.mjs`) no emulador do Firestore.
2. **Fluxo completo no navegador** (`firebase/tests/e2e.mjs`) com os emuladores de Auth e Firestore: criar empresa, confirmar e-mail, convidar, aceitar convite, perfis, conflito de edição, master, remoção e exclusão.
3. Na branch `main`, se os secrets existirem: publica regras e índices do Firestore e ativa o login por e-mail e senha com o domínio do site autorizado.

Secrets do repositório (Settings → Secrets and variables → Actions):

| Secret | O que é |
|---|---|
| `FIREBASE_PROJECT_ID` | ID do projeto no Firebase |
| `FIREBASE_SERVICE_ACCOUNT` | JSON da conta de serviço (Configurações do projeto → Contas de serviço → Gerar nova chave privada) |

Rodar os testes localmente (precisa de Java 21):

```bash
npm install --no-save firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10 playwright@1.48
npx firebase emulators:exec --only firestore --project demo-contrapeso "node --test firebase/tests/regras.test.mjs"
```
