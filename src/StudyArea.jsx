import React, { useEffect, useMemo, useState } from "react";
import { loadQuestionProgress, mergeQuestionProgress, questionBank, questionProgressStorageKey } from "./lib/question-bank.js";
import { buildQuestionBankView } from "./lib/question-bank-view.js";
import { buildQuestionProgressMetrics } from "./lib/question-progress-metrics.js";
import { buildStudyRecommendations } from "./lib/study-recommendations.js";
import { buildTopicMastery, buildWeeklyStudyProgress } from "./lib/topic-mastery.js";
import { buildAdaptiveStudySessions, buildDailyAdaptiveGoals } from "./lib/adaptive-study-plan.js";
import { buildTutorSignals, buildAdaptiveQuestionPlan, buildAdaptiveTutorFeedback } from "./lib/tutor-intelligence.js";

const SimulatorPanel = React.lazy(() => import("./SimulatorPanel.jsx"));
const ExamSourcesPanel = React.lazy(() => import("./ExamSourcesPanel.jsx"));

const subjects=["Língua Portuguesa","Direito Constitucional","Raciocínio lógico","Direito Administrativo","Informática"];
const days=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
const storageKey=(userId)=>"er-study-plan:"+(userId||"visitor");
const focusStorageKey=(userId)=>"er-focus-sessions:"+(userId||"visitor");
const loadFocusSessions=(userId)=>{
 try { const value=Number(localStorage.getItem(focusStorageKey(userId))||0); return Number.isFinite(value)&&value>0?Math.floor(value):0; }
 catch { return 0; }
};
const formatClock=(seconds)=>String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");
const rightsBasisLabel=value=>({
 official_publication:"publicação oficial de ato da banca/órgão",
 public_domain:"domínio público",
 permission_granted:"autorização expressa",
 cc_by:"licença CC BY",
 cc_by_sa:"licença CC BY-SA"
}[value]||"fundamento revisado");

const loadPlan=(userId)=>{
 try {
  const value=JSON.parse(localStorage.getItem(storageKey(userId))||"{}");
  return {hours:[5,8,10,15,20].includes(Number(value.hours))?Number(value.hours):10,days:Array.isArray(value.days)&&value.days.length?value.days:days.slice(0,5),done:Array.isArray(value.done)?value.done:[]};
 } catch { return {hours:10,days:days.slice(0,5),done:[]}; }
};

export default function StudyArea({selected,tasks,progress,onToggleTask,onBackDetails,onClearFocus,userId,authClient}) {
 const activeUserId=userId||null;
 const [plan,setPlan]=useState(()=>loadPlan(activeUserId));
 const [discipline,setDiscipline]=useState("Todas");
 const [board,setBoard]=useState("Todas");
 const [difficulty,setDifficulty]=useState("Todas");
 const [collection,setCollection]=useState("all");
 const [questionSearch,setQuestionSearch]=useState("");
 const [originFilter,setOriginFilter]=useState("Todas");
 const [licensedQuestions,setLicensedQuestions]=useState([]);
 const [licensedQuestionStatus,setLicensedQuestionStatus]=useState("loading");
 const [index,setIndex]=useState(0);
 const [answer,setAnswer]=useState("");
 const [checked,setChecked]=useState(false);
 const [checking,setChecking]=useState(false);
 const [answerFeedback,setAnswerFeedback]=useState(null);
 const [adaptiveFeedback,setAdaptiveFeedback]=useState(null);
 const [questionProgressReady,setQuestionProgressReady]=useState(!activeUserId || !authClient);
 const [questionSyncStatus,setQuestionSyncStatus]=useState(activeUserId ? "loading" : "local");
 const [questionProgressState,setQuestionProgressState]=useState(()=>({
  userId:activeUserId,data:loadQuestionProgress(activeUserId)
 }));
 const questionProgress=questionProgressState.userId===activeUserId
  ?questionProgressState.data:loadQuestionProgress(activeUserId);
 const [timerMinutes,setTimerMinutes]=useState(25);
 const [timerRemaining,setTimerRemaining]=useState(25*60);
 const [timerRunning,setTimerRunning]=useState(false);
 const [focusSessions,setFocusSessions]=useState(()=>loadFocusSessions(activeUserId));
 const [timerNotice,setTimerNotice]=useState("");

 useEffect(()=>setPlan(loadPlan(activeUserId)),[activeUserId]);
 useEffect(()=>{
  setQuestionProgressState({userId:activeUserId,data:loadQuestionProgress(activeUserId)});
  setQuestionProgressReady(!activeUserId || !authClient);
  setQuestionSyncStatus(activeUserId ? "loading" : "local");
  setLicensedQuestions([]);setLicensedQuestionStatus("loading");
  setDiscipline("Todas");setBoard("Todas");setDifficulty("Todas");setCollection("all");
  setQuestionSearch("");setOriginFilter("Todas");setIndex(0);setAnswer("");setChecked(false);setAnswerFeedback(null);setAdaptiveFeedback(null);
  setTimerRunning(false);
  setTimerRemaining(timerMinutes*60);
  setFocusSessions(loadFocusSessions(activeUserId));
  setTimerNotice("");
 },[activeUserId]);
 useEffect(()=>{
  if(!timerRunning)return undefined;
  const interval=window.setInterval(()=>setTimerRemaining(value=>Math.max(0,value-1)),1000);
  return ()=>window.clearInterval(interval);
 },[timerRunning]);
 useEffect(()=>{
  if(!timerRunning||timerRemaining!==0)return;
  setTimerRunning(false);
  const nextCount=focusSessions+1;
  setFocusSessions(nextCount);
  try{localStorage.setItem(focusStorageKey(activeUserId),String(nextCount));}catch{}
  setTimerNotice("Sessão concluída! Faça uma pausa e volte com energia.");
 },[timerRunning,timerRemaining,activeUserId]);
 useEffect(()=>{try{localStorage.setItem(storageKey(activeUserId),JSON.stringify(plan));}catch{}},[plan,activeUserId]);


 useEffect(()=>{
  let cancelled=false;
  if(!activeUserId||!authClient){setQuestionProgressReady(true);setQuestionSyncStatus("local");return undefined;}
  const localProgress=loadQuestionProgress(activeUserId);
  setQuestionProgressReady(false);setQuestionSyncStatus("loading");
  const loadCloudProgress=async()=>{
   try{
    const {data,error}=await authClient.from("user_data").select("question_progress").eq("user_id",activeUserId).maybeSingle();
    if(error)throw error;
    if(cancelled)return;
    setQuestionProgressState(current=>{
     const newestLocal=current.userId===activeUserId?current.data:localProgress;
     return {userId:activeUserId,data:mergeQuestionProgress(data?.question_progress,newestLocal)};
    });
    setQuestionSyncStatus("synced");
   }catch{
    if(!cancelled)setQuestionSyncStatus("local");
   }finally{
    if(!cancelled)setQuestionProgressReady(true);
   }
  };
  void loadCloudProgress();
  return()=>{cancelled=true;};
 },[activeUserId,authClient]);

 useEffect(()=>{
  let cancelled=false;
  if(!authClient){setLicensedQuestions([]);setLicensedQuestionStatus("fallback");return undefined;}
  const loadLicensedQuestions=async()=>{
   try{
    const records=[];
    const pageSize=500;
    for(let offset=0;!cancelled;offset+=pageSize){
     const {data,error}=await authClient.from("study_questions")
      .select("id, discipline, topic, difficulty, board, exam_name, exam_year, prompt, options, source_url, license_status, rights_basis, origin, review_status")
      .eq("published",true).order("created_at",{ascending:false}).range(offset,offset+pageSize-1);
     if(error)throw error;
     const page=Array.isArray(data)?data:[];
     records.push(...page);
     if(page.length<pageSize)break;
    }
    if(cancelled)return;
    const rows=records.map(record=>({
     id:"licensed-"+record.id,databaseId:record.id,origin:record.origin==="ai_generated"?"generated":record.origin==="exam_import"?"exam_import":"licensed",
     discipline:record.discipline,topic:record.topic,difficulty:record.difficulty,
     board:record.board,examName:record.exam_name,examYear:record.exam_year,
     prompt:record.prompt,
     options:(Array.isArray(record.options)?record.options:[]).map(option=>[option.text,option.id]),
     sourceUrl:record.source_url,licenseStatus:record.license_status,rightsBasis:record.rights_basis
    })).filter(question=>question.options.length>=2);
    setLicensedQuestions(rows);setLicensedQuestionStatus("ready");
   }catch{if(!cancelled){setLicensedQuestions([]);setLicensedQuestionStatus("unavailable");}}
  };
  void loadLicensedQuestions();
  return()=>{cancelled=true;};
 },[authClient]);

 useEffect(()=>{
  if(!activeUserId||!authClient||!questionProgressReady||questionProgressState.userId!==activeUserId)return undefined;
  let cancelled=false;
  const timeout=window.setTimeout(async()=>{
   setQuestionSyncStatus("syncing");
   try{
    const {error}=await authClient.from("user_data").upsert({
     user_id:activeUserId,question_progress:questionProgressState.data,updated_at:new Date().toISOString()
    });
    if(error)throw error;
    if(!cancelled)setQuestionSyncStatus("synced");
   }catch{if(!cancelled)setQuestionSyncStatus("local");}
  },500);
  return()=>{cancelled=true;window.clearTimeout(timeout);};
 },[activeUserId,authClient,questionProgressReady,questionProgressState]);


 useEffect(()=>{
  if(questionProgressState.userId!==activeUserId)return;
  try{
   localStorage.setItem(questionProgressStorageKey(activeUserId),JSON.stringify(questionProgressState.data));
  }catch{/* O banco continua utilizável durante esta sessão. */}
 },[questionProgressState,activeUserId]);

 const latestAttempts=useMemo(()=>{
  const latest={};
  for(const attempt of questionProgress.attempts)latest[attempt.questionId]=attempt;
  return latest;
 },[questionProgress.attempts]);
 const savedQuestions=useMemo(()=>new Set(questionProgress.saved),[questionProgress.saved]);
 const allQuestions=useMemo(()=>[...questionBank,...licensedQuestions],[licensedQuestions]);
 const simulatorQuestions=useMemo(()=>allQuestions.filter(question=>
  question.origin!=="licensed"&&(!question.databaseId||Boolean(activeUserId&&authClient))
 ),[allQuestions,activeUserId,authClient]);
 const questionBankView=useMemo(()=>buildQuestionBankView({
  questions:allQuestions,discipline,board,difficulty,originFilter,questionSearch,collection,latestAttempts,savedQuestions
 }),[allQuestions,discipline,board,difficulty,originFilter,questionSearch,collection,latestAttempts,savedQuestions]);
 const questionBase=questionBankView.base;
 const collectionCounts=questionBankView.counts;
 const filtered=questionBankView.filtered;
 const question=filtered.length?filtered[index%filtered.length]:null;
 const questionAttempt=question?latestAttempts[question.id]:null;
 const filteredAnsweredCount=useMemo(()=>{
  const filteredIds=new Set(filtered.map(item=>item.id));
  const answeredIds=new Set(questionProgress.attempts.filter(item=>filteredIds.has(item.questionId)).map(item=>item.questionId));
  return answeredIds.size;
 },[filtered,questionProgress.attempts]);
 const progressMetrics=useMemo(()=>buildQuestionProgressMetrics({attempts:questionProgress.attempts,questions:allQuestions}),[questionProgress.attempts,allQuestions]);
 const {totalAttempts,totalCorrect,accuracy,uniqueAnswered}=progressMetrics;
 const adaptiveQuestionPlan=useMemo(()=>buildAdaptiveQuestionPlan({questions:allQuestions,latestAttempts}),[allQuestions,latestAttempts]);
 const adaptiveCurrent=question?adaptiveQuestionPlan.find(item=>item.id===question.id):null;
 const topicRecentAttempts=question?questionProgress.attempts.filter(item=>allQuestions.find(q=>q.id===item.questionId)?.topic===question.topic).slice(-5):[];
 const consecutiveCorrect=topicRecentAttempts.slice().reverse().reduce((state,item)=>item.correct&&!state.stopped?{count:state.count+1,stopped:false}:{count:state.count,stopped:true},{count:0,stopped:false}).count;
 const nextAdaptiveQuestion=()=>{const candidates=adaptiveQuestionPlan.filter(item=>item.id!==question?.id&&filtered.some(q=>q.id===item.id));if(!candidates.length)return;const target=filtered.findIndex(q=>q.id===candidates[0].id);if(target>=0){setIndex(target);setAnswer("");setChecked(false);setAnswerFeedback(null);}};
 const studyRecommendations=useMemo(()=>buildStudyRecommendations({questions:allQuestions,attempts:questionProgress.attempts}),[allQuestions,questionProgress.attempts]);
 const topicMastery=useMemo(()=>buildTopicMastery({questions:allQuestions,attempts:questionProgress.attempts}),[allQuestions,questionProgress.attempts]);
 const weeklyStudyProgress=useMemo(()=>buildWeeklyStudyProgress({attempts:questionProgress.attempts}),[questionProgress.attempts]);
 const dueTopics=topicMastery.filter(item=>item.due);
 const tutorSignals=useMemo(()=>buildTutorSignals({topics:topicMastery,weeklyProgress:weeklyStudyProgress,simulations:questionProgress.simulations}),[topicMastery,weeklyStudyProgress,questionProgress.simulations]);
 const masteryLabel={starting:"Iniciando",developing:"Em desenvolvimento",strong:"Bom domínio"};
 const sessions=useMemo(()=>buildAdaptiveStudySessions({subjects,attempts:questionProgress.attempts,mastery:topicMastery,hours:plan.hours,days:plan.days}),[plan,questionProgress.attempts,topicMastery]);
 const dailyGoals=useMemo(()=>buildDailyAdaptiveGoals({sessions,days:plan.days}),[sessions,plan.days]);
 const update=(patch)=>setPlan(current=>({...current,...patch}));
 const updateQuestionProgress=(updater)=>{
  setQuestionProgressState(current=>{
   const base=current.userId===activeUserId?current.data:loadQuestionProgress(activeUserId);
   const next=typeof updater==="function"?updater(base):updater;
   return {userId:activeUserId,data:next};
  });
 };
 const completeSimulation=(summary)=>{
  const reviewByQuestion=new Map((summary.review||[]).map(item=>[String(item.questionId),item]));
  const attempts=summary.questionIds.map(questionId=>{
   const review=reviewByQuestion.get(String(questionId));
   const question=allQuestions.find(item=>String(item.id)===String(questionId));
   const answerValue=summary.answers[questionId]||"";
   return {id:summary.id+":"+questionId,questionId,answer:answerValue,correct:Boolean(answerValue&&review?.correct),at:summary.completedAt,source:question?.origin==="generated"?"autoral-gerada":question?.origin==="licensed"||question?.origin==="exam_import"?"prova-real":"simulado",simulationId:summary.id};
  });
  const savedSummary={...summary};
  delete savedSummary.review;
  updateQuestionProgress(current=>({
   ...current,
   attempts:[...current.attempts,...attempts].slice(-500),
   simulations:[...current.simulations,savedSummary].slice(-100)
  }));
 };
 const resetQuestionSelection=()=>{
  setIndex(0);setAnswer("");setChecked(false);setAnswerFeedback(null);
 };
 const selectCollection=(next)=>{setCollection(next);resetQuestionSelection();};
 const setQuestionFilter=(setter,value)=>{setter(value);resetQuestionSelection();};
 const chooseTimer=(minutes)=>{
  setTimerMinutes(minutes);
  setTimerRemaining(minutes*60);
  setTimerRunning(false);
  setTimerNotice("");
 };
 const resetTimer=()=>{
  setTimerRunning(false);
  setTimerRemaining(timerMinutes*60);
  setTimerNotice("");
 };
 const timerProgress=Math.max(0,Math.min(100,(timerRemaining/(timerMinutes*60))*100));
 const toggleDay=(day)=>{
  const removing=plan.days.includes(day);
  const nextDays=removing?plan.days.filter(x=>x!==day):[...plan.days,day];
  if(!nextDays.length)return;
  update({days:nextDays,done:removing?plan.done.filter(id=>!id.startsWith(day+"-")):plan.done});
 };
 const check=async()=>{
  if(!question||!answer||checked||checking)return;
  setChecking(true);setAnswerFeedback(null);
  try{
   let correct=false,explanation="";
   if(question.databaseId){
    if(!activeUserId)throw new Error("Entre na sua conta para corrigir esta questão.");

    const {data,error}=await authClient.rpc("check_study_question_answer",{
     p_question_id:question.databaseId,p_selected_answer:answer
    });
    if(error)throw error;
    if(!data||typeof data.correct!=="boolean")throw new Error("Gabarito indisponível para esta questão. Avise a administração.");
    correct=data.correct;explanation=data.explanation||"";
   }else{
    correct=answer===question.answer;explanation=question.explanation||"";
   }
   updateQuestionProgress(current=>({
    ...current,
    attempts:[...current.attempts,{id:"attempt-"+Date.now()+"-"+question.id,questionId:question.id,answer,correct,at:new Date().toISOString(),source:question.origin==="licensed"||question.origin==="exam_import"?"prova-real":question.origin==="generated"?"autoral-gerada":"autoral"}].slice(-500)
   }));
   setAdaptiveFeedback(buildAdaptiveTutorFeedback({correct,recentTopicAttempts:topicRecentAttempts,currentLevel:question.difficulty}));setAnswerFeedback({correct,explanation});setChecked(true);
  }catch(error){setAnswerFeedback({error:"Não foi possível corrigir esta questão. Tente novamente."});}
  finally{setChecking(false);}
 };
 const next=()=>{
  if(index>=filtered.length-1)return;
  setIndex(i=>Math.min(i+1,Math.max(filtered.length-1,0)));
  setAnswer("");setChecked(false);setAnswerFeedback(null);
 };
 const randomQuestion=()=>{
  if(filtered.length<2)return;
  const choices=filtered.map((_,i)=>i).filter(i=>i!==index);
  setIndex(choices[Math.floor(Math.random()*choices.length)]);
  setAnswer("");setChecked(false);setAnswerFeedback(null);
 };
 const toggleSavedQuestion=()=>{
  if(!question)return;
  updateQuestionProgress(current=>({
   ...current,
   saved:current.saved.includes(question.id)
    ?current.saved.filter(id=>id!==question.id)
    :[...current.saved,question.id]
  }));
 };

 return <section className="content study-page">
  <div className="eyebrow">SUA ROTINA, SEU RITMO</div><h1>Área de estudos</h1>
  <p className="subhead">Monte uma rotina semanal, pratique por disciplina e acompanhe seu progresso.</p>
  {selected&&<section className="study-target-card" aria-label="Concurso selecionado para preparação"><div><div className="eyebrow">FOCO DA SUA PREPARAÇÃO</div><strong>{selected.cargo}</strong><p>{selected.orgao} · {selected.sigla||selected.estado||"Seleção selecionada"}</p><small>O planejamento é uma sugestão inicial. Consulte o conteúdo programático e os pesos do edital.</small></div><div className="study-target-actions"><button className="detail-btn" onClick={onBackDetails}>Voltar aos detalhes</button><button className="alert-remove" onClick={onClearFocus}>Limpar foco</button></div></section>}
  <section className="panel focus-timer-panel" aria-label="Cronômetro de foco">
   <div className="focus-timer-copy">
    <div className="eyebrow">MODO CONCENTRAÇÃO</div>
    <h2>Hora de focar em você.</h2>
    <p>Use ciclos curtos para manter a constância. Inicie uma sessão e acompanhe o tempo restante sem sair da área de estudos.</p>
    <div className="focus-timer-presets" role="group" aria-label="Duração da sessão">
     <button type="button" className={timerMinutes===25?"active":""} disabled={timerRunning} onClick={()=>chooseTimer(25)}>25 min · foco</button>
     <button type="button" className={timerMinutes===50?"active":""} disabled={timerRunning} onClick={()=>chooseTimer(50)}>50 min · profundo</button>
    </div>
   </div>
   <div className="focus-timer-controls">
    <div className="focus-timer-dial" style={{"--timer-progress":timerProgress+"%"}} role="timer" aria-label={"Tempo restante "+formatClock(timerRemaining)}>
     <span>{formatClock(timerRemaining)}</span><small>{timerRunning?"EM ANDAMENTO":"TEMPO DE FOCO"}</small>
    </div>
    <div className="focus-timer-buttons">
     <button type="button" className="primary-btn" onClick={()=>{setTimerNotice("");setTimerRunning(value=>!value);}}>{timerRunning?"Pausar sessão":"Iniciar foco"}</button>
     <button type="button" className="detail-btn" onClick={resetTimer}>Reiniciar</button>
    </div>
    <div className="focus-timer-summary"><strong>{focusSessions}</strong><span>sessões de foco concluídas</span></div>
    {timerNotice&&<p className="focus-timer-notice" role="status">{timerNotice}</p>}
   </div>
  </section>
  <div className="study-grid">
   <div className="panel progress-panel"><div className="panel-head"><div><div className="eyebrow">VISÃO GERAL</div><h2>Seu progresso diário</h2></div><span className="soft-pill">Hoje</span></div><div className="progress-number">{progress}%</div><div className="progress-track"><div style={{width:progress+"%"}}/></div><p className="muted">{tasks.filter(Boolean).length} de {tasks.length} atividades concluídas</p><div className="task-list">{["Revisar português","Resolver 10 questões","Estudar direito constitucional","Fazer uma revisão rápida"].map((task,i)=><label className="task" key={task}><input type="checkbox" checked={Boolean(tasks[i])} onChange={()=>onToggleTask(i)}/><span className={tasks[i]?"task-done":""}>{task}</span><small>{[25,30,40,15][i]} min</small></label>)}</div></div>
   <div className="panel study-plan-panel"><div className="panel-head"><div><div className="eyebrow">PLANEJAMENTO SEMANAL</div><h2>Monte sua rotina</h2></div><span className="soft-pill">{plan.hours} h/semana</span></div><label className="study-field">Carga horária semanal<select aria-label="Carga horária semanal" value={plan.hours} onChange={e=>update({hours:Number(e.target.value)})}>{[5,8,10,15,20].map(h=><option key={h} value={h}>{h} horas</option>)}</select></label><div className="study-days"><span>Dias disponíveis</span><div>{days.map(day=><label key={day}><input type="checkbox" checked={plan.days.includes(day)} onChange={()=>toggleDay(day)}/>{day}</label>)}</div></div><div className="adaptive-daily-goals" aria-label="Metas diárias recalculadas">{dailyGoals.map(goal=><div className="adaptive-daily-goal" key={goal.day}><strong>{goal.day}</strong><span>{goal.minutes} min</span><small>{goal.subjects.join(" · ")||"Sem sessão"}</small></div>)}</div><div className="study-session-list">{sessions.map(s=><label className="study-session" key={s.id}><input type="checkbox" checked={plan.done.includes(s.id)} onChange={()=>update({done:plan.done.includes(s.id)?plan.done.filter(x=>x!==s.id):[...plan.done,s.id]})}/><span><strong>{s.day} · {s.subject}</strong><small>{s.minutes} minutos · teoria, revisão e questões</small></span><small>{plan.done.includes(s.id)?"Concluído":"Pendente"}</small></label>)}</div><p className="study-disclaimer">A distribuição das atividades é uma sugestão e não substitui o edital.</p></div>
  </div>

  <React.Suspense fallback={<section className="panel simulator-panel"><p className="muted">Carregando simulados…</p></section>}>
   <SimulatorPanel key={activeUserId || "visitor"} userId={activeUserId} authClient={authClient} questionBank={simulatorQuestions} history={questionProgress.simulations} onComplete={completeSimulation}/>
  </React.Suspense>
  <React.Suspense fallback={<section className="panel official-exams-panel"><p className="muted">Carregando catálogo de provas oficiais…</p></section>}>
   <ExamSourcesPanel authClient={authClient}/>
  </React.Suspense>

  <section className="panel study-question-bank" aria-label="Banco de questões">
   <div className="panel-head">
    <div><div className="eyebrow">PRÁTICA CONTÍNUA</div><h2>Banco de questões</h2><p className="question-bank-subtitle">{allQuestions.length} questões disponíveis · {new Set(allQuestions.map(item=>item.discipline)).size} disciplinas para praticar.</p></div>
    <span className="soft-pill">{totalCorrect}/{totalAttempts} acertos · {accuracy}%</span>
   </div>
   <div className="question-bank-stats" aria-label="Estatísticas do banco de questões">
    <div className="question-stat"><strong>{uniqueAnswered}</strong><span>questões respondidas</span></div>
    <div className="question-stat"><strong>{totalAttempts}</strong><span>tentativas registradas</span></div>
    <div className="question-stat"><strong>{accuracy}%</strong><span>taxa de acerto</span></div>
   </div>
   {progressMetrics.byDiscipline.length>0&&<div className="question-discipline-metrics" aria-label="Desempenho por disciplina"><strong>Desempenho por disciplina</strong>{progressMetrics.byDiscipline.slice(0,4).map(row=><div className="question-discipline-row" key={row.discipline}><span>{row.discipline}</span><span>{row.correct}/{row.attempts} · {row.accuracy}%</span><div className="question-discipline-track"><i style={{width:row.accuracy+"%"}}/></div></div>)}</div>}
   <div className="tutor-readiness-panel" aria-label="Indicador de prontidão para prova">
    <div className="tutor-readiness-head"><div><strong>Tutor adaptativo · preparação para prova</strong><p>Estimativa de evolução baseada em desempenho, cobertura de assuntos, consistência e simulados.</p></div><div className="tutor-readiness-score"><strong>{tutorSignals.readiness}%</strong><small>prontidão estimada</small></div></div>
    <div className="tutor-readiness-track"><i style={{width:tutorSignals.readiness+"%"}}/></div>
    <div className="tutor-readiness-metrics"><span><strong>{tutorSignals.overallAccuracy}%</strong><small>acertos nos assuntos</small></span><span><strong>{tutorSignals.coverage}%</strong><small>cobertura estudada</small></span><span><strong>{tutorSignals.consistency}%</strong><small>dias ativos na semana</small></span><span><strong>{tutorSignals.simulationAccuracy}%</strong><small>simulados (indicador)</small></span></div>
    {tutorSignals.weakTopics.length>0&&<div className="tutor-weak-topics"><strong>Foco imediato</strong>{tutorSignals.weakTopics.slice(0,3).map(item=><div key={item.discipline+"::"+item.topic}><span>{item.topic}<small>{item.discipline} · {item.status} · {item.suggestedDifficulty}</small></span><b>{item.priority}</b></div>)}</div>}
    <small className="tutor-readiness-disclaimer">Indicador de preparação, não previsão nem garantia de aprovação. O tutor recomenda nível de prática; não altera a dificuldade original das questões.</small>
   </div>
   <div className="study-mastery-panel" aria-label="Mapa de domínio e revisões">
    <div className="study-mastery-heading"><div><strong>Mapa de domínio dos assuntos</strong><p>Seu desempenho define o nível de domínio e o intervalo sugerido para revisar.</p></div><span>{dueTopics.length} revisão(ões) pendente(s)</span></div>
    <div className="study-mastery-list">{topicMastery.slice(0,6).map(item=><div className="study-mastery-row" key={item.discipline+"::"+item.topic}>
     <div className="study-mastery-topic"><strong>{item.topic}</strong><small>{item.discipline} · {item.attempts} respondida(s) · {item.unanswered} pendente(s)</small></div>
     <div className="study-mastery-status"><span className={"mastery-level mastery-"+item.mastery}>{masteryLabel[item.mastery]}</span><strong>{item.accuracy}%</strong><small>{item.attempts===0?"Praticar agora":item.due?"Revisão indicada agora":"Revisar em "+item.intervalDays+" dia(s)"}</small><small className="mastery-progression">Nível liberado: {item.unlockedLevel} · sequência: {item.streak} · próximo: {item.nextLevel}</small></div>
    </div>)}</div>
   </div>
   <div className="study-weekly-panel" aria-label="Atividade dos últimos sete dias"><strong>Ritmo dos últimos 7 dias</strong><p>Questões respondidas por dia, com acertos destacados nos indicadores.</p><div className="study-weekly-bars">{weeklyStudyProgress.map(day=><div className="study-weekly-day" key={day.date}><div className="study-weekly-bar" title={day.attempts+" tentativa(s), "+day.correct+" acerto(s)"}><i style={{height:(day.attempts?Math.max(8,day.attempts/Math.max(1,...weeklyStudyProgress.map(x=>x.attempts))*100):0)+"%"}}/><b style={{height:(day.attempts?day.correct/day.attempts*100:0)+"%"}}/></div><small>{new Date(day.date+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short"}).replace(".","")}</small><em>{day.attempts}</em></div>)}</div></div>
   {studyRecommendations.length>0&&<div className="study-recommendation-panel" aria-label="Recomendações de estudo"><strong>Próximos assuntos para revisar</strong><p>Recomendações baseadas no seu histórico de respostas e questões pendentes.</p>{studyRecommendations.slice(0,4).map(item=><div className="study-recommendation-row" key={item.discipline+"::"+item.topic}><div><span>{item.topic}</span><small>{item.discipline} · {item.wrong} erro(s) · {item.unanswered} pendente(s)</small></div><div className="study-recommendation-meter"><strong>{item.accuracy}%</strong><div className="question-discipline-track"><i style={{width:item.accuracy+"%"}}/></div></div></div>)}</div>}
   <div className="question-toolbar">
    <label className="question-search">Buscar questão<input aria-label="Buscar no banco de questões" placeholder="Tema, assunto ou enunciado..." value={questionSearch} onChange={e=>setQuestionFilter(setQuestionSearch,e.target.value)}/></label>
    <label className="question-filter-field">Disciplina<select aria-label="Filtrar questões por disciplina" value={discipline} onChange={e=>setQuestionFilter(setDiscipline,e.target.value)}><option>Todas</option>{[...new Set(allQuestions.map(q=>q.discipline))].sort().map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="question-filter-field">Banca<select aria-label="Filtrar questões por estilo de banca" value={board} onChange={e=>setQuestionFilter(setBoard,e.target.value)}><option>Todas</option>{[...new Set(allQuestions.map(q=>q.board))].sort().map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="question-filter-field">Dificuldade<select aria-label="Filtrar questões por dificuldade" value={difficulty} onChange={e=>setQuestionFilter(setDifficulty,e.target.value)}><option>Todas</option>{["Fácil","Intermediária","Avançada"].map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="question-filter-field">Origem<select aria-label="Filtrar questões por origem" value={originFilter} onChange={e=>setQuestionFilter(setOriginFilter,e.target.value)}><option>Todas</option><option>EditalRadar</option><option>Provas oficiais e licenciadas</option></select></label>
   </div>
   <div className="question-sync-status" role="status">Progresso: {questionSyncStatus==="syncing"?"Salvando progresso…":questionSyncStatus==="synced"?"Progresso salvo":questionSyncStatus==="loading"?"Carregando seu progresso…":"Progresso salvo neste aparelho"}</div>
   <div className="question-collections" role="group" aria-label="Coleções de questões">
    <button type="button" className={collection==="adaptive"?"active":""} aria-pressed={collection==="adaptive"} onClick={()=>selectCollection("adaptive")}>Recomendadas <span>{collectionCounts.adaptive}</span></button>
    <button type="button" className={collection==="all"?"active":""} aria-pressed={collection==="all"} onClick={()=>selectCollection("all")}>Todas <span>{collectionCounts.all}</span></button>
    <button type="button" className={collection==="unanswered"?"active":""} aria-pressed={collection==="unanswered"} onClick={()=>selectCollection("unanswered")}>Não respondidas <span>{collectionCounts.unanswered}</span></button>
    <button type="button" className={collection==="wrong"?"active":""} aria-pressed={collection==="wrong"} onClick={()=>selectCollection("wrong")}>Caderno de erros <span>{collectionCounts.wrong}</span></button>
    <button type="button" className={collection==="saved"?"active":""} aria-pressed={collection==="saved"} onClick={()=>selectCollection("saved")}>Salvas <span>{collectionCounts.saved}</span></button>
   </div>
   {question?<div className="question-card" tabIndex={0} aria-label="Área de resolução da questão. Atalhos: números para escolher alternativa, Enter para conferir resposta.">
    <div className="question-card-heading">
     <div className="question-meta"><span>{question.discipline}</span><span>{question.origin==="exam_import"?"Prova oficial · importada":question.origin==="licensed"?"Prova real licenciada":question.origin==="generated"?"Questão autoral · revisada por IA":"Questão autoral · estilo "+question.board}</span><span>{question.origin==="licensed"||question.origin==="exam_import"?(question.examName+" · "+question.examYear):question.topic}</span><span className={"question-difficulty difficulty-"+question.difficulty.toLowerCase().replace("á","a").replace("í","i")}>{question.difficulty}</span></div>
     <button type="button" className={"question-bookmark"+(savedQuestions.has(question.id)?" saved":"")} aria-label={savedQuestions.has(question.id)?"Remover questão salva":"Salvar questão"} aria-pressed={savedQuestions.has(question.id)} onClick={toggleSavedQuestion}>{savedQuestions.has(question.id)?"★":"☆"}</button>
    </div>
    <div className="question-progress-summary"><div className="question-index">Questão {index+1} de {filtered.length}{questionAttempt?" · "+(questionAttempt.correct?"Última resposta correta":"Última resposta incorreta"):" · Ainda não respondida"}</div><span>{filtered.length?Math.round((filteredAnsweredCount/filtered.length)*100):0}% respondidas</span></div><div className="question-progress-track" role="progressbar" aria-label="Questões respondidas neste conjunto" aria-valuemin={0} aria-valuemax={filtered.length} aria-valuenow={filteredAnsweredCount}><span style={{width:(filtered.length?(filteredAnsweredCount/filtered.length)*100:0)+"%"}} /></div>
    <div className="adaptive-question-coach" aria-label="Tutor adaptativo ativo"><div><strong>🎯 Tutor adaptativo</strong><p>{adaptiveCurrent?.due?"Revisão indicada: vamos reforçar este assunto.":"Ajustando sua prática com base no histórico deste assunto."}</p></div><div className="adaptive-coach-stats"><span><small>Nível sugerido</small><b>{adaptiveCurrent?.level||question.difficulty}</b></span><span><small>Desempenho no tema</small><b>{adaptiveCurrent?.accuracy||0}%</b></span><span><small>Acertos seguidos</small><b>{consecutiveCorrect}</b></span></div><button type="button" className="detail-btn" onClick={nextAdaptiveQuestion} disabled={!filtered.some(q=>adaptiveQuestionPlan.find(p=>p.id===q.id&&q.id!==question.id))}>Seguir trilha adaptativa →</button></div>{checked&&adaptiveFeedback&&<div className="adaptive-progression-message" role="status"><strong>{adaptiveFeedback.correct?(adaptiveFeedback.progression==="progress"?"Nível recomendado aumentado!":"Bom trabalho — consolide este nível."):"Vamos recuperar este assunto antes de avançar."}</strong><span>{adaptiveFeedback.correct?"Próximo nível sugerido: "+adaptiveFeedback.nextLevel:"Nível recomendado para recuperação: "+adaptiveFeedback.nextLevel}</span></div>}<h3>{question.prompt}</h3>
    <div className="question-options" onKeyDown={event=>{if(event.target.closest("input,textarea,select"))return;if(event.altKey||event.ctrlKey||event.metaKey)return;if(/^[1-5]$/.test(event.key)){const option=question.options[Number(event.key)-1];if(option&&!checked&&!checking){event.preventDefault();setAnswer(option[1]);}}else if(event.key==="Enter"&&answer&&!checked&&!checking){event.preventDefault();check();}}}>{question.options.map(([label,value],optionIndex)=><button type="button" key={value} disabled={checked||checking} className={"option "+(answer===value&&!checked?"chosen ":"")+(checked&&answerFeedback?.correct&&answer===value?"correct":checked&&!answerFeedback?.correct&&!question.databaseId&&question.answer===value?"correct":checked&&answer===value&&!answerFeedback?.correct?"wrong":"")} aria-pressed={answer===value} onClick={()=>setAnswer(value)}><span className="option-shortcut" aria-hidden="true">{optionIndex+1}</span>{label}</button>)}</div>
    <div className="question-keyboard-hints" aria-label="Atalhos de teclado"><span>Atalhos</span><kbd>1–5</kbd> escolher alternativa <kbd>Enter</kbd> conferir resposta</div>
    <div className="question-actions">
     <button className="primary-btn" type="button" disabled={!answer||checked||checking} onClick={check}>{checking?"Corrigindo…":"Conferir resposta"}</button>
     <button className="detail-btn" type="button" disabled={index>=filtered.length-1} onClick={next}>{index>=filtered.length-1?"Última questão":"Próxima questão"}</button>
     <button className="detail-btn" type="button" onClick={randomQuestion} disabled={filtered.length<2}>Questão aleatória</button>
    </div>
    {answerFeedback?.error&&<p className="answer bad" role="alert">{answerFeedback.error}</p>}
    {checked&&<><p className={"answer "+(answerFeedback?.correct?"good":"bad")} role="status">{answerFeedback?.correct?"Resposta correta. ":"Resposta incorreta. "}{answerFeedback?.explanation}</p>{!answerFeedback?.correct&&<div className="adaptive-recovery-card"><strong>Reforço de aprendizagem</strong><p>Revise a explicação, identifique o conceito que levou ao erro e tente outra questão do mesmo assunto em nível recomendado {adaptiveCurrent?.level||"Fácil"}.</p><button type="button" className="detail-btn" onClick={nextAdaptiveQuestion}>Praticar outro exercício adaptado</button></div>}</>}
    <small className="study-disclaimer">{question.origin==="exam_import"?"Questão extraída de prova oficialmente divulgada. Fundamento registrado: "+rightsBasisLabel(question.rightsBasis)+". Fonte: "+question.sourceUrl:question.origin==="licensed"?"Questão real reproduzida sob licença/autorização registrada. Fonte: "+question.sourceUrl:"Questão autoral criada pelo EditalRadar em formato de treino. Não é questão oficial nem reprodução de prova."} Confira sempre o edital e a legislação atualizada.</small>
   </div>:<div className="question-empty"><strong>Nenhuma questão nesta seleção.</strong><p>Altere os filtros ou escolha outra coleção para continuar praticando.</p><button type="button" className="detail-btn" onClick={()=>{setDiscipline("Todas");setBoard("Todas");setDifficulty("Todas");setQuestionSearch("");setOriginFilter("Todas");selectCollection("all");}}>Limpar filtros</button></div>}
  </section>
 </section>;
}
