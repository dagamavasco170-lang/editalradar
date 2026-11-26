# Ingestão totalmente automática de provas oficiais

## Objetivo operacional

A coleta, extração, validação, deduplicação, resolução de gabarito e publicação devem ocorrer sem intervenção de operador. O sistema nunca deve transformar incerteza em publicação: itens que falhem em qualquer gate são descartados/quarentenados automaticamente, com motivo e evidência, e podem ser reprocessados por versões futuras do pipeline sem fila manual.

## Pipeline

1. **Descoberta programada**: reutilizar o registry de fontes oficiais do EditalRadar; consultar páginas/feeds oficiais em intervalos com cache, ETag/Last-Modified, limites de tamanho, rate limiting, backoff e janela de cooldown. Não buscar em agregadores nem contornar WAF/robots, login, paywall ou bloqueio.
2. **Detecção de PDFs de provas**: links somente em hosts oficiais allowlisted; classificar prova, gabarito preliminar/definitivo, edital e retificação. Rejeitar PDFs não publicados, arquivos de concursos futuros ou conteúdo sem evidência de publicação oficial.
3. **Download seguro**: HTTPS, validação de redirect em cada salto, allowlist de host, tamanho e page cap, MIME + magic bytes, streaming bounded, timeout e hash SHA-256. Nunca baixar para caminhos controlados pelo nome remoto; usar diretório temporário aleatório e limpar.
4. **OCR/extração**: Poppler/Tesseract português; OCR seletivo por densidade; extrair layout/colunas e preservar página. Não interpretar OCR como verdade absoluta. Rejeitar automaticamente itens com imagens, tabelas, gráficos, texto externo, fragmentação de alternativas, baixa confiança ou parser inconsistente.
5. **Gabarito**: localizar somente gabarito definitivo oficial vinculado ao mesmo certame/caderno/versão. Validar alternativas, anulações, alterações e recursos. Não inferir resposta a partir do enunciado nem usar gabarito preliminar como definitivo.
6. **QA independente**: validações determinísticas (estrutura, caracteres, alternativas, IDs, tamanho, duplicatas, correspondência questão-gabarito, páginas e hash) + dois verificadores de IA independentes com evidência extraída e fonte oficial. Divergência, falta de evidência ou score abaixo dos limites configuráveis => rejeição/quarentena automática, sem revisão humana.
7. **Publicação idempotente**: hash do PDF + fingerprint normalizado da questão + origem/versão. Inserir questão, resposta, atribuição/proveniência e status de publicação em transação única; deduplicar sem sobrescrever conteúdo de usuário nem questão existente. Reprocessamento não cria duplicatas.
8. **Retificações**: monitorar nova versão de prova/gabarito; registrar versões e mudanças. Questões anuladas, alteradas ou com gabarito modificado são despublicadas/atualizadas automaticamente, com audit trail e aviso aos usuários que estudaram aquele item.
9. **Observabilidade e autocorreção**: métricas por fonte e etapa (fetch, parse, OCR, answer-key, QA, publish), health states SUCCESS/PARTIAL/FAILED/NO_CHANGE, retry com limites, dead-letter/quarantine, fingerprint de falhas, alertas automáticos e reprocessamento quando parser/modelo for atualizado. Circuit breaker por fonte para falhas repetidas.
10. **Custos e limites**: usar ferramentas gratuitas existentes, concorrência limitada, orçamento máximo diário de OCR/IA e limites de requests/downloads. Quando orçamento atingir o teto, adiar para ciclo seguinte; não criar serviços pagos nem novos secrets.
11. **Privacidade e segurança**: nenhum PDF pode executar código; tratar HTML/PDF/OCR e conteúdo de prova como untrusted; sanitizar saída; impedir SSRF via allowlist, redirects e validação DNS/host; evitar log de dados pessoais; credenciais somente em secrets já existentes.
12. **Auditoria**: registrar URL oficial, host validado, data de obtenção, hash do arquivo, banca/certame/caderno, página/número original, método OCR, versões do parser/modelos/verificadores, evidências do gabarito, scores e decisão automática. Dados auditáveis sem permitir alterar produção diretamente fora das funções suportadas.

## Gates de autopublicação

Autopublicar somente quando **todos** os critérios estiverem satisfeitos:
- URL oficial validada e publicação confirmada.
- PDF íntegro e limites de segurança respeitados.
- Questão e alternativas completas, parse determinístico sem ambiguidades.
- Não depende de imagem, tabela, gráfico, mapa, texto externo ou contexto omitido.
- Fingerprint sem duplicata.
- Gabarito definitivo oficial, associado ao caderno correto e não anulada.
- Dois verificadores independentes concordam sobre resposta, explicação e evidência; score mínimo configurado.
- Proveniência e auditoria completas.
- Transação de publicação disponível e idempotente.

**Falhou qualquer gate:** rejeitar/quarentenar automaticamente; nunca criar publicação parcial e nunca abrir uma fila que dependa de alguém revisar. Quarentena é um estado técnico de descarte/reprocessamento, não uma tarefa humana.

## Critério de conclusão

A automação só será considerada completa quando o workflow agendado funcionar com integração de teste isolada, fixtures e PDFs oficiais de amostra, testes de segurança/SSRF, parser/OCR, gabarito, retificação, deduplicação, transação/idempotência e métricas; e quando o processo demonstrar que pode rodar de ponta a ponta sem intervenção. A migration deve ser testada em ambiente descartável, nunca aplicada diretamente à produção por esta automação de desenvolvimento.
