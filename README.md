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
