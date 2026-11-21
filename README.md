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
- Aplicativo instalável (PWA), com cache do catálogo e da interface para acesso básico sem conexão após a primeira visita.
- Painel administrativo com controle por função, cadastro/edição/remoção de concursos e fila de revisão de oportunidades detectadas pelo monitor de fontes oficiais.

## Fontes oficiais consultadas

- MGI: https://www.gov.br/gestao/pt-br/acesso-a-informacao/servidores/concursos-publicos/autorizacoes-e-provimentos
- Banco Central: https://www.bcb.gov.br/acessoinformacao/concursospublicos
- Receita Federal: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/servidores/concurso-publico-2026
- CGU: https://www.gov.br/cgu/pt-br/acesso-a-informacao/concursos/concursos-publicos/

## Notificações

A central de notificações identifica novos concursos adicionados ao catálogo e alterações relevantes em concursos favoritados. Os avisos ficam salvos neste navegador e podem ser abertos para consultar os detalhes da oportunidade.

O usuário pode autorizar notificações do navegador, consultar avisos não lidos, marcar todos como lidos e limpar o histórico. O cabeçalho exibe a quantidade de avisos pendentes e leva diretamente à central. Esse recurso não exige domínio próprio nem serviço de e-mail. Por depender da comparação local do catálogo, as novidades são identificadas quando o usuário abre ou atualiza o EditalRadar depois de uma publicação. Para usuários autenticados, o histórico também é salvo na conta Supabase e carregado ao entrar ou atualizar o aplicativo em outro aparelho; visitantes continuam com histórico apenas local. A sincronização entre aparelhos requer executar a migração `supabase/migrations/202611220001_user_notifications.sql` no SQL Editor do Supabase. As notificações do navegador dependem da permissão concedida e do site estar aberto; não há envio de push quando o navegador está fechado.

## Monitoramento automático das fontes

O GitHub Actions verifica diariamente os links de origem cadastrados em `src/data/concursos.js`. Além de detectar páginas alteradas e novos links, o robô abre as páginas oficiais e faz uma triagem automática. Quando há evidências suficientes de edital de concurso/processo seletivo, órgão, cargo e esfera/estado, a ficha é estruturada e cadastrada no catálogo. Links claramente alheios a concursos são descartados. Páginas ambíguas, PDFs digitalizados como imagem e documentos sem dados suficientes permanecem na fila administrativa; PDFs pesquisáveis são extraídos automaticamente. O sistema não inventa vagas, escolaridade ou datas; dados não confirmados ficam marcados para conferência. Para ativar, execute as migrações `202611220003_contest_discoveries.sql` e `202611220004_auto_publish.sql` no SQL Editor e configure os secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no GitHub Actions. O robô roda diariamente e também pode ser iniciado em Actions → **Monitorar fontes de concursos** → Run workflow.

## Painel administrativo

O painel fica disponível apenas para contas cujo campo protegido `app_metadata.role` no Supabase seja `admin`. A migração `supabase/migrations/202611220002_admin_catalog.sql` cria a tabela de alterações e políticas RLS: todos podem ler as fichas publicadas, mas somente administradores podem alterá-las. Consulte [ADMIN_SETUP.md](./ADMIN_SETUP.md) para conceder o papel. Nunca conceda esse papel pelo `user_metadata`, que pode ser alterado pelo próprio usuário.

As alterações são guardadas como sobreposições: fichas preexistentes podem ser editadas ou removidas sem apagar a curadoria original do repositório; novos concursos recebem IDs do banco. Links oficiais HTTPS são obrigatórios.

## Instalação e uso offline

O EditalRadar pode ser instalado no celular ou computador pelo menu de instalação do navegador. No iPhone/iPad, use Compartilhar → Adicionar à Tela de Início no Safari. O service worker mantém a interface e os arquivos estáticos em cache para permitir a abertura após a primeira visita online. Sem internet, o catálogo já carregado e os dados locais continuam acessíveis; login, sincronização com a conta e atualização do catálogo dependem de conexão. O navegador atualiza o aplicativo quando uma nova versão é publicada.

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
\n### Retificações automáticas\n\nO monitoramento compara retificações oficiais com concursos já cadastrados. Atualizações automáticas são limitadas a registros com correspondência exata de órgão e cargo e a campos objetivos explicitamente indicados na retificação (por exemplo, total de vagas e situação das inscrições). A versão anterior e os campos alterados são preservados em `data.historicoAtualizacoes` no mesmo registro do catálogo. Quando a publicação não permite identificar com segurança o registro ou o novo valor, a descoberta permanece pendente para revisão. Não é necessária uma nova tabela ou migração para esse histórico.\n