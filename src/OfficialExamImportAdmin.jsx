import React,{useEffect,useState} from "react";

const runStatus=value=>({completed:"Concluída",partial:"Parcial",failed:"Falhou",running:"Em execução"}[value]||value||"Sem histórico");
const importStatus=value=>({published:"Publicada automaticamente",pending:"Nova tentativa automática pendente",rejected:"Rejeitada automaticamente",duplicate:"Duplicada"}[value]||value||"—");
const dateLabel=value=>value?new Date(value).toLocaleString("pt-BR"):"—";
const numberLabel=value=>Number(value||0).toLocaleString("pt-BR");

export default function OfficialExamImportAdmin({authClient,userId}){
 const [runs,setRuns]=useState([]);
 const [imports,setImports]=useState([]);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!authClient||!userId)return undefined;
  let cancelled=false;
  const load=async()=>{
   setLoading(true);
   try{
    const [runResult,importResult]=await Promise.all([
     authClient.from("study_exam_import_runs")
      .select("id,status,sources_scanned,pages_scanned,pdf_pairs_found,pdfs_downloaded,questions_extracted,questions_published,questions_retried,questions_skipped,errors_count,started_at,completed_at")
      .order("started_at",{ascending:false}).limit(8),
     authClient.from("study_exam_question_imports")
      .select("id,board,exam_name,exam_year,source_question_number,status,review_method,auto_quality_score,auto_publish_attempts,created_at,reviewed_at")
      .order("created_at",{ascending:false}).limit(12)
    ]);
    if(runResult.error)throw runResult.error;
    if(importResult.error)throw importResult.error;
    if(cancelled)return;
    setRuns(runResult.data||[]);
    setImports(importResult.data||[]);
    setError("");
   }catch(caught){
    if(!cancelled)setError(caught?.message||"Não foi possível carregar as métricas da importação.");
   }finally{
    if(!cancelled)setLoading(false);
   }
  };
  void load();
  return()=>{cancelled=true;};
 },[authClient,userId]);

 const latest=runs[0]||null;
 const published=imports.filter(item=>item.status==="published").length;
 const pending=imports.filter(item=>item.status==="pending").length;
 const rejected=imports.filter(item=>item.status==="rejected").length;
 const duplicates=imports.filter(item=>item.status==="duplicate").length;

 return <section className="panel admin-panel official-exam-import-admin" aria-label="Monitoramento automático de questões oficiais">
  <div className="admin-panel-heading">
   <div><strong>Importação automática de provas oficiais</strong><small>Descoberta, download, OCR, leitura do gabarito definitivo, validação, deduplicação e publicação pelo pipeline agendado, sem aprovação humana por questão.</small></div>
   <span className="discovery-status-pill">Automático · 6 em 6 horas</span>
  </div>
  <div className="question-ai-how">
   <strong>Regras de publicação</strong>
   <p>O worker só publica quando prova e gabarito definitivo vêm de hosts oficiais permitidos, ambos têm integridade SHA-256, a questão é estruturalmente válida, autônoma, sem dependência de imagens ou textos externos, tem resposta correspondente, não é duplicada e não há restrição expressa detectada. A nota mínima é 98/100. Casos ambíguos são descartados ou recuperados automaticamente.</p>
  </div>
  {error&&<p className="auth-message error" role="status">{error}</p>}
  <div className="question-ai-summary">
   <div><strong>{numberLabel(latest?.sources_scanned)}</strong><span>fontes verificadas na última execução</span></div>
   <div><strong>{numberLabel(latest?.pdf_pairs_found)}</strong><span>pares prova + gabarito encontrados</span></div>
   <div><strong>{numberLabel(latest?.questions_published)}</strong><span>questões publicadas na última execução</span></div>
   <div><strong>{numberLabel(latest?.questions_retried)}</strong><span>tentativas recuperadas</span></div>
  </div>
  {latest&&<div className="question-ai-runs">
   <strong>Última execução · {runStatus(latest.status)}</strong>
   <small>Início: {dateLabel(latest.started_at)} · conclusão: {dateLabel(latest.completed_at)}</small>
   <small>{numberLabel(latest.pages_scanned)} páginas consultadas · {numberLabel(latest.pdfs_downloaded)} PDFs baixados · {numberLabel(latest.questions_extracted)} questões extraídas · {numberLabel(latest.questions_skipped)} descartadas · {numberLabel(latest.errors_count)} falhas técnicas</small>
  </div>}
  {runs.length>1&&<div className="question-ai-runs">
   <strong>Histórico recente</strong>
   {runs.slice(1,6).map(run=><div key={run.id}>
    <span>{dateLabel(run.started_at)} · {runStatus(run.status)}</span>
    <small>{numberLabel(run.questions_published)} publicadas · {numberLabel(run.questions_skipped)} descartadas · {numberLabel(run.errors_count)} falhas</small>
   </div>)}
  </div>}
  {imports.length>0&&<div className="question-ai-topics">
   <div className="question-ai-subheading"><strong>Itens processados recentemente</strong><span>{numberLabel(published)} publicadas · {numberLabel(pending)} em retry · {numberLabel(rejected)} rejeitadas · {numberLabel(duplicates)} duplicadas</span></div>
   {imports.slice(0,8).map(item=><article className="question-ai-topic" key={item.id}>
    <div><strong>{item.board} · {item.exam_name} · {item.exam_year}</strong>
     <small>Questão {item.source_question_number} · score {item.auto_quality_score??"—"}/100 · tentativas {item.auto_publish_attempts??0}/3</small>
    </div>
    <span className="soft-pill">{importStatus(item.status)}</span>
   </article>)}
  </div>}
  {!runs.length&&!loading&&!error&&<p className="muted">A rotina será iniciada pelo agendamento quando a migration e o workflow forem ativados.</p>}
  <p className="study-disclaimer">Esta área é somente de monitoramento: não existem controles de upload, aprovação ou rejeição. O sistema não contorna CAPTCHA, WAF ou bloqueios; fontes inacessíveis e questões ambíguas são adiadas ou descartadas. PCI, Gran e Qconcursos não são usados para baixar arquivos.</p>
 </section>;
}
