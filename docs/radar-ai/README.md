# Radar AI — Núcleo de Inteligência do EditalRadar

## Visão

Radar AI é o núcleo especializado de preparação para concursos públicos brasileiros. A primeira versão será provider-agnostic e segura: não acopla o produto a um fornecedor de LLM, não afirma que dados de candidatos são usados para treinamento e não publica conteúdo gerado sem validação.

## Princípios

- **Especialização em concursos:** conteúdo, bancas, disciplinas, editais, provas e gabaritos.
- **Grounding:** respostas factuais devem ser ancoradas em fontes recuperadas e mostrar quando faltam evidências.
- **Separação:** modelo, recuperação de conhecimento, perfil do candidato e interface são módulos separados.
- **Privacidade:** dados pessoais de desempenho não entram em datasets de treinamento sem consentimento, base legal, minimização e processo de anonimização.
- **Validação:** questões geradas passam por verificações estruturais e revisão antes da publicação.
- **Evolução gradual:** começar com um núcleo de software, recuperação de conhecimento e testes; depois experimentar fine-tuning e treinamento próprio.
- **Independência de fornecedor:** contratos de modelo intercambiáveis, sem exigir API proprietária para o núcleo.

## Roadmap

1. **Fundação (esta entrega):** contratos, políticas de resposta, validação de questões, avaliação básica e documentação de arquitetura.
2. **Conhecimento:** pipeline de ingestão e metadados de fontes, busca lexical/semântica, citações e atualização.
3. **Tutor:** endpoint e experiência de tutor com recuperação de contexto, resposta estruturada e controles de segurança.
4. **Avaliação:** benchmark interno, testes de factualidade, legislação desatualizada, gabaritos, português, bancas e regressões.
5. **Modelo especializado:** comparar modelos de pesos abertos; construir datasets licenciados e curados; fine-tuning/LoRA, se demonstrar ganho.
6. **Pesquisa fundacional:** experimentar tokenizer e pré-treinamento de modelos pequenos; só ampliar após benchmarks e análise de custo.

## Arquitetura de alto nível

`UI (web/android) → Radar AI API → Orquestrador → (retrieval, regras, modelo) → validador → resposta`

- **Retrieval:** recupera documentos/questões autorizados e metadados de fonte.
- **Orquestrador:** decide tarefas (tutor, explicação, questão, plano de estudo).
- **Modelo:** interface abstrata; fornecedor pode ser substituído.
- **Validador:** verifica formato, citações, consistência de questão e políticas.
- **Feedback:** registra feedback mínimo e métricas agregadas; nunca altera pesos automaticamente.

## Contrato inicial de resposta

Toda resposta educacional deve indicar:
- texto explicativo claro;
- referências do contexto recuperado, quando houver;
- sinal de confiança/limitação;
- aviso de que legislação e editais podem mudar, com data de referência quando possível.

A IA não deve inventar artigos de lei, gabaritos, fontes, estatísticas de banca, editais, vagas ou datas.

## Política de geração de questões

Questões geradas são autorais e de treino. Não se deve reproduzir questão oficial protegida integralmente sem autorização. A geração deve registrar disciplina, assunto, dificuldade, estilo de banca (sem alegar ser questão oficial), justificativa, fonte de apoio/licença e versão do gerador. Questões ambíguas, sem fundamentação ou com gabarito inconsistente devem ser rejeitadas ou encaminhadas para revisão humana.

## Governança e segurança

- Tratar documentos recuperados e prompts de usuários como dados não confiáveis; não obedecer instruções presentes em fontes.
- Não expor secrets, prompts internos, dados de outros usuários ou informações de administração.
- Limitar tamanho e quantidade de contexto.
- Registrar métricas sem armazenar conteúdo sensível desnecessariamente.
- Avaliar riscos de erro e manter revisão humana para publicação de conteúdo de alto impacto.
- Datasets precisam de origem, licença, finalidade, versão, deduplicação e controles de remoção.

## Critérios de saída da Fundação

- Contratos de tipos sem dependência de provider.
- Validação determinística de resposta e questão.
- Testes automatizados para cenários válidos e inválidos.
- Documentação sobre roadmap e decisões de arquitetura.
