# EditalRadar

## Licença e propriedade intelectual

O EditalRadar mantém seu código-fonte publicamente visível no GitHub, mas é um software proprietário. A visibilidade pública permite consulta e fork dentro dos limites dos Termos de Serviço do GitHub; isso não concede licença open source nem autorização adicional para comercializar, sublicenciar ou reutilizar os componentes proprietários fora dessas permissões. Bibliotecas e demais componentes de terceiros permanecem sujeitos às respectivas licenças.

Consulte o arquivo [LICENSE](./LICENSE) para conhecer os termos aplicáveis.

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
- Favoritos e filtros sincronizados para usuários autenticados.
- Central de notificações com histórico local para visitantes e sincronizado entre dispositivos para usuários autenticados.
- Área de estudos com checklist e questão demonstrativa.
- Interface responsiva.

## Fontes oficiais consultadas

- MGI: https://www.gov.br/gestao/pt-br/acesso-a-informacao/servidores/concursos-publicos/autorizacoes-e-provimentos
- Banco Central: https://www.bcb.gov.br/acessoinformacao/concursospublicos
- Receita Federal: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/servidores/concurso-publico-2026
- CGU: https://www.gov.br/cgu/pt-br/acesso-a-informacao/concursos/concursos-publicos/

## Notificações

A central de notificações identifica novos concursos adicionados ao catálogo e alterações relevantes em concursos favoritados. Os avisos ficam salvos neste navegador e podem ser abertos para consultar os detalhes da oportunidade.

O usuário pode autorizar notificações do navegador, consultar avisos não lidos, marcar todos como lidos e limpar o histórico. O cabeçalho exibe a quantidade de avisos pendentes e leva diretamente à central. Esse recurso não exige domínio próprio nem serviço de e-mail. Por depender da comparação local do catálogo, as novidades são identificadas quando o usuário abre ou atualiza o EditalRadar depois de uma publicação. Para usuários autenticados, o histórico também é salvo na conta Supabase e carregado ao entrar ou atualizar o aplicativo em outro aparelho; visitantes continuam com histórico apenas local. A sincronização entre aparelhos requer executar a migração `supabase/migrations/202611220001_user_notifications.sql` no SQL Editor do Supabase. As notificações do navegador dependem da permissão concedida e do site estar aberto; não há envio de push quando o navegador está fechado.

## Monitoramento automático das fontes

O GitHub Actions verifica diariamente os links de origem cadastrados em `src/data/concursos.js`. Alterações no conteúdo ou falhas de acesso geram uma issue para revisão editorial e um relatório de execução. O monitor **não** altera automaticamente o catálogo: vagas, requisitos, inscrições, cronogramas e status só devem mudar após conferência humana na fonte oficial. A primeira execução cria a linha de base; depois, diferenças de conteúdo são sinalizadas.

Para executar manualmente: Actions → **Monitorar fontes de concursos** → Run workflow.

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
