const stopWords=new Set(["para","como","quando","onde","porque","qual","que","uma","um","uns","umas","com","sem","por","sobre","entre","mais","menos","são","ser","seu","sua","isso","essa","este","esta","dos","das","de","do","da","em","no","na","os","as","ao","aos","às","ou","e","é","s","o","a"]);
function extractConceptTerms(reference){
 return [...new Set(String(reference||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().match(/[a-z]{4,}/g)||[])].filter(term=>!stopWords.has(term)).slice(0,8);
}
export function buildGeneratedPractice({question={},explanation=""}={}){
 const topic=String(question.topic||question.discipline||"assunto").trim()||"assunto";
 const concept=String(explanation||question.explanation||"").trim();
 const terms=extractConceptTerms(concept);
 const prompt=concept
  ? "Crie um exemplo próprio em que o conceito de "+topic+" se aplica. Use pelo menos alguns dos elementos essenciais do conceito e explique por que a regra resolve o caso."
  : "Consulte seu material oficial sobre "+topic+". Crie um exemplo próprio e explique a regra que o sustenta. Não invente uma regra se não tiver certeza.";
 return {topic,prompt,source:concept?"conceito vinculado à explicação cadastrada":"tema da questão; requer consulta ao material oficial",reference:concept,criteria:terms};
}
export function evaluateGeneratedReasoning({text="",reference="",criteria=[]}={}){
 const response=String(text||"").trim();
 const normalized=response.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const words=normalized.match(/[a-z0-9]+/g)||[];
 const terms=criteria.length?criteria:extractConceptTerms(reference);
 const matched=terms.filter(term=>normalized.includes(term));
 const coverage=terms.length?Math.round(matched.length/terms.length*100):null;
 const hasReasoning=/\b(porque|pois|portanto|assim|logo|regra|conceito|aplica|significa|quando|se)\b/i.test(normalized);
 const complete=words.length>=25&&hasReasoning&&(coverage===null||coverage>=25);
 const score=coverage===null?null:Math.round(coverage*.7+(hasReasoning?20:0)+(words.length>=25?10:0));
 return {wordCount:words.length,hasReasoning,criteria:terms,matched,coverage,score,complete,feedback:coverage===null
  ?"Não há explicação-base para comparar termos. Use esta checagem apenas como apoio e confira a resposta na fonte oficial."
  :complete
   ?"A resposta tem justificativa e menciona "+matched.length+" de "+terms.length+" termos-chave da referência. A pontuação é aproximada, não uma correção semântica."
   :words.length<25
    ?"Desenvolva mais: explique a regra e dê um exemplo próprio (mínimo de 25 palavras)."
    :coverage<25
     ?"A resposta ainda não menciona termos essenciais identificados na referência. Revise o material e complete sua explicação."
     :"Relacione explicitamente a regra ao exemplo usando uma justificativa."};
}
export function updateConceptMastery(previous=0,evaluation={}){
 const score=Number.isFinite(evaluation.score)?evaluation.score:0;
 const next=Math.round(Math.max(0,Math.min(100,Number(previous||0)*.65+score*.35)));
 return next;
}

export function conceptMasteryStorageKey(userId){
 return "er-concept-mastery:"+(userId||"visitor");
}
export function loadConceptMastery(userId,storage=globalThis.localStorage){
 try{
  const value=JSON.parse(storage?.getItem(conceptMasteryStorageKey(userId))||"{}");
  return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
 }catch{return {};}
}
export function saveConceptMastery(userId,value,storage=globalThis.localStorage){
 try{storage?.setItem(conceptMasteryStorageKey(userId),JSON.stringify(value));return true;}
 catch{return false;}
}

export function mergeConceptMastery(cloudValue={},localValue={}){
 const cloud=cloudValue&&typeof cloudValue==="object"&&!Array.isArray(cloudValue)?cloudValue:{};
 const local=localValue&&typeof localValue==="object"&&!Array.isArray(localValue)?localValue:{};
 const merged={...cloud};
 for(const [topic,value] of Object.entries(local)){
  const localScore=Number(value),cloudScore=Number(merged[topic]);
  if(Number.isFinite(localScore))merged[topic]=Number.isFinite(cloudScore)?Math.max(localScore,cloudScore):localScore;
 }
 return merged;
}
