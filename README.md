# EditalRadar

Plataforma web para descobrir oportunidades de concursos públicos e organizar a preparação.

## Funcionalidades do MVP

- Catálogo de concursos com pesquisa por cargo, órgão ou estado.
- Filtros por área, estado e escolaridade.
- Detalhes das oportunidades.
- Favoritos guardados no navegador.
- Área de estudos com checklist e progresso diário.
- Questão demonstrativa com correção.
- Layout adaptável a computador e celular.

## Executar localmente

Requisitos: Node.js 18+ e npm.

```bash
npm install
npm run dev
```

Compilar para produção:

```bash
npm run build
npm run preview
```

## Compilação no GitHub

O workflow **Build EditalRadar** é executado automaticamente a cada push ou pull request na branch `main`. O arquivo compilado fica disponível em **Actions → Build EditalRadar → Artifacts**, com o nome `editalradar-dist`.

## Importante

Os concursos, órgãos, salários, vagas, status e localidades exibidos nesta versão são dados fictícios para demonstração da interface. Ainda não há integração com editais oficiais, inscrições, autenticação ou banco de dados. Antes de lançar publicamente, será necessário integrar fontes oficiais e validar as informações.

## Próximas etapas sugeridas

1. API e banco de dados para oportunidades e usuários.
2. Integração com fontes oficiais e links de editais.
3. Cadastro e login com favoritos sincronizados.
4. Painel administrativo para publicar e revisar concursos.
5. Banco de questões, simulados e relatórios de desempenho.
