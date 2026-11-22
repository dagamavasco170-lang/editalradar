import React,{useEffect,useState} from "react";
import { isTrustedOfficialUrl, isTrustedPrivateStudySourceUrl, parseHttpsUrl } from "./lib/official-sources.js";

const blank=()=>({exam_name:"",exam_year:String(new Date().getFullYear()),board:"Cebraspe",discipline:"Língua Portuguesa",topic:"",difficulty:"Intermediária",prompt:"",options:["","","","",""],answer:"a",explanation:"",source_url:"",rights_holder:"",license_status:"permission_granted",license_proof_url:""});
const blankTopic=()=>({discipline:"Direito Constitucional",topic:"Princípios da Administração Pública",difficulty:"Intermediária",source_url:"",source_excerpt:"",questions_per_run:3,cadence_days:1,active:true});
const statusLabel=value=>({auto_approved:"Aprovada automaticamente",manual_review:"Revisão adicional necessária",rejected:"Reprovada automaticamente",admin_approved:"Aprovada pelo administrador"}[value]||value||"Sem status");

export default function StudyQuestionAdmin({authClient,userId}){
 const [form,setForm]=useState(blank);
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [kind,setKind]=useState("info");
 const [topicForm,setTopicForm]=useState(blankTopic);
 const [topics,setTopics]=useState([]);
 const [runs,setRuns]=useState([]);
 const [pending,setPending]=useState([]);
 const [reviews,setReviews]=useState({});
 const [loading,setLoading]=useState(false);
 const [busyId,setBusyId]=useState("");
 const [automationMessage,setAutomationMessage]=useState("");
 const [automationKind,setAutomationKind]=useState("info");

 const update=(key,value)=>setForm(old=>({...old,[key]:value}));
 const updateTopic=(key,value)=>setTopicForm(old=>({...old,[key]:value}));

 const refreshAutomation=async()=>{
  if(!authClient||!userId)return;
  setLoading(true);
  try{
   const [topicRows,runRows,questionRows]=await Promise.all([
    authClient.from("study_question_automation_topics").select("*").order("created_at",{ascending:false}).limit(500),
    authClient.from("study_question_automation_runs").select("*").order("started_at",{ascending:false}).limit(8),
    authClient.from("study_questions").select("id,discipline,topic,difficulty,prompt,review_status,review_score,created_at").eq("origin","ai_generated").eq("published",false).order("created_at",{ascending:false}).limit(20)
   ]);
   if(topicRows.error)throw topicRows.error;
   if(runRows.error)throw runRows.error;
   if(questionRows.error)throw questionRows.error;
   const ids=(questionRows.data||[]).map(item=>item.id);
   let reviewMap={};
   if(ids.length){
    const reviewRows=await authClient.from("study_question_automation_reviews").select("question_id,reviewer_score,approved,issues").in("question_id",ids);
    if(reviewRows.error)throw reviewRows.error;
    reviewMap=Object.fromEntries((reviewRows.data||[]).map(item=>[String(item.question_id),item]));
   }
   setTopics(topicRows.data||[]);setRuns(runRows.data||[]);setPending(questionRows.data||[]);setReviews(reviewMap);
  }catch(error){setAutomationMessage(error?.message||"Não foi possível carregar os dados da automação.");setAutomationKind("error");}
  finally{setLoading(false);}
 };

 useEffect(()=>{void refreshAutomation();},[authClient,userId]);

 const saveTopic=async event=>{
  event.preventDefault();setAutomationMessage("");
  if(!authClient||!userId){setAutomationMessage("Entre com uma conta administrativa.");setAutomationKind("error");return;}
  if(!isTrustedPrivateStudySourceUrl(topicForm.source_url)){setAutomationMessage("Use apenas fontes autorizadas: Wikimedia, Wikisource (páginas verificadas), WikiEducator, Gapminder (materiais CC BY), Politize, MDN, Python, PostgreSQL, Rust, GitHub, Kubernetes, AWS ou Docker.");setAutomationKind("error");return;}
  if(topicForm.source_excerpt.trim().length>0&&topicForm.source_excerpt.trim().length<200){setAutomationMessage("O trecho manual precisa ter pelo menos 200 caracteres. Deixe-o vazio para tentar a extração automática da página.");setAutomationKind("error");return;}
  if(topicForm.source_excerpt.trim().length>12000){setAutomationMessage("O trecho manual não pode ultrapassar 12.000 caracteres.");setAutomationKind("error");return;}
  setBusyId("save-topic");
  try{
   const {error}=await authClient.from("study_question_automation_topics").insert({
    ...topicForm,topic:topicForm.topic.trim(),source_url:topicForm.source_url.trim(),source_excerpt:topicForm.source_excerpt.trim()||null,
    questions_per_run:Number(topicForm.questions_per_run),cadence_days:Number(topicForm.cadence_days),created_by:userId
   });
   if(error)throw error;
   setTopicForm(blankTopic());setAutomationMessage("Tema adicionado ao agendamento automático.");setAutomationKind("success");await refreshAutomation();
  }catch(error){setAutomationMessage(error?.message||"Não foi possível salvar o tema.");setAutomationKind("error");}
  finally{setBusyId("");}
 };

 const runTopic=async topic=>{
  setBusyId(topic.id);setAutomationMessage("");
  try{
   const {data,error}=await authClient.functions.invoke("question-factory",{body:{mode:"generate",topicId:topic.id}});
   if(error){
    let detail=error.message||"Falha ao chamar a automação.";
    try{const payload=await error.context?.clone?.().json?.();if(payload?.error)detail=payload.error;}catch{}
    throw new Error(detail);
   }
   if(data?.error)throw new Error(data.error);
   const result=data?.results?.[0]||{};
   setAutomationMessage("Execução concluída: "+(result.generated||0)+" criada(s), "+(result.approved||0)+" publicada(s), "+(result.manualReview||0)+" em revisão adicional e "+(result.rejected||0)+" reprovada(s).");
   setAutomationKind("success");await refreshAutomation();
  }catch(error){setAutomationMessage(error?.message||"Falha na geração. Confira se GEMINI_API_KEY está configurada e se a cota gratuita está disponível.");setAutomationKind("error");}
  finally{setBusyId("");}
 };

 const toggleTopic=async topic=>{
  setBusyId(topic.id);
  try{
   const {error}=await authClient.from("study_question_automation_topics").update({active:!topic.active,updated_at:new Date().toISOString()}).eq("id",topic.id);
   if(error)throw error;
   await refreshAutomation();
  }catch(error){setAutomationMessage(error?.message||"Não foi possível alterar o agendamento.");setAutomationKind("error");}
  finally{setBusyId("");}
 };

 const decideQuestion=async(question,approve)=>{
  setBusyId("q-"+question.id);
  try{
   const {error}=await authClient.from("study_questions").update({
    published:approve,review_status:approve?"admin_approved":"rejected",reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()
   }).eq("id",question.id).eq("origin","ai_generated");
   if(error)throw error;
   setAutomationMessage(approve?"Questão publicada após aprovação administrativa.":"Questão mantida fora do banco público.");
   setAutomationKind("success");await refreshAutomation();
  }catch(error){setAutomationMessage(error?.message||"Não foi possível atualizar a questão.");setAutomationKind("error");}
  finally{setBusyId("");}
 };

 const save=async event=>{
  event.preventDefault();setMessage("");
  if(!authClient||!userId){setMessage("Entre com a conta administrativa para cadastrar questões.");setKind("error");return;}
  const options=form.options.map((text,index)=>({id:String.fromCharCode(97+index),text:text.trim()})).filter(item=>item.text);
  const source=form.source_url.trim(),proof=form.license_proof_url.trim();
  if(!form.exam_name.trim()||!form.prompt.trim()||!form.topic.trim()||!form.rights_holder.trim()){setMessage("Preencha prova, tema, enunciado e titular dos direitos.");setKind("error");return;}
  if(!isTrustedOfficialUrl(source)){setMessage("A fonte da questão precisa ser um domínio oficial de órgão público ou banca organizadora.");setKind("error");return;}
  if(!parseHttpsUrl(proof)){setMessage("O comprovante de licença precisa ter um link HTTPS válido, sem credenciais na URL.");setKind("error");return;}
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

 return <div className="study-question-admin-stack">
  <section className="panel admin-panel question-ai-automation" aria-label="Geração e revisão automática de questões">
   <div className="admin-panel-heading"><div><strong>Elaboração e revisão automática por IA</strong><small>Gera questões originais a partir de material aberto ou licenciado, executa revisão independente e publica apenas as aprovadas.</small></div><span className="discovery-status-pill">Automação diária</span></div>
   <div className="question-ai-summary">
    <div><strong>{topics.length}</strong><span>temas configurados</span></div><div><strong>{topics.filter(item=>item.active).length}</strong><span>agendamentos ativos</span></div>
    <div><strong>{pending.length}</strong><span>rascunhos em exceção</span></div><div><strong>{runs[0]?.auto_approved_count||0}</strong><span>publicadas na última execução</span></div>
   </div>
   <div className="question-ai-how"><strong>Revisão em duas etapas</strong><p>Gemini Flash-Lite elabora a questão e um segundo passe revisa a resposta, os distratores, a justificativa e a aderência à fonte. Há validação automática de evidência literal e duplicidade. Somente questões com nota mínima de 90/100 e todos os critérios atendidos são publicadas.</p></div>
   <form className="question-ai-form" onSubmit={saveTopic}>
    <div><strong>Configurar tema recorrente</strong><small>Informe uma fonte privada com licença aberta ou permissão de reutilização. O sistema registra a licença e a atribuição junto de cada questão.</small></div>
    <div className="study-admin-grid">
     <label>Disciplina<input value={topicForm.discipline} onChange={e=>updateTopic("discipline",e.target.value)} required maxLength={100} placeholder="Qualquer disciplina ou área"/></label>
     <label>Dificuldade<select value={topicForm.difficulty} onChange={e=>updateTopic("difficulty",e.target.value)}>{["Fácil","Intermediária","Avançada"].map(item=><option key={item}>{item}</option>)}</select></label>
     <label className="study-admin-wide">Assunto<input value={topicForm.topic} onChange={e=>updateTopic("topic",e.target.value)} required maxLength={160} placeholder="Ex.: Direitos e garantias fundamentais"/></label>
     <label className="study-admin-wide">Fonte privada de estudo HTTPS<input type="url" value={topicForm.source_url} onChange={e=>updateTopic("source_url",e.target.value)} required placeholder="https://pt.wikibooks.org/wiki/Portugu%C3%AAs"/></label>
     <label>Questões por execução<select value={topicForm.questions_per_run} onChange={e=>updateTopic("questions_per_run",Number(e.target.value))}>{[1,2,3].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
     <label>Frequência<select value={topicForm.cadence_days} onChange={e=>updateTopic("cadence_days",Number(e.target.value))}>{[{value:1,label:"Diária"},{value:2,label:"A cada 2 dias"},{value:7,label:"Semanal"},{value:14,label:"A cada 14 dias"},{value:30,label:"Mensal"}].map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    </div>
    <label>Trecho do material de estudo (opcional)<textarea rows={5} maxLength={12000} value={topicForm.source_excerpt} onChange={e=>updateTopic("source_excerpt",e.target.value)} placeholder="Deixe vazio para a automação extrair o texto da página de estudo. Para PDF ou imagem, cole aqui um trecho de 200 a 12.000 caracteres."/></label>
    <div className="question-ai-form-footer"><small>{topicForm.source_excerpt.trim().length}/12.000 caracteres · extração automática quando vazio</small><button className="primary-btn" type="submit" disabled={busyId==="save-topic"}>{busyId==="save-topic"?"Salvando…":"Adicionar tema"}</button></div>
   </form>
   <div className="question-ai-topics">
    <div className="question-ai-subheading"><strong>Temas agendados</strong><button type="button" className="detail-btn" onClick={()=>refreshAutomation()} disabled={loading}>{loading?"Atualizando…":"Atualizar"}</button></div>
    {!topics.length&&!loading&&<p className="muted">Nenhum tema configurado. Adicione o primeiro acima para iniciar a automação recorrente.</p>}
    {topics.map(topic=><article className="question-ai-topic" key={topic.id}>
     <div><strong>{topic.discipline} · {topic.topic}</strong><small>{topic.questions_per_run} questão(ões) por execução · {topic.cadence_days===1?"diariamente":"a cada "+topic.cadence_days+" dias"} · {topic.last_run_at?"Última: "+new Date(topic.last_run_at).toLocaleString("pt-BR"):"Ainda não executado"}</small></div>
     <div className="question-ai-topic-actions"><button type="button" className="detail-btn" disabled={busyId===topic.id||!topic.active} onClick={()=>runTopic(topic)}>{busyId===topic.id?"Gerando e revisando…":"Executar agora"}</button><button type="button" className="detail-btn" disabled={busyId===topic.id} onClick={()=>toggleTopic(topic)}>{topic.active?"Pausar":"Ativar"}</button></div>
    </article>)}
   </div>
   {pending.length>0&&<div className="question-ai-review-queue"><div className="question-ai-subheading"><strong>Fila de exceções da revisão automática</strong><span>{pending.length} questão(ões)</span></div>
    {pending.map(question=>{const review=reviews[String(question.id)]||{};const issues=Array.isArray(review.issues)?review.issues:[];return <article className="question-ai-review-item" key={question.id}>
     <div className="question-ai-review-head"><strong>{question.discipline} · {question.topic}</strong><span>{statusLabel(question.review_status)} · nota {question.review_score??review.reviewer_score??"—"}/100</span></div>
     <p>{question.prompt}</p>{issues.length>0&&<ul>{issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
     {question.review_status==="manual_review"&&<div className="question-ai-review-actions"><button type="button" className="primary-btn" disabled={busyId==="q-"+question.id} onClick={()=>decideQuestion(question,true)}>Aprovar e publicar</button><button type="button" className="detail-btn" disabled={busyId==="q-"+question.id} onClick={()=>decideQuestion(question,false)}>Reprovar</button></div>}
    </article>;})}
   </div>}
   {runs.length>0&&<div className="question-ai-runs"><strong>Execuções recentes</strong>{runs.slice(0,5).map(run=><div key={run.id}><span>{run.started_at?new Date(run.started_at).toLocaleString("pt-BR"):"—"} · {run.status}</span><small>{run.generated_count} elaboradas · {run.auto_approved_count} publicadas · {run.manual_review_count} em exceção · {run.rejected_count} reprovadas</small></div>)}</div>}
   {automationMessage&&<p className={"auth-message "+automationKind} role="status">{automationMessage}</p>}
   <p className="study-disclaimer">Usa exclusivamente Gemini 3.1 Flash-Lite, sem fallback para outro provedor. A conta Google determina a cota e a faixa de cobrança. Limite local de segurança: 3 execuções por dia, até 3 questões por execução. Para manter o uso sem cobrança, utilize a cota gratuita e deixe o faturamento do projeto Google desativado. Configure GEMINI_API_KEY em Supabase → Edge Functions → Secrets.</p>
  </section>

  <section className="panel admin-panel study-question-admin" aria-label="Cadastro de questões reais licenciadas">
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
  </section>
 </div>;
}
