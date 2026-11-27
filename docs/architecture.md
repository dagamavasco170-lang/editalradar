# Arquitetura do EditalRadar

## Direção

Manter React + Vite no cliente, Supabase/PostgreSQL como backend e TypeScript como linguagem padrão para código novo e módulos migrados. A migração será incremental: arquivos JavaScript existentes continuam funcionando até serem convertidos e validados.

## Camadas-alvo

- `src/app`: composição da aplicação, rotas, providers e limites de erro.
- `src/features`: funcionalidades organizadas por domínio (concursos, questões, estudos, simulados, desempenho, conta).
- `src/components`: componentes compartilhados e primitivas de interface.
- `src/hooks`: hooks reutilizáveis e estado de interface.
- `src/lib`: utilitários puros e adaptadores técnicos.
- `src/services`: integração com Supabase e serviços externos.
- `src/types`: contratos compartilhados entre funcionalidades e serviços.
- `src/data`: dados estáticos e catálogos versionados.

Não mover módulos grandes apenas por estética. Cada extração deve preservar contratos públicos e vir acompanhada de testes.

## Regras de dependência

1. Componentes de interface não executam SQL nem conhecem detalhes de persistência.
2. Funcionalidades dependem de serviços/hooks, não umas das outras por caminhos internos.
3. Regras de negócio puras ficam em módulos sem dependência de React ou Supabase.
4. Tipos compartilhados não importam componentes, serviços ou módulos de tela.
5. Dados externos e conteúdo persistido são validados na fronteira; tipos estáticos não substituem validação em runtime.
6. Segredos de servidor nunca entram no bundle cliente; o cliente usa somente chave publishable/anon com RLS.

## Estratégia de migração

1. Configurar compilador e contratos de domínio.
2. Tipar adaptadores Supabase, modelos de questões, tentativas e persistência.
3. Migrar utilitários puros com testes existentes.
4. Extrair hooks e serviços de `App.jsx` e `StudyArea.jsx` em incrementos pequenos.
5. Tipar componentes e telas por funcionalidade.
6. Aumentar gradualmente a cobertura estrita até eliminar JavaScript de produção.

## Validação obrigatória

Cada pacote deve executar testes Vitest, typecheck, build Vite, E2E Playwright e CodeQL aplicáveis. Alterações de schema exigem migration revisada e validação separada; esta etapa não altera banco, RLS, Auth, secrets ou produção.
