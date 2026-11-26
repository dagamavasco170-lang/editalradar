# Importação de questões de provas oficiais

## Objetivo

Importar questões objetivas de PDFs publicados pela própria banca ou pelo órgão do concurso, mantendo origem, versão, página, número original e hash do documento. O importador não acessa nem copia acervos privados de terceiros, não importa comentários de outras plataformas e não publica questões sem revisão administrativa.

## Fundamento e limites

O fluxo aceita o fundamento "official_publication" quando a prova foi efetivamente divulgada em fonte oficial. Essa opção não declara que qualquer PDF ou elemento incorporado ao arquivo seja automaticamente de livre reutilização. A Lei 9.610/1998 exclui do âmbito de proteção os textos de atos oficiais (art. 8º, IV), e há precedente do TJPR que aplicou essa regra a questões de concursos; a extensão da regra a toda reprodução comercial, todo edital e todo conteúdo de terceiros embutido em um PDF não deve ser presumida.

O administrador deve verificar:
- se a URL da página e do PDF pertence à banca ou ao órgão responsável;
- se o certame já publicou o caderno de prova, e não se trata de material sigiloso, vazado ou prova ainda em aplicação;
- se edital, contrato, termo de uso ou aviso específico traz restrição relevante;
- se o item contém imagem, charge, texto, mapa, tabela ou obra de terceiro cuja reutilização possa ter regime próprio;
- se o gabarito usado é definitivo e se a questão foi anulada/alterada.

O campo rights_basis registra o fundamento analisado. license_proof_url é opcional para official_publication; deve ser preenchido quando a base for autorização/licença específica. Restrição específica deve ser anotada em source_restrictions. Todo item permanece em pending e not_reviewed até decisão humana.

## Uso local

Dependências no ambiente:
- Node.js 22 ou superior;
- Poppler (pdfinfo, pdftotext, pdftoppm);
- Tesseract OCR com idioma português (por) e inglês (eng) para páginas digitalizadas.

Crie um arquivo JSON de metadados (exemplo):

    {
      "board": "Cebraspe",
      "exam_name": "Nome do concurso",
      "exam_year": 2025,
      "discipline": "Língua Portuguesa",
      "topic": "Interpretação de textos",
      "difficulty": "Intermediária",
      "question_format": "multiple_choice",
      "role_name": "Cargo",
      "source_url": "https://www.cebraspe.org.br/concursos/...",
      "exam_pdf_url": "https://cdn.cebraspe.org.br/concursos/.../prova.pdf",
      "rights_basis": "official_publication",
      "official_release_verified": true,
      "source_terms_url": null,
      "source_restrictions": ""
    }

official_release_verified só deve ser true depois de confirmar manualmente que o arquivo foi divulgado pela banca/órgão responsável.

Execute:

    node scripts/import-official-exam-pdf.mjs \
      --pdf ./prova.pdf \
      --metadata ./prova.json \
      --out ./manifesto-importacao.json

O utilitário é local/offline: recebe um arquivo PDF já obtido, não faz scraping nem requisições HTTP e não grava no Supabase. Ele calcula SHA-256, extrai texto com layout, tenta OCR apenas em páginas com camada textual ausente/insuficiente, respeita limites de tamanho/páginas/OCR e gera um manifesto JSON. O envio do manifesto pela área administrativa apenas cria rascunhos na tabela de staging.

A publicação usa a função SQL publish_study_exam_question_import. Ela bloqueia o registro pendente, confere permissões/fundamento e alternativa escolhida e grava questão, gabarito separado e status da fila na mesma transação PostgreSQL. Em caso de erro, toda a operação é revertida.

Nesta versão, a única entrada ativa é PDF local → manifesto → fila administrativa → confirmação humana → publicação transacional. A rotina de ingestão automática com SUPABASE_SERVICE_ROLE_KEY não é ativada pelo workflow nem possui comando operacional no package.json. O módulo auxiliar de descoberta/validação falha de forma segura quando sua função de execução automática é invocada.

## Revisão obrigatória

O parser é heurístico: reconhece questões numeradas com alternativas A-F e, quando question_format="true_false", itens Cebraspe identificados como ITEM N, criando as opções C/Certo e E/Errado sem preencher o gabarito. Não é um OCR jurídico nem garante que toda questão foi reconhecida. Para provas Cebraspe de julgamento, informe question_format="true_false" nos metadados; para provas de múltipla escolha, use "multiple_choice". O manifesto não preenche gabarito (suggested_answer permanece null). Itens com figuras, tabelas, gráficos, mapas ou texto externo recebem alerta de revisão visual.

Antes de inserir/publicar:
1. confira todas as páginas do PDF, especialmente páginas que receberam OCR;
2. compare enunciado e alternativas com a imagem do caderno;
3. confirme número original e página;
4. compare o gabarito com a versão definitiva e verifique anulações/retificações;
5. classifique direitos/base e registre restrições específicas;
6. confira duplicidade contra o banco existente;
7. mantenha a referência oficial e o SHA-256 para rastreabilidade.

Não importar de páginas, PDFs ou bancos do Gran, Qconcursos, PCI Concursos ou outros agregadores. Use-os apenas como referências de descoberta; obtenha o PDF diretamente da banca/órgão. Não copiar suas explicações, comentários, taxonomias proprietárias, índices ou organização de dados.

## Testes

    node --test scripts/import-official-exam-pdf.node-test.mjs

Os testes unitários não exigem Poppler, Tesseract, PDF real nem credenciais Supabase.
