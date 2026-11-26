# Importação autônoma de questões de provas oficiais

## Operação sem revisão humana

O EditalRadar descobre provas em fontes cadastradas e no catálogo de concursos, consulta páginas oficiais das bancas e órgãos, identifica pares de caderno e gabarito definitivo, baixa os PDFs, extrai texto, aplica OCR seletivo, separa questões e cruza cada número com a resposta oficial. Itens que passam nos critérios determinísticos são publicados automaticamente no banco, com gabarito armazenado separadamente.

O workflow existente executa o processo a cada seis horas. Não é necessário enviar manifesto, confirmar questões, aprovar gabaritos ou operar uma fila manual. O painel administrativo é somente de monitoramento.

## Fontes e proveniência

- São consumidos documentos obtidos diretamente de hosts oficiais permitidos (bancas e órgãos públicos).
- As fontes de descoberta são o catálogo de concursos, as fontes oficiais cadastradas e as URLs oficiais encontradas nas páginas.
- O worker não baixa provas do PCI Concursos, Gran Questões, Qconcursos ou outros agregadores, nem copia comentários, respostas comentadas, taxonomias ou a organização desses serviços.
- Cada prova e cada gabarito precisam ter assinatura PDF válida e SHA-256 registrado.
- Só são aceitos pares de prova e gabarito identificados como definitivos/finais. Gabaritos preliminares, conflitantes ou sem cobertura suficiente não publicam questões.
- official_publication é o fundamento de reutilização empregado para provas oficialmente divulgadas. A publicação automática bloqueia restrições expressas de reprodução detectadas na página ou no PDF. Isso não torna anexos de terceiros, figuras ou obras incorporadas automaticamente livres.

## Critérios automáticos de publicação

Cada item precisa cumprir todos os critérios, com pontuação de 98/100 ou 100/100:
1. página da prova e PDF da prova em host oficial permitido;
2. PDF do gabarito definitivo em host oficial permitido, com hash próprio;
3. mapeamento não ambíguo entre número da questão e alternativa do gabarito;
4. questão objetiva estruturada, com quatro/cinco alternativas ou item Cebraspe Certo/Errado;
5. enunciado autônomo, sem depender de texto externo, figura, charge, tabela, mapa ou gráfico;
6. texto íntegro, sem artefatos relevantes de extração/OCR;
7. gabarito correspondente a uma alternativa existente;
8. ausência de duplicidade por fingerprint, documento e número;
9. ausência de restrição expressa de reutilização detectada no material analisado.

Questões anuladas, itens com gabarito conflitante, PDFs incompletos, páginas com dependências visuais, formatos discursivos e documentos sem metadados suficientes são descartados ou adiados automaticamente. Não entram em uma fila à espera de pessoas.

## Limites operacionais e proteção

- Até 120 fontes candidatas por ciclo, 20 pares de PDFs por ciclo e 120 publicações por execução.
- PDF limitado a 25 MB e 300 páginas.
- OCR Tesseract em português, com amostragem distribuída de até 60 páginas sem camada textual, usando Poppler.
- Até três tentativas automáticas de publicação; após três falhas técnicas consecutivas, o item é encerrado como rejeitado.
- HTTP 401/403/429, CAPTCHA, WAF, redirects para hosts externos e documentos acima dos limites não são contornados. São registrados e tentados novamente nos ciclos seguintes quando aplicável.
- O worker usa apenas SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existentes nos secrets do workflow. Não cria chave nova, não expõe credencial no cliente e não usa provedor de IA pago.
- A publicação de questão, gabarito e status da importação ocorre em uma única função SQL transacional. A deduplicação também é protegida por índices únicos no PostgreSQL.

## Comandos

O comando usado pelo agendamento é:

    npm run import:official-exams

O importador local abaixo é uma ferramenta opcional de diagnóstico e não faz parte do fluxo agendado:

    node scripts/import-official-exam-pdf.mjs --pdf ./prova.pdf --metadata ./prova.json --out ./manifesto.json

Dependências do worker nas GitHub Actions: Node.js 22+, Poppler (pdfinfo, pdftotext, pdftoppm) e Tesseract com idioma português.

## Ativação

A funcionalidade só começa a executar depois que a PR for incorporada ao branch de produção e a migration supabase/migrations/20261126120000_official_exam_question_imports.sql for aplicada no banco. Até esses passos serem autorizados e realizados, o código e o agendamento ficam apenas na PR Draft; nenhuma gravação ou migration é feita em produção por esta implementação.

Depois de ativada, a coleta, validação, deduplicação, publicação, retry e monitoramento são automáticos. A ausência de intervenção humana por questão não significa publicar itens que não passaram nos critérios: incerteza resulta em descarte ou nova tentativa, nunca em publicação presumida.

## Testes

    npm run test:monitor
    npm test
    npm run build
