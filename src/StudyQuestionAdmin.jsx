import React,{useState} from "react";

const blank=()=>({exam_name:"",exam_year:String(new Date().getFullYear()),board:"Cebraspe",discipline:"Língua Portuguesa",topic:"",difficulty:"Intermediária",prompt:"",options:["","","","",""],answer:"a",explanation:"",source_url:"",rights_holder:"",license_status:"permission_granted",license_proof_url:""});
export default function StudyQuestionAdmin({authClient,userId}){
 const [form,setForm]=useState(blank);
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [kind,setKind]=useState("info");
 const update=(key,value)=>setForm(old=>({...old,[key]:value}));
 const save=async event=>{
  event.preventDefault();setMessage("");
  if(!authClient||!userId){setMessage("Entre com a conta administrativa para cadastrar questões.");setKind("error");return;}
  const options=form.options.map((text,index)=>({id:String.fromCharCode(97+index),text:text.trim()})).filter(item=>item.text);
  const source=form.source_url.trim(),proof=form.license_proof_url.trim();
  if(!form.exam_name.trim()||!form.prompt.trim()||!form.topic.trim()||!form.rights_holder.trim()){setMessage("Preencha prova, tema, enunciado e titular dos direitos.");setKind("error");return;}
  if(!/^https:\/\//i.test(source)||!/^https:\/\//i.test(proof)){setMessage("Informe fonte oficial e comprovante de licença, ambos com https://.");setKind("error");return;}
  if(options.length<2||!options.some(option=>option.id===form.answer)){setMessage("Preencha pelo menos duas alternativas e selecione um gabarito válido.");setKind("error");return;}
  if(!confirmed){setMessage("Confirme que existe autorização/licença válida para reproduzir o conteúdo.");setKind("error");return;}
  const year=Number(form.exam_year);
  if(!Number.isInteger(year)||year<1900||year>2200){setMessage("Informe um ano válido.");setKind("error");return;}
  setBusy(true);let id=null;
  try{
   const {data,error}=await authClient.from("study_questions").insert({exam_name:form.exam_name.trim(),exam_year:year,board:form.board,discipline:form.discipline,topic:form.topic.trim(),difficulty:form.difficulty,prompt:form.prompt.trim(),options,source_url:source,rights_holder:form.rights_holder.trim(),license_status:form.license_status,license_proof_url:proof,published:false,created_by:userId}).select("id").single();
   if(error)throw error;id=data.id;
   const {error:answerError}=await authClient.from("study_question_answers").insert({question_id:id,answer:form.answer,explanation:form.explanation.trim(),created_by:userId});
   if(answerError)throw answerError;
   const {error:publishError}=await authClient.from("study_questions").update({published:true,updated_at:new Date().toISOString()}).eq("id",id);
   if(publishError)throw publishError;
   setForm(blank());setConfirmed(false);setMessage("Questão licenciada publicada no banco de questões reais.");setKind("success");
  }catch(error){
   if(id!==null){try{await authClient.from("study_questions").delete().eq("id",id);}catch{/* O registro permanece não publicado se a limpeza falhar. */}}
   setMessage(error?.message||"Não foi possível salvar a questão. Confira as permissões administrativas.");setKind("error");
  }finally{setBusy(false);}
 };
 return <section className="panel admin-panel study-question-admin" aria-label="Cadastro de questões reais licenciadas">
  <div className="admin-panel-heading"><div><strong>Banco de questões reais autorizadas</strong><small>Publique somente conteúdo com licença ou autorização documentada.</small></div><span className="discovery-status-pill">Controle de direitos</span></div>
  <form className="study-question-admin-form" onSubmit={save}>
   <div className="study-admin-grid">
    <label>Prova / concurso<input value={form.exam_name} onChange={e=>update("exam_name",e.target.value)} required maxLength={180}/></label>
    <label>Ano<input type="number" min="1900" max="2200" value={form.exam_year} onChange={e=>update("exam_year",e.target.value)} required/></label>
    <label>Banca<select value={form.board} onChange={e=>update("board",e.target.value)}>{["Cebraspe","FGV","FCC","Vunesp","IBFC","Instituto AOCP","Outra"].map(item=><option key={item}>{item}</option>)}</select></label>
    <label>Disciplina<select value={form.discipline} onChange={e=>update("discipline",e.target.value)}>{["Língua Portuguesa","Raciocínio lógico","Direito Constitucional","Direito Administrativo","Informática","Direito Civil","Direito Penal","Direito Processual","Conhecimentos específicos","Outra"].map(item=><option key={item}>{item}</option>)}</select></label>
    <label>Tema<input value={form.topic} onChange={e=>update("topic",e.target.value)} required maxLength={160}/></label>
    <label>Dificuldade<select value={form.difficulty} onChange={e=>update("difficulty",e.target.value)}>{["Fácil","Intermediária","Avançada"].map(item=><option key={item}>{item}</option>)}</select></label>
   </div>
   <label>Enunciado<textarea rows={4} value={form.prompt} onChange={e=>update("prompt",e.target.value)} required maxLength={5000}/></label>
   <div className="study-admin-options"><strong>Alternativas</strong>{form.options.map((value,index)=><label key={index}><span>{String.fromCharCode(65+index)}</span><input value={value} onChange={e=>setForm(old=>({...old,options:old.options.map((item,i)=>i===index?e.target.value:item)}))} placeholder={"Texto da alternativa "+String.fromCharCode(65+index)}/></label>)}</div>
   <div className="study-admin-grid">
    <label>Gabarito<select value={form.answer} onChange={e=>update("answer",e.target.value)}>{form.options.map((_,index)=><option key={index} value={String.fromCharCode(97+index)}>{String.fromCharCode(65+index)}</option>)}</select></label>
    <label>Titular dos direitos<input value={form.rights_holder} onChange={e=>update("rights_holder",e.target.value)} required maxLength={180}/></label>
    <label>Licença<select value={form.license_status} onChange={e=>update("license_status",e.target.value)}><option value="permission_granted">Autorização expressa</option><option value="cc_by">Creative Commons BY</option><option value="cc_by_sa">Creative Commons BY-SA</option><option value="public_domain">Domínio público comprovado</option></select></label>
    <label>Fonte oficial<input type="url" value={form.source_url} onChange={e=>update("source_url",e.target.value)} placeholder="https://..." required/></label>
    <label className="study-admin-wide">Comprovante de licença/autorização<input type="url" value={form.license_proof_url} onChange={e=>update("license_proof_url",e.target.value)} placeholder="https://..." required/></label>
   </div>
   <label>Comentário / justificativa<textarea rows={3} value={form.explanation} onChange={e=>update("explanation",e.target.value)} maxLength={5000}/></label>
   <label className="study-rights-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Confirmo que o EditalRadar possui autorização ou licença válida para reproduzir enunciado, alternativas e gabarito.</span></label>
   <div className="study-admin-footer"><small>O registro só publica depois de gravar questão, gabarito e comprovante. A resposta fica separada e não é enviada junto da questão pública.</small><button className="primary-btn" type="submit" disabled={busy}>{busy?"Salvando…":"Cadastrar questão real autorizada"}</button></div>
   {message&&<p className={"auth-message "+kind} role="status">{message}</p>}
  </form>
 </section>;
}
