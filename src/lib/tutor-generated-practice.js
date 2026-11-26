export function buildGeneratedPractice({question={},explanation=""}={}){
 const topic=String(question.topic||question.discipline||"assunto").trim()||"assunto";
 const concept=String(explanation||question.explanation||"").trim();
 const prompt=concept
  ? "Sem copiar a explicação, crie um exemplo próprio de situação em que o conceito de "+topic+" se aplica. Explique qual regra você usaria e por que ela resolve o caso."
  : "Consulte seu material oficial sobre "+topic+". Em seguida, crie um exemplo próprio desse conceito e explique a regra que o sustenta. Não invente uma regra se não tiver certeza.";
 return {topic,prompt,source:concept?"conceito vinculado à explicação cadastrada":"tema da questão; requer consulta ao material oficial",reference:concept};
}
export function evaluateGeneratedReasoning({text=""}={}){
 const response=String(text||"").trim();
 const words=response.split(/\\s+/).filter(Boolean);
 const hasReasoning=/\\b(porque|pois|portanto|assim|logo|regra|conceito|aplica|significa|quando|se)\\b/i.test(response);
 const complete=words.length>=25&&hasReasoning;
 return {wordCount:words.length,hasReasoning,complete,feedback:complete
  ?"Sua resposta apresenta extensão e uma justificativa explícita. Esta checagem avalia a estrutura, não a correção semântica; compare o conteúdo com a fonte oficial."
  :words.length<25
   ?"Desenvolva a explicação: descreva a regra e um exemplo, com pelo menos 25 palavras."
   :"Inclua a relação entre a regra e o exemplo, explicando por que ou como ela se aplica."};
}
