# EditalRadar — Direção de produto, UX e redesign visual

## Objetivo
Evoluir o EditalRadar para uma plataforma de preparação para concursos completa, com interface de alta qualidade, navegação previsível, foco em estudo e identidade própria. Inspirar-se em padrões de produto e fluxo de trabalho de Qconcursos, Gran Questões e Tec Concursos, sem copiar marca, layouts exatos, textos, assets, código ou elementos proprietários.

## Referências de experiência
- **Qconcursos:** descoberta por filtros, questões e cadernos organizados, continuidade entre busca e prática, ações de guardar questões.
- **Gran Questões:** painel de desempenho, provas completas, simulados configuráveis, disciplinas/assuntos em árvore, programa de estudos e visão de evolução.
- **Tec Concursos:** tratar como referência de navegação funcional, produtividade no banco de questões e ferramentas de prática; validar funcionalidades atuais antes de replicar qualquer fluxo específico.

## Identidade visual proposta
- Marca: EditalRadar — clara, confiável, orientada a dados e ação; não parecer uma cópia de cursinho.
- Paleta: azul profundo/ink para estrutura e confiança; azul vivo para ações; verde para progresso/acertos; âmbar para atenção; vermelho apenas para erro ou risco.
- Superfícies: fundo neutro e levemente quente, cards limpos, bordas sutis, sombras discretas; evitar gradientes excessivos, efeitos pesados e dashboards poluídos.
- Tipografia: sans-serif moderna, escala tipográfica consistente, títulos compactos e legíveis; números de desempenho com hierarquia.
- Iconografia consistente, labels explícitos e estados de foco visíveis.
- Design tokens centralizados (cores, spacing, radius, shadows, typography) e componentes reutilizáveis.
- Tema claro como padrão; tema escuro preservado e aprimorado.

## Estrutura de navegação (desktop)
1. **Sidebar persistente:** Visão geral, Concursos, Questões, Provas, Simulados, Disciplinas, Plano de estudos, Cadernos, Estatísticas, Favoritos e Alertas. Administração fica segregada e visível somente a administradores.
2. **Barra superior:** busca global (concurso, órgão, cargo, banca, assunto), notificações, ajuda, perfil e acesso rápido ao tema.
3. **Conteúdo:** breadcrumb, título + subtítulo, ação primária contextual, filtros colapsáveis e conteúdo em grid com largura controlada.
4. **Mobile:** bottom navigation com 4–5 destinos prioritários, menu “Mais”, filtros em bottom sheet, cards empilhados, ações principais acessíveis com polegar; sidebar nunca ocupa espaço.

## Visão geral / Dashboard
- Saudação e “continuar de onde parei”.
- Concurso-alvo e meta semanal configurável.
- KPI: questões respondidas, taxa de acerto, tempo de estudo, sequência e sessões concluídas (mostrar apenas dados existentes; não inventar métricas).
- Gráfico de atividade e evolução de acerto por período, acessível e com texto alternativo.
- Lista de oportunidades personalizadas: inscrições abertas, próximos marcos, alterações recentes e alertas oficiais.
- Plano de estudo do dia com progresso e botão iniciar sessão.
- Ações rápidas: encontrar questões, gerar simulado, abrir prova e revisar erros.

## Concursos
- Busca e filtros por situação, esfera, estado, escolaridade, órgão, banca, cargo e cidade, com filtros ativos em chips removíveis.
- Listagem em cards informativos, com status de inscrições e etapa, cargo/órgão, vagas (se verificadas), remuneração (se verificada), nível, local, banca e data relevante.
- Ação comparar, favoritar, alertar e ver fonte oficial.
- Detalhes em página própria: resumo, cronograma, requisitos, etapas, fontes e histórico de mudanças; destacar dados não confirmados.
- Comparador para até 3 oportunidades com tabela e campos de origem.

## Questões — área central de estudo
- Barra de filtros estruturada (disciplina, assunto, banca, órgão, cargo, ano, dificuldade, formato, status respondida/errada/favorita, origem e comentários quando disponíveis).
- Busca textual; filtros avançados em drawer/sheet e filtros ativos como chips.
- Resultado com total, ordenação, salvar filtro, criar caderno e gerar simulado.
- Questão em card de leitura confortável: enunciado, metadados discretos, alternativas grandes e clicáveis, navegação e salvar/favoritar.
- Ao responder: feedback claro sem saltos visuais, gabarito, justificativa somente se houver fonte/explicação confiável, referência oficial, tags, comentários quando implementados.
- Revisão de erro, questões marcadas, caderno e continuidade de sessão.
- Não apresentar questões oficiais sem origem/rights review e estado de publicação adequado.

## Modo de resolução / prova
- Layout de foco, sem sidebar pesada; cabeçalho com concurso/prova, progresso, tempo e opções.
- Desktop: coluna de questão + painel de navegação de números; painel lateral recolhível.
- Mobile: progresso e timer no topo, navegação de questões compacta, controles no rodapé fixo.
- Estados: não respondida, respondida, marcada para revisão, anulada, sincronização offline.
- Prova cronometrada, pausável quando permitido, confirmação de saída e recuperação de sessão.
- Resultado: acertos, erros, em branco, tempo, desempenho por disciplina/assunto, lista de revisão e recomendações baseadas em dados.

## Simulados
- Criador com seleção de disciplinas/assuntos, banca, quantidade, distribuição, nível e duração.
- Presets: rápido (10), prática (20), prova (40), personalizado; apenas sugestões, não imposições.
- Simulados salvos, inéditos oficiais, simulados do usuário e histórico diferenciados por origem.
- Antes de iniciar, resumo de configuração; durante a prova, foco; ao finalizar, relatório e revisão.

## Disciplinas e assuntos
- Árvore/accordion de disciplinas e tópicos, busca, contagem real de questões e taxa de acerto (se houver histórico).
- Priorizar assuntos fracos e frequentes sem prometer previsão; mostrar base e período da estatística.
- Acesso direto a treino do tópico e inclusão no plano.

## Plano de estudos
- Configuração simples (objetivo/concurso, dias, disponibilidade e disciplinas).
- Semana visual em desktop; agenda/lista em mobile.
- Sessões adaptativas com questões, revisão e pausas; marcar conclusão e reorganizar.
- Mostrar progresso real; nunca criar sessões ou resultados falsos.

## Cadernos, favoritos e revisão
- Cadernos criados pelo usuário, nome, descrição, questões adicionadas, duplicatas evitadas, editar e remover.
- Favoritos e marcadores.
- Fila de revisão de erros, questões difíceis e questões marcadas.
- Ações consistentes: salvar, remover, adicionar a caderno, reportar problema.

## Estatísticas
- Dashboard com intervalo de datas, volume, acerto, tempo e consistência.
- Charts por disciplina, assunto, banca e concurso; filtros de período.
- Heatmap/indicador de pontos fortes e fracos, baseado exclusivamente no histórico real.
- Recomendações práticas e links para começar uma sessão.

## Alertas e descoberta
- Central de notificações com categorias (novo concurso, alteração, inscrição, prova, gabarito, questão).
- Fonte oficial e data/hora de atualização sempre visíveis.
- Preferências por estado, cargo, escolaridade, esfera e palavras-chave.
- Deduplicação, quiet hours configuráveis e gerenciamento de alertas.

## Admin / operações
- Administração isolada da experiência do candidato.
- Revisão de concursos descobertos, fontes, importação de provas, filas e saúde de automações.
- Estados de confiança/proveniência; log de auditoria; ação destrutiva exige confirmação.
- Não expor segredos nem executar ações privilegiadas a partir de UI pública.

## Componentes reutilizáveis
Button (variants), IconButton, SearchBox, FilterBar, FilterChip, Select/Combobox, Tabs, Card, StatusBadge, KPIStat, EmptyState, Skeleton, Toast, Modal/Dialog, Drawer/BottomSheet, Pagination, QuestionCard, AnswerOption, Timer, Progress, SourceCitation, ContestCard, ExamCard, StudySessionCard, ChartCard, NotificationItem.
Todos com states: default, hover, focus, disabled, loading, success, error; acessibilidade via teclado e leitor de tela.

## Responsividade, acessibilidade e qualidade
- Breakpoints orientados ao conteúdo; testar 360px, 768px, 1024px, 1440px.
- WCAG AA para contraste, foco, tamanho de alvo (mínimo prático 44px), labels, sem depender somente de cor.
- Reduced motion, zoom e navegação por teclado.
- Loading/empty/error/success states para cada fluxo; feedback de ações e retry.
- Evitar layout shift, preservar filtros e sessão ao navegar; autosave e offline com limites claros.
- Performance: lazy-load áreas pesadas, paginação/virtualização onde necessário, evitar queries repetidas.

## Roadmap de implementação
### Fase 1 — Fundamentos visuais
1. Auditoria de telas e fluxos atuais, inventário de CSS e componentes.
2. Design tokens, tipografia, cores, spacing, grid, sidebar/header e primitives.
3. Aplicar shell responsivo e acessibilidade sem quebrar funcionalidades.

### Fase 2 — Descoberta e concursos
4. Redesenhar dashboard, catálogo, filtros, cards, detalhes e comparador.
5. Busca global e alertas consistentes.

### Fase 3 — Estudo
6. Redesenhar filtros e resultados de questões, cards, cadernos, favoritos e revisão.
7. Modo resolução, prova e simulado; timer e persistência.
8. Plano de estudo, disciplinas, tópicos e sessão.

### Fase 4 — Retenção e analytics
9. Dashboard de desempenho e estatísticas; recomendações transparentes.
10. Notificações e preferências.

### Fase 5 — Admin e acabamento
11. Redesign administrativo e ferramentas de auditoria.
12. Testes e2e, mobile, Android WebView, performance, acessibilidade e regressão.

## Regras de execução
- Implementar por entregas pequenas e testáveis; cada fase em PR separado (ou PRs sequenciais), Draft até validação.
- Não fazer redesign só de screenshots: manter funcionalidade, dados, auth, RLS e APIs.
- Não modificar migrations ou dados de produção; Supabase produção permanece read-only.
- Não habilitar autopublicação nem publicação de provas/questões durante o redesign.
- Nenhuma contratação, serviço pago ou segredo novo.
- Merge e deploy exigem autorização explícita; não habilitar publicação em produção automaticamente.
- Antes de cada PR: refetch main/head, testes, build, E2E relevantes e Android smoke quando afetado.
