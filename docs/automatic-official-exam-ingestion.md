# Ingestão autônoma de provas e questões oficiais

## Objetivo

O worker descobre documentos publicados em fontes oficiais, extrai questões, associa o gabarito definitivo do mesmo caderno e só tenta publicar quando todos os controles determinísticos passam. Não cria pendências para revisão humana: itens ambíguos, incompletos, anulados ou incompatíveis são descartados/quarentenados no relatório técnico.

## Fluxo implementado

1. **Fontes**: consulta registros publicados em `study_exam_sources` (quando as credenciais de servidor estão disponíveis) e combina-os com contextos pós-prova do catálogo estático. A lista é limitada a 120 registros por execução.
2. **Descoberta**: examina a página oficial registrada, seus links PDF e até três páginas intermediárias indicadas por links de documentos/provas/gabaritos. Restringe os destinos a HTTPS e aos hosts allowlisted em `src/lib/official-sources.js`. Links de inscrição, resultado, recurso e login são ignorados.
3. **Download**: valida novamente cada redirect, rejeita destino fora da allowlist, aplica limite de 5 MB para páginas HTML e 25 MB para PDFs, timeout e tentativas limitadas. Não contorna WAF, CAPTCHA, login, paywall, robots nem 401/403/429. PDFs devem conter assinatura `%PDF-`.
4. **Extração**: usa Poppler e Tesseract português, com os limites do importador existente (até 300 páginas e até 60 páginas selecionadas para OCR). Preserva página e numeração de origem. Nesta versão, qualquer questão extraída por OCR é inelegível para autopublicação.
5. **Gabarito**: só aceita gabarito cuja publicação definitiva esteja indicada por evidência na URL, página ou notas do registro e confirmada no próprio conteúdo. O parser suporta linhas numeradas, tabelas textuais e gabaritos consolidados por cargo/caderno/turno; `*` é tratado como questão anulada. A seção é associada ao PDF da prova por cargo e tipo do caderno, e só é aceita quando existe exatamente uma correspondência. Gabarito preliminar, conflito, associação ambígua, layout não reconhecido ou OCR no gabarito impedem a publicação. A resposta nunca é inferida pelo enunciado.
6. **Validação**: verifica enunciado, alternativas, identificadores, dependência de imagens/tabelas/gráficos/mapas/texto externo, hashes, fingerprints, respostas anuladas e correspondência de **100% do conjunto numérico do gabarito**, incluindo posições anuladas, com as questões extraídas, sem faltantes, duplicatas ou números inesperados. Se a cobertura do caderno não for integral, nada desse caderno é autopublicado. Com cobertura integral comprovada, somente questões que passam individualmente em todos os controles ficam elegíveis; itens com dependência visual, externa ou OCR permanecem em quarentena.
7. **Publicação**: no modo `publish`, registra auditoria e staging e chama a RPC `publish_study_exam_question_import_automated`. A RPC confirma proveniência, hashes, URL, evidências, resposta e execução ativa, e grava questão, gabarito e status numa transação. Duplicatas não criam novas questões.
8. **Relatório**: registra fontes, links intermediários, candidatos a prova/gabarito, documentos sem associação, erros de rede, questões extraídas, duplicatas, quarentena e publicações.

## Gates de autopublicação

Todos devem passar:
- fonte HTTPS em host oficial allowlisted e documento realmente publicado;
- prova e gabarito definitivo em PDF válido, sem OCR;
- correspondência inequívoca do caderno/versão;
- parser íntegro, questão textual completa e alternativas sequenciais;
- nenhum conteúdo visual ou externo necessário para resolver a questão individual;
- gabarito sem conflito e conjunto exato de 100% dos números de questão, incluindo anuladas;
- publicação limitada ao subconjunto de questões aprovadas individualmente, apenas quando a cobertura integral do caderno estiver comprovada;
- hashes, fingerprints e proveniência vinculados no staging;
- RPC transacional e execução de auditoria válidas.

Falhou qualquer gate, o worker não publica a questão. Não existe fallback para aprovação humana neste caminho automático.

## Limites conhecidos

- A descoberta depende de `study_exam_sources` e dos concursos já listados; não é um crawler genérico de todos os concursos do Brasil.
- A expansão segue somente uma camada de até três páginas intermediárias por página cadastrada. Páginas dinâmicas, formulários, links sem texto útil ou portais que bloqueiam acesso podem não ser descobertos.
- O parser de gabaritos é heurístico: reconhece linhas numeradas, pares questão/resposta e tabelas textuais onde números e respostas aparecem em linhas consecutivas, além de seções por cargo/caderno/turno. Formatos de imagem, layouts não reconhecidos e associações ambíguas são recusados.
- Questões com OCR, elementos gráficos, charges, tabelas, mapas, texto externo ou ambiguidades ficam em quarentena; outras questões do mesmo caderno só podem ficar elegíveis quando todos os 100 números do gabarito estiverem extraídos uma única vez e associados sem conflito.
- Ainda não há dois verificadores de IA independentes. O score 100 na RPC representa a aprovação de todos os gates determinísticos; não é uma nota de IA.
- Ainda não há reconciliação automática de retificações posteriores, mudanças de gabarito nem notificação de usuários afetados.
- Ainda faltam validação de DNS contra DNS rebinding, uso de ETag/Last-Modified e testes integrados da RPC em banco descartável.
- O worker não gera comentários de professores nem explicações inventadas; a explicação automática remete ao gabarito definitivo oficial.

## Execução

Comando:

```sh
npm run ingest:official-exams
```

O modo padrão é `dry-run`, limitado a 12 cadernos por execução. O workflow `.github/workflows/automatic-official-exam-ingestion.yml` agenda uma execução diária às 08:40 UTC (05:40 em Brasília), instala Poppler/Tesseract, executa testes, gera relatório e publica artifact. Em eventos de PR, faz `dry-run` sem credenciais do Supabase.

A autopublicação só é selecionada na agenda quando a variável de repositório `EXAM_IMPORT_AUTOPUBLISH_ENABLED=true` estiver habilitada. O workflow manual também oferece modo `dry-run` ou `publish`, mas a RPC exige a migration correspondente no banco.

## Estado de implantação

- Worker, testes, workflow e migration estão na branch da PR #207.
- O CI não aplica migrations.
- A migration ainda não foi aplicada no Supabase de produção.
- A variável de autopublicação não foi habilitada.
- Nenhuma questão foi publicada pelo novo worker.
- A PR permanece Draft e aberta.

A ativação em produção exige teste da migration e RPC em banco descartável, validação de PDFs oficiais reais, revisão do relatório do dry-run com fontes registradas e, somente então, implantação controlada. Esta branch não executa essas mudanças em produção.
