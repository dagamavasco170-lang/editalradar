# Dicionário pt-BR para validação de questões

Fonte: [fserb/pt-br](https://github.com/fserb/pt-br), snapshot fixado no commit
`93ba2a6f3b2f85262fba72df09d448c6bb2fa50a` (8 de agosto de 2025).

Conteúdo incorporado:
- Léxico: 145.744 entradas.
- Conjugações: 195.751 formas verbais.
- Stopwords e regras conservadoras de plural/gênero para reconhecer flexões usuais.
- Vocabulário complementar revisado para termos jurídicos recorrentes ausentes do léxico geral (`pt-br-domain-terms.txt`).
- O vocabulário é dividido em arquivos numerados; o validador carrega todos os fragmentos.

Uso:
1. Verificar se cada token é uma palavra reconhecida no português brasileiro.
2. Para tokens longos desconhecidos, procurar segmentações completas compostas por palavras do léxico e conferir flexões regulares pela forma-base (ex.: examinadora → examinador; suficientemente → suficiente; longitudinalidades → longitudinalidade).
3. Marcar a questão para revisão quando houver indício de palavras concatenadas.
4. Nunca corrigir automaticamente um enunciado só com base em uma divisão possível: o contexto e a fonte original devem confirmar a redação.

O léxico é apoio de validação, não um corretor ortográfico infalível. Nomes próprios, siglas e termos técnicos podem não constar do dicionário e devem ser avaliados pelo contexto.

Licença do conjunto de dados: MIT. O aviso integral está em `LICENSE.pt-br`.
