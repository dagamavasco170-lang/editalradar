# Importação de questões de provas oficiais

## Objetivo

Importar questões objetivas de PDFs publicados pela própria banca ou órgão, mantendo banca, concurso, cargo, ano, página, número original, alternativas, gabarito definitivo e hash do documento. O acervo é armazenado no Supabase do EditalRadar e compartilhado entre site e Android.

## Uma avaliação por fonte, não uma autorização por questão

O EditalRadar não exige comprovante individual para cada questão. A decisão de reutilização é registrada em nível de fonte e pode considerar publicação oficial, domínio público, licença aberta, autorização ou outra base documentada. O campo `question_reuse_status` guarda a decisão e o fundamento aplicável.

A disponibilidade pública do PDF não é tratada, isoladamente, como prova de que todo o conteúdo pode ser republicado. Questões que incorporam imagens, charges, mapas, tabelas ou textos de terceiros podem exigir avaliação separada. Os links para as provas oficiais permanecem disponíveis no catálogo, mesmo quando o texto da questão ainda não está liberado para publicação.

A Lei 9.610/1998 exclui textos de atos oficiais de proteção autoral (art. 8º, IV), mas também inclui a reprodução e a inclusão em base de dados entre as formas de utilização da obra (art. 29). O art. 46 prevê limitações e citações em condições específicas. Por isso, o sistema não presume nem que toda questão exige licença individual nem que qualquer prova pública pode ser copiada integralmente sem análise da fonte.

## Fluxo no banco

1. O worker valida que a página e o PDF são da fonte oficial e que a prova foi publicada.
2. Extrai o enunciado e as alternativas, preservando página e número.
3. Localiza o gabarito definitivo, confere a versão/caderno e associa cada resposta.
4. Com cobertura integral do gabarito, prepara os itens tecnicamente válidos.
5. No modo `stage`, grava-os em `study_exam_question_imports` como pendentes, com `rights_basis=not_assessed`. A fila é privada e não aparece para os estudantes.
6. No painel administrativo, a revisão é feita em nível de fonte e dos casos especiais do caderno. Após classificar a base de reutilização e conferir os itens, o administrador pode publicá-los.
7. A publicação grava questão e gabarito em tabelas separadas numa única transação, mantendo URL, hash, página, número e proveniência.

O modo `stage` preserva o trabalho de extração e permite que os itens sejam revisados; não os torna automaticamente públicos. O modo `publish` exige uma decisão de fonte documentada. A autorização não precisa ser repetida para cada item quando o mesmo fundamento cobre a prova/caderno.

## Critérios de qualidade

- PDF obtido diretamente da banca ou órgão oficial; não copiar acervos de agregadores.
- Gabarito definitivo, não preliminar, e vínculo inequívoco com o caderno.
- Cobertura de 100% dos números do caderno, considerando anuladas e retificadas.
- Alternativas sequenciais, enunciado completo e sem dependência não capturada de imagens/tabelas/textos.
- SHA-256 e fingerprint para rastrear origem e impedir duplicatas.
- Questões incompletas, anuladas, ambíguas ou dependentes de OCR/elementos visuais ficam em quarentena.

## Importação manual de PDF

O utilitário `scripts/import-official-exam-pdf.mjs` também aceita um PDF local e gera um manifesto JSON. Ele não grava no Supabase. O painel administrativo recebe o manifesto e coloca os itens na fila privada, mantendo a conferência humana antes da publicação.

## Escopo

O EditalRadar armazena seus próprios registros e gabaritos. Não importa comentários, resoluções, índices, taxonomias ou a organização de dados de Qconcursos, Gran, PCI ou outros agregadores. As explicações aos estudantes serão produzidas e revisadas pelo próprio EditalRadar.
