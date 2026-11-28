# Ingestão de provas e questões oficiais

## Objetivo

Manter no banco próprio do EditalRadar questões extraídas de cadernos oficiais, com banca, concurso, cargo, ano, página, número original, alternativas, gabarito definitivo, anulações, hash da prova e referência da fonte. O site e o Android consomem o mesmo Supabase; a fila privada é revisada no painel administrativo antes da publicação.

## Modos de execução

- `dry-run`: baixa e analisa os PDFs, extrai questões, cruza o gabarito e gera relatório. Não grava enunciados no banco.
- `stage`: executa as mesmas validações e grava questões elegíveis em `study_exam_question_imports`, com o gabarito e proveniência. Os registros ficam privados, com `status=pending`, `rights_review_status=not_reviewed` e `rights_basis=official_publication`; isso identifica a origem do caderno, mas não o publica por si só. Não aparecem no banco público nem no app.
- `publish`: só processa fontes com uma decisão de reutilização documentada em nível de fonte. A base pode ser publicação oficial, domínio público, licença aberta ou autorização; não exige anexar uma autorização individual para cada questão. A publicação passa pela RPC transacional e mantém a auditoria.

O modo `stage` não é uma declaração de que todo o conteúdo está livre para reutilização; é a fila interna para conferência de proveniência, gabarito e enquadramento da fonte. O modo `publish` não presume que a mera disponibilidade de um PDF autoriza qualquer uso.

## Pipeline

1. **Fontes**: lê registros publicados em `study_exam_sources` e fontes oficiais adicionais mantidas em `scripts/official-exam-sources.json`. A lista é limitada a 120 registros por execução. Fontes persistidas são ordenadas pelo momento da última verificação, para distribuir os ciclos entre as bancas e evitar reprocessar sempre o mesmo concurso.
2. **Descoberta**: examina a página da banca, PDFs e até três páginas intermediárias. Os destinos são limitados a HTTPS e aos hosts permitidos em `src/lib/official-sources.js`. Não tenta contornar WAF, CAPTCHA, login, paywall, robots ou respostas 401/403/429.
3. **Download**: valida redirects e assinatura PDF, com limites de 5 MB para HTML e 25 MB por PDF.
4. **Extração**: usa Poppler e Tesseract em português, respeitando até 300 páginas por PDF e até 60 páginas selecionadas para OCR. Preserva página e numeração original.
5. **Gabarito**: exige gabarito definitivo identificável e associação inequívoca por cargo/caderno/versão. A resposta não é inferida pelo enunciado. Questões anuladas ou sem resposta válida não são elegíveis.
6. **Validação**: exige correspondência de 100% do conjunto numérico do gabarito com o caderno. Questões incompletas, duplicadas, dependentes de imagens, tabelas, mapas, charges ou texto externo permanecem em quarentena.
7. **Persistência**: `stage` guarda o item e a resposta sugerida na fila privada; `publish` grava questão e resposta em tabelas separadas por transação. Duplicatas não criam novas questões.
8. **Rodízio de fontes**: ao terminar de examinar uma fonte, atualiza `last_ingested_at` e `last_ingested_run`. O próximo ciclo começa pelas fontes que ainda não foram verificadas ou estão há mais tempo sem ingestão.
9. **Relatório**: audita fontes, documentos, questões extraídas, pré-cadastros, publicação, duplicatas, anulações, quarentena e falhas.

## Critério de reutilização

A decisão é feita por fonte e por fundamento aplicável, não por autorização separada de cada questão. Para questões de cadernos oficiais publicados, o fundamento `official_publication` é registrado com a própria página da banca/órgão. O TJPR, na Apelação Cível 1437332-3 (5ª Câmara Cível, julgamento de 22/03/2016), aplicou o art. 8º, IV, da Lei 9.610/1998 ao tratar questões de concursos como atos oficiais. Para outras fontes, o sistema registra domínio público, licença aberta, autorização ou outra análise documentada. Conteúdo de terceiros incorporado ao enunciado — por exemplo, imagem, charge, texto ou mapa — pode exigir tratamento próprio. Os links oficiais continuam disponíveis mesmo quando uma questão ainda não foi liberada para publicação.

A Lei 9.610/1998 exclui textos de atos oficiais em seu art. 8º, IV, e trata de forma própria da reprodução e inclusão em bases de dados no art. 29 e das limitações/citações no art. 46. O enquadramento concreto depende do material e da origem; não se presume nem que todos os itens exigem autorização individual nem que todo PDF público pode ser republicado integralmente.

## Execução

- O workflow de PR executa `dry-run` sem credenciais.
- O workflow manual oferece `dry-run`, `stage` e `publish`.
- A agenda e o push para `main` executam `publish` por padrão quando a variável `EXAM_IMPORT_AUTOPUBLISH_ENABLED` não está definida ou é `true`; defina-a como `false` para executar somente `stage`. O modo `publish` inclui apenas fontes aprovadas em nível de fonte e questões que passam por todos os controles técnicos.
- É necessário configurar `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` como secrets do GitHub Actions para execução `stage`/ `publish`.

## Relatório de validação já realizado

A execução 46100811601 analisou 12 PDFs oficiais da FGV/PCPR: 1.200 itens extraídos, 1.021 elegíveis tecnicamente, 159 em quarentena, 20 anulados ou sem resposta válida e zero falhas. Foi `dry-run`; portanto, não gravou os enunciados no Supabase. O catálogo da produção agora também registra a fonte oficial PCPR/FGV para que os 15 cadernos identificados sejam processados em ciclos subsequentes.

## Limites

- A descoberta depende das fontes cadastradas e do catálogo do EditalRadar; não é um crawler universal.
- Layouts de PDF, gabaritos em imagem, OCR, retificações e associações ambíguas permanecem sujeitos a revisão.
- O worker não importa comentários, explicações ou taxonomias de Qconcursos, Gran ou outros agregadores.
- Ainda é necessário implementar explicações próprias e reconciliação automática de retificações de gabaritos.
