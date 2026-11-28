# Radar AI — Ingestão inicial de conhecimento

## Escopo
A pipeline v0.2 recebe texto fornecido por um processo autorizado, valida o cadastro e a procedência da fonte, normaliza o conteúdo, gera chunks com metadados e deduplica por ID. Ela não busca URLs, não extrai PDF e não chama modelos ou serviços externos.

## Registro de fonte
Cada fonte deve ter ID, título, URL HTTPS, licença/termos, atribuição, categoria de origem e confirmação explícita de verificação de licença/permissão. Categorias aceitas: official-law, official-exam, official-notice, licensed, public-domain, authorized. A marcação não substitui análise jurídica; registrar apenas conteúdo cuja reutilização esteja autorizada.

## Uso
- Registre a fonte via `registerKnowledgeSource`.
- Passe o texto já obtido legalmente para `ingestKnowledgeText`, junto com disciplina/tópico e metadados de recuperação.
- O retorno inclui chunks, erros e contagens.
- Use `mergeKnowledgeChunks` para consolidar lotes e eliminar IDs duplicados.

## Próximas evoluções
1. Extratores de PDF/HTML com limites e validação de origem.
2. Persistência versionada no Supabase com migrations e política de acesso.
3. Embeddings e busca vetorial híbrida (lexical + semântica).
4. Benchmark RAG e gate de qualidade na CI.

## Segurança e limites
- Não buscar nem ingerir fontes automaticamente nesta etapa.
- Não presumir que conteúdo público tem licença de reutilização.
- Não ingerir dados pessoais, tokens ou conteúdo sem proveniência.
- Chunks preservam IDs e metadados da fonte para rastreabilidade.
