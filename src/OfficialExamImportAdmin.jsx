import React,{useEffect,useState} from "react";

const runStatus=value=>({
 completed:"Concluída",
 partial:"Parcial",
 failed:"Falhou",
 running:"Em execução"
}[value]||value||"Sem histórico");
const importStatus=value=>({
 published:"Publicada automaticamente",
 pending:"Aguardando nova tentativa automática",
 rejected:"Rejeitada automaticamente",
 duplicate:"Duplicada"
}[value]||value||"—");
const dateLabel=value=>value?new Date(value).toLocaleString("pt-BR"):"—";
const numberLabel=value=>Number(value||0).toLocaleString("pt-BR");

export default function OfficialExamImportAdmin({authClient,userId}){
 const [runs,setRuns]=useState([]);
 const [imports,setImports]=useState([]);
 const [loading,setLoading]=useState(false);
 const [available,setAvailable]=useState(true);
 const [message,setMessage]=useState("");

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
    setAvailable(true);
    setMessage("");
   }catch(error){
    if(cancelled)return;
    const missing=/study_exam_import_runs|study_exam_question_imports|schema cache|does not exist|could not find the table/i.test(String(error?.message||""));
    setAvailable(!missing);
    setMessage(missing
     ?"O mecanismo automático está no código, mas as tabelas da migration ainda não estão disponíveis no banco."
     :(error?.message||"Não foi possível consultar o estado da ingestão automática."));
   }finally{
    if(!cancelled)setLoading(false);
   }
  };
  void load();
  return()=>{cancelled=true;};
 },[authClient,userId]);

 const latest=runs[0]||null;
 const published=imports.filter(item=>item.status==="published");
 const pending=imports.filter(item=>item.status==="pending");
 const rejected=imports.filter(item=>item.status==="rejected");
 return <section className="panel admin-panel official-exam-import-admin" aria-label="Monitoramento automático de questões oficiais">
  <div className="admin-panel-heading">
   <div><strong>Importação automática de provas oficiais</strong><small>Descoberta, download, OCR, leitura do gabarito definitivo, validação, deduplicação e publicação executados pelo pipeline agendado. Nenhuma aprovação humana é necessária.</small></div>
   <span className="discovery-status-pill">Automático · 6 em 6 horas</span>
  </div>
  <div className="question-ai-how">
   <strong>Critérios de publicação autônoma</strong>
   <p>O sistema só publica quando prova e gabarito definitivo vêm de hosts oficiais permitidos, o documento tem integridade SHA-256, a questão tem alternativas estruturadas, não depende de imagem/texto externo, o gabarito corresponde a uma opção, não há duplicata e não é detectada restrição expressa de reutilização. O limiar é 98/100. Casos ambíguos são descartados ou tentados novamente automaticamente.</p>
  </div>
  {!available&&<p className="auth-message error" role="status">{message}</p>}
  {available&&<div className="question-ai-summary">
   <div><strong>{numberLabel(latest?.sources_scanned)}</strong><span>fontes verificadas na última execução</span></div>
   <div><strong>{numberLabel(latest?.pdf_pairs_found)}</strong><span>pares prova + gabarito encontrados</span></div>
   <div><strong>{numberLabel(latest?.questions_published)}</strong><span>questões publicadas na última execução</span></div>
   <div><strong>{numberLabel(latest?.questions_retried)}</strong><span>itens recuperados de tentativas anteriores</span></div>
  </div>}
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
   <div className="question-ai-subheading"><strong>Registros processados recentemente</strong><span>{numberLabel(published.length)} publicadas · {numberLabel(pending.length)} em retry · {numberLabel(rejected.length)} rejeitadas</span></div>
   {imports.slice(0,8).map(item=><article className="question-ai-topic" key={item.id}>
    <div>
     <strong>{item.board} · {item.exam_name} · {item.exam_year}</strong>
     <small>Questão {item.source_question_number} · nota automática {item.auto_quality_score??"—"}/100 · tentativas {item.auto_publish_attempts??0}/3</small>
    </div>
    <span className="soft-pill">{importStatus(item.status)}</span>
   </article>)}
  </div>}
  {!runs.length&&!loading&&available&&<p className="muted">A rotina será iniciada pelo agendamento automático após a ativação da migration e do workflow.</p>}
  {message&&available&&<p className="auth-message error" role="status">{message}</p>}
  <p className="study-disclaimer">A automação não contorna bloqueios, CAPTCHA ou restrições técnicas. Fontes indisponíveis e provas sem gabarito definitivo continuam sendo tentadas nos próximos ciclos; questões que falham três publicações consecutivas são encerradas automaticamente. O PCI, Gran e Qconcursos não são usados como fontes de download.</p>
 </section>;
}
