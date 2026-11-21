# EditalRadar

Plataforma web demonstrativa para acompanhar concursos públicos com links para fontes oficiais e organizar a preparação.

## Cobertura inicial

A primeira curadoria reúne oportunidades federais verificadas em páginas oficiais do Banco Central, Receita Federal e CGU, conferidas em 21/11/2026.

- Banco Central 2026: 170 vagas autorizadas — 100 Auditor, 50 Técnico e 20 Procurador. Edital ainda não publicado; inscrições aguardam edital.
- Receita Federal 2026: 146 vagas autorizadas — 116 Analista-Tributário e 30 Auditor-Fiscal. Situação pré-edital nas informações consultadas.
- CGU 2026: 60 vagas de Auditor Federal de Finanças e Controle. Edital publicado em 09/10/2026; inscrições encerradas em 04/11/2026; prova prevista para 13/12/2026.

Cada cartão leva à página oficial do respectivo órgão. Status e datas devem sempre ser conferidos na fonte oficial, pois podem mudar.

## Limites da cobertura

Esta é uma seleção inicial de concursos federais, não uma lista completa de todos os concursos do Brasil. Ainda não inclui uma cobertura sistemática de estados, municípios, outros Poderes e empresas públicas. O aplicativo não afirma que inscrições estão abertas sem confirmação na fonte.

## Registros preliminares

O catálogo também pode exibir registros preliminares de Alagoas identificados em listagens secundárias. Eles são marcados como “Concurso listado · verificar edital e cronograma”, não representam confirmação individual por edital oficial e não devem ser usados como prova de vagas, requisitos, inscrições ou datas. Esses registros ficam fora da soma de vagas exibida no aplicativo. A publicação oficial do órgão ou da banca deve ser consultada antes de qualquer decisão.

## Funcionalidades

- Busca por cargo, órgão, ato e escolaridade.
- Filtro por escolaridade.
- Status por etapa da seleção.
- Links oficiais por concurso e detalhes.
- Favoritos guardados no navegador.
- Área de estudos com checklist e questão demonstrativa.
- Interface responsiva.

## Fontes oficiais consultadas

- MGI: https://www.gov.br/gestao/pt-br/acesso-a-informacao/servidores/concursos-publicos/autorizacoes-e-provimentos
- Banco Central: https://www.bcb.gov.br/acessoinformacao/concursospublicos
- Receita Federal: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/servidores/concurso-publico-2026
- CGU: https://www.gov.br/cgu/pt-br/acesso-a-informacao/concursos/concursos-publicos/

## Desenvolvimento

Requisitos: Node.js 22+ e npm.

```bash
npm install
npm run dev
```

Compilar: `npm run build`.

O GitHub Actions compila e publica o site no GitHub Pages a cada atualização da branch `main`.

## Testes automatizados

A suíte usa Vitest, jsdom e Testing Library para verificar renderização, pesquisa, filtros, favoritos, detalhes dos concursos e checklist de estudos.

Executar localmente:

```bash
npm install
npm test
```

O GitHub Actions executa os testes antes do build. A publicação só é realizada se os testes e a verificação do caminho dos arquivos do GitHub Pages passarem.
