# EditalRadar — Direção de produto, UX e redesign visual

## Objetivo
Evoluir o EditalRadar para uma plataforma completa de preparação para concursos, com interface de alta qualidade, navegação previsível, foco em estudo e identidade própria. Inspirar-se em padrões de produto e fluxo de trabalho de Qconcursos, Gran Questões e Tec Concursos, sem copiar marca, layouts exatos, textos, assets, código ou elementos proprietários.

## Referências de experiência
- **Qconcursos:** descoberta por filtros, questões e cadernos organizados, continuidade entre busca e prática, ações de guardar questões.
- **Gran Questões:** painel de desempenho, provas completas, simulados configuráveis, disciplinas/assuntos em árvore, programa de estudos e evolução.
- **Tec Concursos:** referência para produtividade no banco de questões e ferramentas de prática; validar funcionalidades atuais antes de adotar padrões específicos.

## Identidade visual
- Marca clara, confiável, orientada a dados e ação — sem parecer cópia de cursinho.
- Paleta: azul profundo/ink para estrutura; azul vivo para ação; verde para progresso/acertos; âmbar para atenção; vermelho para erro/risco.
- Superfícies neutras, cards limpos, bordas sutis e sombras discretas; evitar excesso de gradientes e poluição.
- Tipografia sans-serif moderna, escala consistente, números com hierarquia e alta legibilidade.
- Tokens centralizados de cor, spacing, radius, shadows e typography; ícones consistentes e estados de foco.
- Tema claro padrão; tema escuro preservado e aprimorado.

## Navegação
### Desktop
Sidebar persistente: Visão geral, Concursos, Questões, Provas, Simulados, Disciplinas, Plano de estudos, Cadernos, Estatísticas, Favoritos e Alertas. Administração segregada, somente para administradores.
Topbar: busca global (concurso, órgão, cargo, banca, assunto), notificações, ajuda, perfil e tema.
Conteúdo: breadcrumb, título/subtítulo, ação primária contextual, filtros recolhíveis, grid de largura controlada.
### Mobile
Bottom navigation com destinos prioritários, menu Mais, filtros em bottom sheet, cards empilhados e ações acessíveis com o polegar; sidebar não ocupa espaço.

## Dashboard
- Saudação e retomar sessão anterior.
- Concurso-alvo e meta semanal.
- KPIs de questões respondidas, acerto, tempo, consistência e sessões (somente dados existentes).
- Gráfico de atividade e evolução, acessível.
- Oportunidades personalizadas, inscrições, próximos marcos, alterações e fontes oficiais.
- Plano do dia e ação iniciar sessão.
- Ações rápidas: questões, simulado, prova e revisão de erros.

## Concursos
- Busca/filtros por situação, esfera, estado, escolaridade, órgão, banca, cargo e cidade; filtros ativos em chips removíveis.
- Cards com status, cargo/órgão, vagas e remuneração somente se verificadas, escolaridade, local, banca e datas.
- Comparar, favoritar, alertar e fonte oficial.
- Detalhes em página própria: resumo, cronograma, requisitos, etapas, fontes e histórico; sinalizar dados não confirmados.
- Comparador de até três oportunidades.

## Questões
- Filtros por disciplina, assunto, banca, órgão, cargo, ano, dificuldade, formato, respondidas/erradas/favoritas, origem e comentários disponíveis.
- Busca textual; filtros avançados em drawer/sheet; chips para filtros ativos.
- Total, ordenação, salvar filtro, criar caderno e gerar simulado.
- Card de leitura confortável: enunciado, metadados discretos, alternativas grandes e clicáveis, navegação e salvar.
- Feedback após resposta, gabarito, justificativa apenas quando confiável, referência oficial e comentários (se implementados).
- Revisão de erros, questões marcadas e continuidade de sessão.
- Questões oficiais somente com origem, revisão de direitos e estado de publicação adequados.

## Modo prova / resolução
- Layout de foco, sem sidebar pesada; cabeçalho com prova, progresso, tempo e opções.
- Desktop: questão e painel de números; painel lateral recolhível.
- Mobile: timer/progresso compacto, navegação e controles no rodapé.
- Estados: não respondida, respondida, revisar, anulada e sincronização offline.
- Timer, pausa quando aplicável, confirmação ao sair e recuperação de sessão.
- Resultado: acertos, erros, em branco, tempo, desempenho por matéria/assunto e fila de revisão.

## Simulados
- Configuração: disciplinas/assuntos, banca, quantidade, distribuição, nível e duração.
- Presets sugeridos: 10 (rápido), 20 (prática), 40 (prova), personalizado.
- Diferenciar simulados inéditos, oficiais, de usuário e histórico.
- Resumo antes de iniciar, foco durante a execução, análise após concluir.

## Disciplinas e assuntos
- Árvore/accordion, busca, contagem real e taxa de acerto quando houver histórico.
- Priorizar assuntos fracos/frequentes com explicação de base e período, sem promessas de previsão.
- Acesso ao treino do tópico e inclusão no plano.

## Plano de estudos
- Setup simples: concurso, dias disponíveis, horas e disciplinas.
- Semana visual desktop; lista/agenda mobile.
- Sessões adaptativas de questões, revisão e pausas; concluir e reorganizar.
- Mostrar progresso real.

## Cadernos, favoritos e revisão
- Cadernos personalizados, descrição, questões, duplicatas evitadas, editar/remover.
- Favoritos e marcadores.
- Revisão de erros, questões difíceis e marcadas.
- Ações consistentes para guardar, remover, adicionar e reportar.

## Estatísticas
- Intervalo de datas, volume, acerto, tempo e consistência.
- Gráficos por disciplina, assunto, banca e concurso.
- Indicadores de pontos fortes/fracos baseados no histórico real.
- Recomendações e links para iniciar treino.

## Alertas
- Categorias: novo concurso, alteração, inscrição, prova, gabarito e questão.
- Fonte oficial e data de atualização.
- Preferências por estado, cargo, escolaridade, esfera e palavras-chave.
- Deduplicação e quiet hours configuráveis.

## Administração
- Separada da experiência de candidato.
- Revisão de descobertas, fontes, importação, filas e automações.
- Proveniência e logs de auditoria; ações destrutivas exigem confirmação.
- Segredos e ações privilegiadas nunca expostos na UI pública.

## Componentes
Button, IconButton, SearchBox, FilterBar, FilterChip, Select/Combobox, Tabs, Card, StatusBadge, KPIStat, EmptyState, Skeleton, Toast, Dialog, Drawer/BottomSheet, Pagination, QuestionCard, AnswerOption, Timer, Progress, SourceCitation, ContestCard, ExamCard, StudySessionCard, ChartCard, NotificationItem. Estados default/hover/focus/disabled/loading/success/error e acessibilidade por teclado/leitor de tela.

## Responsividade e qualidade
- Breakpoints orientados ao conteúdo; validar 360, 768, 1024 e 1440px.
- Contraste WCAG AA, foco visível, targets de toque de 44px, labels e não depender só de cor.
- Reduced motion, zoom e teclado.
- Loading/empty/error/success states; retry; evitar layout shift.
- Preservar filtros e sessões; autosave e offline com limites.
- Lazy-load áreas pesadas, paginação/virtualização e evitar requests redundantes.

## Roadmap
### 1. Fundação visual
Auditoria de telas, CSS e componentes; tokens; tipografia; cores; grid; sidebar/topbar; primitives; acessibilidade.
### 2. Descoberta
Dashboard, catálogo, filtros, cards, detalhes, comparador e busca/alertas.
### 3. Estudos
Banco de questões, cadernos, favoritos, revisão, modo resolução, prova, simulado, timer, plano e tópicos.
### 4. Retenção/analytics
Performance, estatísticas, recomendações transparentes e notificações.
### 5. Admin e qualidade
Admin, auditoria, E2E, mobile, Android WebView, performance e regressão.

## Regras
- Entregas pequenas e verificáveis, PRs sequenciais; Draft até validação.
- Preservar funcionalidades, dados, auth, RLS e APIs.
- Supabase produção read-only: sem migrations, DDL, RLS ou writes.
- Não habilitar autopublicação ou publicação durante redesign.
- Sem serviços pagos, contratação ou segredos novos.
- Merge e deploy requerem autorização explícita.
