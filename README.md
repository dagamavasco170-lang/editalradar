# EditalRadar

Plataforma web para acompanhar autorizações oficiais de concursos públicos e organizar a preparação.

## Integração oficial implementada

O site sincroniza a planilha de **Autorizações e Provimentos** do Ministério da Gestão e da Inovação em Serviços Públicos (MGI).

1. Consulta a página oficial do MGI e localiza a planilha XLSX de 2026.
2. Baixa e lê a planilha no GitHub Actions.
3. Importa as linhas classificadas como **Concurso Público**.
4. Gera os dados usados na compilação.
5. Compila e publica o site no GitHub Pages.

A sincronização está agendada diariamente às 09:00 UTC, além de cada push e execução manual.

Fonte oficial: https://www.gov.br/gestao/pt-br/acesso-a-informacao/servidores/concursos-publicos/autorizacoes-e-provimentos

## Importante sobre os dados

A planilha do MGI informa autorizações de concursos do Poder Executivo Federal. **Autorização não significa edital publicado nem inscrições abertas.** Ela não é uma lista nacional completa: concursos estaduais, municipais, de outros Poderes e de empresas públicas podem não estar incluídos.

## Funcionalidades

- Busca por cargo, órgão e vínculo.
- Filtro por escolaridade.
- Detalhes da autorização e link para a fonte oficial.
- Favoritos salvos no navegador.
- Área de estudos com checklist e questão demonstrativa.

## Desenvolvimento

Requisitos: Node.js 22+ e npm.

```bash
npm install
npm run sync:mgi
npm run dev
```

Compilar: `npm run build`.

O workflow **Sync, build and deploy EditalRadar** sincroniza os dados oficiais, compila e publica o site automaticamente.
