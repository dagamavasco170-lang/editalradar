import React,{useCallback,useEffect,useState} from "react";
import { isTrustedOfficialUrl } from "./lib/official-sources.js";

const RIGHTS_TO_LICENSE={
 official_publication:"official_publication",
 public_domain:"public_domain",
 permission_granted:"permission_granted",
 cc_by:"cc_by",
 cc_by_sa:"cc_by_sa"
};
const rightsLabel=value=>({
 official_publication:"Prova oficial divulgada",
 public_domain:"Domínio público",
 permission_granted:"Autorização expressa",
 cc_by:"CC BY",
 cc_by_sa:"CC BY-SA",
 other_reviewed:"Outro fundamento revisado"
}[value]||value||"Não informado");
const isHttps=value=>{
 try{const url=new URL(String(value||""));return url.protocol==="https:"&&!url.username&&!url.password;}
 catch{return false;}
};

export default function OfficialExamImportAdmin({authClient,userId}){
 const [rows,setRows]=useState([]);
 const [answers,setAnswers]=useState({});
 const [notes,setNotes]=useState({});
 const [explanations,setExplanations]=useState({});
 const [confirmed,setConfirmed]=useState({});
 const [loading,setLoading]=useState(false);
 const [busyId,setBusyId]=useState("");
 const [uploadBusy,setUploadBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [kind,setKind]=useState("info");
 const [tableReady,setTableReady]=useState(true);

 const refresh=useCallback(async()=>{
  if(!authClient||!userId)return;
  setLoading(true);
  try{
   const {data,error}=await authClient.from("study_exam_question_imports")
    .select("id,board,exam_name,exam_year,discipline,topic,difficulty,question_format,role_name,source_url,exam_pdf_url,source_document_sha256,source_page,source_question_number,prompt,options,suggested_answer,fingerprint,rights_basis,official_release_verified,rights_holder,license_proof_url,source_terms_url,source_restrictions,source_license,source_attribution,rights_review_status,status,review_notes,created_at")
    .eq("status","pending").order("created_at",{ascending:false}).limit(100);
   if(error)throw error;
   setRows(data||[]);setTableReady(true);
  }catch(error){
   const missing=/study_exam_question_imports|schema cache|does not exist|could not find the table/i.test(String(error?.message||""));
   setTableReady(!missing);
   setMessage(missing?"A estrutura de importação ainda não está disponível. Aplique a migration desta funcionalidade antes de usar a fila.":(error?.message||"Não foi possível carregar a fila de importação."));
   setKind("error");
  }finally{setLoading(false);}
 },[authClient,userId]);

 useEffect(()=>{void refresh();},[refresh]);

 const uploadManifest=async event=>{
  const file=event.target.files?.[0];
  event.target.value="";
  if(!file)return;
  setMessage("");setKind("info");
  if(!authClient||!userId){setMessage("Entre com uma conta administrativa.");setKind("error");return;}
  setUploadBusy(true);
  let inserted=0,duplicates=0;
  try{
   if(file.size>12*1024*1024)throw new Error("O manifesto excede o limite de 12 MB.");
   const manifest=JSON.parse(await file.text());
   if(manifest?.format!=="editalradar-exam-import-v1"||!Array.isArray(manifest.imports)||!manifest.imports.length){
    throw new Error("Arquivo inválido: selecione um manifesto gerado pelo importador do EditalRadar.");
   }
   if(manifest.imports.length>300)throw new Error("O manifesto excede o limite de 300 questões por envio.");
   const meta=manifest.metadata||{};
   const examYear=Number(meta.exam_year);
   const questionFormat=String(meta.question_format||"multiple_choice");
   if(!["multiple_choice","true_false"].includes(questionFormat))throw new Error("Formato de questão inválido no manifesto.");
   if(!meta.board||String(meta.board).trim().length<2||String(meta.board).length>80
     ||!meta.exam_name||String(meta.exam_name).trim().length<2||String(meta.exam_name).length>180
     ||!Number.isInteger(examYear)||examYear<1900||examYear>2200
     ||!meta.discipline||String(meta.discipline).trim().length<2||String(meta.discipline).length>100
     ||!isTrustedOfficialUrl(meta.source_url)||!isTrustedOfficialUrl(meta.exam_pdf_url)){
    throw new Error("O manifesto precisa conter banca, concurso, ano, disciplina válidos e URLs HTTPS em domínios oficiais permitidos.");
   }
   if(!/^[0-9a-f]{64}$/.test(String(manifest.source_document_sha256||""))){
    throw new Error("Hash SHA-256 do PDF ausente ou inválido.");
   }
   if(meta.rights_basis==="official_publication"&&meta.official_release_verified!==true){
    throw new Error("A publicação oficial precisa estar confirmada nos metadados.");
   }
   for(const item of manifest.imports){
    if(!item||typeof item.prompt!=="string"||item.prompt.trim().length<20||item.prompt.trim().length>5000
      ||!Array.isArray(item.options)||item.options.length<2||item.options.length>6){
     throw new Error("O manifesto contém enunciado ou alternativas fora do formato permitido; corrija o PDF ou refaça a extração.");
    }
    const normalizedOptions=item.options.map(option=>({
     id:String(option?.id||"").toLowerCase(),
     text:String(option?.text||"").trim()
    }));
    const optionIds=normalizedOptions.map(option=>option.id).join(",");
    const expectedIds=normalizedOptions.map((_,index)=>String.fromCharCode(97+index)).join(",");
    const validMultipleChoice=questionFormat==="multiple_choice"&&optionIds===expectedIds;
    const validTrueFalse=questionFormat==="true_false"&&optionIds==="c,e"
      &&normalizedOptions[0].text.toLocaleLowerCase("pt-BR")==="certo"
      &&normalizedOptions[1].text.toLocaleLowerCase("pt-BR")==="errado";
    if(normalizedOptions.some(option=>option.text.length<2)||(!validMultipleChoice&&!validTrueFalse)){
     throw new Error("Alternativas incompletas ou incompatíveis com o formato declarado no item "+(item.source_question_number||"?")+".");
    }
    if(!/^[0-9a-f]{64}$/.test(String(item.fingerprint||"")))throw new Error("Fingerprint inválido no item " +(item.source_question_number||"?")+".");
    if(!Number.isInteger(Number(item.source_page))||Number(item.source_page)<1||!Number.isInteger(Number(item.source_question_number))||Number(item.source_question_number)<1){
     throw new Error("Página ou número original inválido no manifesto.");
    }
    if(!["official_publication","public_domain","permission_granted","cc_by","cc_by_sa","other_reviewed"].includes(meta.rights_basis)){
     throw new Error("Fundamento de reutilização não reconhecido no manifesto.");
    }
    const row={
     board:String(meta.board).trim(),exam_name:String(meta.exam_name).trim(),exam_year:Number(meta.exam_year),
     discipline:String(meta.discipline).trim(),topic:String(meta.topic||"A classificar").trim(),
     difficulty:["Fácil","Intermediária","Avançada"].includes(meta.difficulty)?meta.difficulty:"Intermediária",
     question_format:questionFormat,
     role_name:String(meta.role_name||""),source_url:meta.source_url,exam_pdf_url:meta.exam_pdf_url,
     source_document_sha256:manifest.source_document_sha256,source_page:Number(item.source_page),
     source_question_number:Number(item.source_question_number),prompt:item.prompt.trim(),options:normalizedOptions,
     suggested_answer:null,fingerprint:item.fingerprint,rights_basis:meta.rights_basis,
     official_release_verified:meta.official_release_verified===true,rights_holder:meta.rights_holder||null,
     license_proof_url:isHttps(meta.license_proof_url)?meta.license_proof_url:null,
     source_terms_url:isHttps(meta.source_terms_url)?meta.source_terms_url:null,
     source_restrictions:String(meta.source_restrictions||"").slice(0,2000),
     source_license:meta.source_license||null,source_attribution:meta.source_attribution||null,
     rights_review_status:"not_reviewed",status:"pending",
     review_notes:[...(Array.isArray(manifest.warnings)?manifest.warnings:[]),String(item.review_notes||"")].join(" ").slice(0,4000),
     created_by:userId
    };
    const {error}=await authClient.from("study_exam_question_imports").insert(row);
    if(error?.code==="23505"){duplicates+=1;continue;}
    if(error)throw error;
    inserted+=1;
   }
   setMessage("Importação de rascunhos concluída: "+inserted+" questão(ões) na fila e "+duplicates+" duplicada(s) ignorada(s). Nada foi publicado.");
   setKind("success");await refresh();
  }catch(error){
   setMessage((error?.message||"Falha ao processar o manifesto.")+" "+(inserted?"Itens já inseridos e mantidos na fila: "+inserted+".":""));
   setKind("error");
  }finally{setUploadBusy(false);}
 };

 const publish=async question=>{
  const answer=answers[String(question.id)]||"";
  const optionIds=(Array.isArray(question.options)?question.options:[]).map(option=>String(option?.id||"").toLowerCase());
  const licenseStatus=RIGHTS_TO_LICENSE[question.rights_basis];
  if(!confirmed[String(question.id)]){setMessage("Confirme a revisão visual, a origem oficial e as restrições aplicáveis.");setKind("error");return;}
  if(!answer||!optionIds.includes(answer)){setMessage("Selecione o gabarito definitivo confirmado na publicação oficial.");setKind("error");return;}
  if(!licenseStatus){setMessage("O fundamento exige classificação jurídica adicional antes da publicação.");setKind("error");return;}
  if(question.rights_basis==="official_publication"&&!question.official_release_verified){setMessage("A publicação oficial não foi confirmada.");setKind("error");return;}
  if(["permission_granted","cc_by","cc_by_sa"].includes(question.rights_basis)&&!isHttps(question.license_proof_url)){setMessage("Esse fundamento exige comprovante HTTPS de licença/autorização.");setKind("error");return;}
  setBusyId(String(question.id));setMessage("");
  try{
   const {data,error}=await authClient.rpc("publish_study_exam_question_import",{
    p_import_id:question.id,
    p_answer:answer,
    p_explanation:String(explanations[String(question.id)]||"").slice(0,5000),
    p_review_notes:String(notes[String(question.id)]||"").slice(0,4000),
    p_admin_confirmation:true
   });
   if(error)throw error;
   setRows(old=>old.filter(item=>String(item.id)!==String(question.id)));
   setMessage("Questão "+question.source_question_number+" publicada após revisão administrativa. ID: "+data+".");
   setKind("success");
  }catch(error){
   setMessage(error?.message||"Não foi possível publicar a questão importada.");
   setKind("error");
  }finally{setBusyId("");}
 };

 const reject=async question=>{
  setBusyId(String(question.id));setMessage("");
  try{
   const now=new Date().toISOString();
   const {error}=await authClient.from("study_exam_question_imports").update({
    status:"rejected",rights_review_status:"restricted",reviewed_by:userId,reviewed_at:now,
    review_notes:String(notes[String(question.id)]||"Reprovada na revisão administrativa.").slice(0,4000),updated_at:now
   }).eq("id",question.id).eq("status","pending");
   if(error)throw error;
   setRows(old=>old.filter(item=>String(item.id)!==String(question.id)));
   setMessage("Questão removida da fila de publicação.");
   setKind("success");
  }catch(error){setMessage(error?.message||"Não foi possível reprovar o item.");setKind("error");}
  finally{setBusyId("");}
 };

 return <section className="panel admin-panel official-exam-import-admin" aria-label="Importação de questões de provas oficiais">
  <div className="admin-panel-heading">
   <div><strong>Importar questões de provas oficiais</strong><small>Extraia o PDF localmente, envie o manifesto para a fila administrativa e publique somente depois da conferência do enunciado e do gabarito definitivo.</small></div>
   <span className="discovery-status-pill">Revisão humana</span>
  </div>
  <div className="question-ai-how">
   <strong>Fonte e fundamento</strong>
   <p>Use PDFs obtidos diretamente no site oficial da banca ou do órgão. A publicação oficial é registrada como fundamento possível, não como autorização universal para anexos de terceiros. Revise edital/termos, imagens incorporadas, retificações e gabarito antes de aprovar. Não copie conteúdo, comentários ou organização de agregadores.</p>
  </div>
  <div className="question-ai-form">
   <label>Manifesto JSON gerado pelo importador local
    <input type="file" accept=".json,application/json" onChange={uploadManifest} disabled={uploadBusy||!authClient||!userId}/>
   </label>
   <div className="question-ai-form-footer">
    <small>Limite: 300 questões e 12 MB por manifesto. Envio apenas para rascunhos; não publica automaticamente.</small>
    <button type="button" className="detail-btn" onClick={()=>refresh()} disabled={loading||uploadBusy}>{loading?"Atualizando…":"Atualizar fila"}</button>
   </div>
   {uploadBusy&&<p className="muted">Validando manifesto e registrando itens pendentes…</p>}
  </div>
  {!tableReady&&<p className="auth-message error" role="alert">Aplique a migration supabase/migrations/20261126120000_official_exam_question_imports.sql antes de carregar a fila.</p>}
  {rows.length>0&&<div className="question-ai-review-queue">
   <div className="question-ai-subheading"><strong>Questões aguardando revisão</strong><span>{rows.length}</span></div>
   {rows.map(question=>{
    const options=Array.isArray(question.options)?question.options:[];
    return <article className="question-ai-review-item" key={question.id}>
     <div className="question-ai-review-head">
      <strong>{question.board} · {question.exam_name} · {question.exam_year}</strong>
      <span>Questão {question.source_question_number} · página {question.source_page}</span>
     </div>
     <div className="official-exam-meta"><span>{question.discipline}</span><span>{question.topic}</span><span>{rightsLabel(question.rights_basis)}</span></div>
     <p>{question.prompt}</p>
     {options.length>0&&<ul>{options.map(option=><li key={option.id}><strong>{String(option.id).toUpperCase()} — </strong>{option.text}</li>)}</ul>}
     {question.review_notes&&<small>{question.review_notes}</small>}
     <p><a href={question.source_url} target="_blank" rel="noopener noreferrer">Página oficial ↗</a> · <a href={question.exam_pdf_url} target="_blank" rel="noopener noreferrer">PDF original ↗</a></p>
     <label>Gabarito definitivo confirmado
      <select value={answers[String(question.id)]||""} onChange={event=>setAnswers(old=>({...old,[String(question.id)]:event.target.value}))}>
       <option value="">Selecione após conferir o gabarito</option>
       {options.map(option=><option key={option.id} value={String(option.id).toLowerCase()}>{String(option.id).toUpperCase()} — {option.text}</option>)}
      </select>
     </label>
     <label>Justificativa do gabarito (opcional)
      <textarea rows={2} value={explanations[String(question.id)]||""} onChange={event=>setExplanations(old=>({...old,[String(question.id)]:event.target.value}))} maxLength={5000}/>
     </label>
     <label>Observações da revisão
      <textarea rows={2} value={notes[String(question.id)]||""} onChange={event=>setNotes(old=>({...old,[String(question.id)]:event.target.value}))} maxLength={4000}/>
     </label>
     <label className="study-rights-confirm">
      <input type="checkbox" checked={!!confirmed[String(question.id)]} onChange={event=>setConfirmed(old=>({...old,[String(question.id)]:event.target.checked}))}/>
      <span>Conferi a prova diretamente na fonte oficial, o texto/alternativas visualmente, as restrições aplicáveis e o gabarito definitivo acima.</span>
     </label>
     <div className="question-ai-review-actions">
      <button type="button" className="primary-btn" disabled={busyId===String(question.id)||!confirmed[String(question.id)]||!answers[String(question.id)]} onClick={()=>publish(question)}>{busyId===String(question.id)?"Publicando…":"Aprovar e publicar"}</button>
      <button type="button" className="detail-btn" disabled={busyId===String(question.id)} onClick={()=>reject(question)}>Reprovar</button>
     </div>
    </article>;
   })}
  </div>}
  {!rows.length&&tableReady&&<p className="muted">Nenhuma questão aguardando revisão.</p>}
  {message&&<p className={"auth-message "+kind} role="status">{message}</p>}
  <p className="study-disclaimer">O gabarito não é inferido pelo OCR. Questões com elementos visuais exigem inspeção do PDF. A publicação é executada em uma única função SQL transacional: questão, gabarito e status da fila são confirmados juntos ou revertidos juntos.</p>
 </section>;
}
