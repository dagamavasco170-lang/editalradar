import React, { useCallback, useEffect, useRef, useState } from "react";
import { clearActiveSimulation, loadActiveSimulation, remainingSimulationSeconds, saveActiveSimulation } from "./lib/simulator-progress.js";

const shuffle = (items) => {
  const result=[...items];
  for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
};
const clock = seconds => String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");

export default function SimulatorPanel({questionBank,history=[],onComplete,userId=null,authClient=null}) {
  const [initialRun] = useState(() => loadActiveSimulation(userId, questionBank));
  const [size,setSize]=useState(initialRun?.questions.length || 20);
  const [minutes,setMinutes]=useState(initialRun?.durationMinutes || 40);
  const [run,setRun]=useState(initialRun);
  const [remaining,setRemaining]=useState(() => initialRun ? remainingSimulationSeconds(initialRun.deadlineAt) : 40*60);
  const [result,setResult]=useState(null);
  const [reviewOpen,setReviewOpen]=useState(false);
  const [finishing,setFinishing]=useState(false);
  const [finishError,setFinishError]=useState("");
  const finishLock=useRef(false);
  const current=run?.questions?.[run.currentIndex]||null;
  const answered=run?Object.keys(run.answers).length:0;

  const finish=useCallback(async(reason="manual")=>{
    if(!run||run.finished||finishLock.current)return;
    finishLock.current=true;
    setFinishing(true);
    setFinishError("");
    try{
      const review=[];
      const batchSize=8;
      for(let offset=0;offset<run.questions.length;offset+=batchSize){
        const batch=run.questions.slice(offset,offset+batchSize);
        const checked=await Promise.all(batch.map(async question=>{
          const selected=run.answers[question.id]||"";
          if(question.databaseId){
            if(!selected)return {questionId:question.id,discipline:question.discipline,topic:question.topic,selected,answer:null,correct:false,explanation:"Questão não respondida."};
            if(!authClient?.rpc)throw new Error("Entre na sua conta para corrigir esta questão.");
            const {data,error}=await authClient.rpc("check_study_question_answer",{
              p_question_id:question.databaseId,p_selected_answer:selected
            });
            if(error)throw error;
            if(!data||typeof data.correct!=="boolean")throw new Error("Não foi possível corrigir uma das respostas. Confira sua conexão e tente novamente.");
            return {questionId:question.id,discipline:question.discipline,topic:question.topic,selected,answer:null,correct:data.correct,explanation:data.explanation||""};
          }
          return {questionId:question.id,discipline:question.discipline,topic:question.topic,selected,answer:question.answer,correct:Boolean(selected)&&selected===question.answer,explanation:question.explanation||""};
        }));
        review.push(...checked);
      }
      const correct=review.filter(item=>item.correct).length;
      const byDiscipline=[...new Set(review.map(item=>item.discipline))].map(discipline=>{
        const rows=review.filter(item=>item.discipline===discipline), hits=rows.filter(item=>item.correct).length;
        return {discipline,correct:hits,total:rows.length,percentage:Math.round(hits/rows.length*100)};
      }).sort((a,b)=>a.percentage-b.percentage||a.discipline.localeCompare(b.discipline,"pt-BR"));
      const completedAt=new Date().toISOString();
      const summary={id:run.id,questionIds:run.questions.map(question=>question.id),answers:{...run.answers},correct,total:review.length,percentage:Math.round(correct/review.length*100),byDiscipline,startedAt:run.startedAt,completedAt,durationSeconds:Math.max(0,run.durationMinutes*60-remaining),finishReason:reason,review};
      setRun(currentRun=>currentRun?.id===run.id?{...currentRun,finished:true}:currentRun);
      setResult(summary);
      setReviewOpen(false);
      onComplete?.(summary);
    }catch(error){
      setFinishError("Não foi possível corrigir o simulado. Confira sua conexão e tente novamente.");
    }finally{
      finishLock.current=false;
      setFinishing(false);
    }
  },[run,remaining,onComplete,authClient]);

  useEffect(()=>{
    if(!run||run.finished){clearActiveSimulation(userId);return undefined;}
    saveActiveSimulation(userId,run);
    return undefined;
  },[run,userId]);

  useEffect(()=>{
    if(!run||run.finished)return undefined;
    const tick=()=>setRemaining(remainingSimulationSeconds(run.deadlineAt));
    tick();
    const id=window.setInterval(tick,1000);
    return ()=>window.clearInterval(id);
  },[run?.id,run?.deadlineAt,run?.finished]);
  useEffect(()=>{
    if(run&&!run.finished&&remaining===0&&!finishing&&!finishError)void finish("time");
  },[run,remaining,finish,finishing,finishError]);

  const start=()=>{
    if(questionBank.length<size)return;
    const duration=Math.max(size,minutes);
    const startedAt=new Date();
    const deadlineAt=new Date(startedAt.getTime()+duration*60*1000).toISOString();
    setMinutes(duration);setRemaining(duration*60);setResult(null);setReviewOpen(false);setFinishError("");
    setRun({id:"sim-"+Date.now(),questions:shuffle(questionBank).slice(0,size),answers:{},currentIndex:0,startedAt:startedAt.toISOString(),deadlineAt,durationMinutes:duration,finished:false});
  };
  const setAnswer=value=>{
    if(!run||run.finished||!current||finishing)return;
    setRun(old=>({...old,answers:{...old.answers,[current.id]:value}}));
  };
  const reset=()=>{clearActiveSimulation(userId);setRun(null);setResult(null);setRemaining(minutes*60);setReviewOpen(false);setFinishError("");};

  return <section className="panel simulator-panel" aria-label="Simulados completos">
    <div className="panel-head"><div><div className="eyebrow">TREINO EM CONDIÇÕES DE PROVA</div><h2>Simulados completos</h2><p className="question-bank-subtitle">Questões autorais sorteadas sem repetição dentro de cada prova.</p><small className="question-bank-subtitle">Banco atual: {questionBank.length} questões autorais disponíveis para simulados.</small></div><span className="soft-pill">20 · 40 · 80 questões</span></div>
    {initialRun&&run&&!run.finished&&<p className="simulator-warning" role="status">Simulado em andamento recuperado. Suas respostas, posição e tempo restante foram restaurados.</p>}
    {!run&&!result&&<div className="simulator-setup">
      <div className="simulator-size-options" role="group" aria-label="Quantidade de questões">
        {[20,40,80].map(value=><button type="button" key={value} className={size===value?"active":""} aria-pressed={size===value} disabled={questionBank.length<value} onClick={()=>{setSize(value);setMinutes(value*2);}}><strong>{value}</strong><span>questões</span></button>)}
      </div>
      <label className="simulator-time-field">Tempo de prova<select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>{[size,size*1.5,size*2,size*2.5,size*3].map(value=><option key={value} value={value}>{value} minutos</option>)}</select></label>
      <div className="simulator-setup-footer"><p>O simulado mistura questões autorais, incluindo as novas questões revisadas do banco, embaralha a ordem e não mostra o gabarito durante a prova.</p><button type="button" className="primary-btn" onClick={start} disabled={questionBank.length<size}>Iniciar simulado</button></div>
      <small className="study-disclaimer">As respostas corretas só são exibidas depois que você finalizar o simulado.</small>
    </div>}
    {run&&!run.finished&&current&&<div className="simulator-running">
      <div className="simulator-livebar"><div><small>PROGRESSO</small><strong>{answered} de {run.questions.length} respondidas</strong></div><div className="simulator-clock" role="timer" aria-label={"Tempo restante "+clock(remaining)}><strong>{clock(remaining)}</strong><small>restantes</small></div></div>
      <div className="simulator-time-track"><span style={{width:Math.max(0,remaining/(minutes*60)*100)+"%"}}/></div>
      <div className="simulator-question-layout">
        <div className="simulator-question-main"><div className="question-meta"><span>{current.discipline}</span><span>{current.topic}</span><span>Questão {run.currentIndex+1} de {run.questions.length}</span></div>
          <h3>{current.prompt}</h3>
          <div className="question-options">{current.options.map(([label,value])=><button type="button" key={value} disabled={finishing} className={"option "+(run.answers[current.id]===value?"chosen":"")} onClick={()=>setAnswer(value)}>{label}</button>)}</div>
          <div className="simulator-navigation"><button type="button" className="detail-btn" disabled={run.currentIndex===0||finishing} onClick={()=>setRun(old=>({...old,currentIndex:old.currentIndex-1}))}>Anterior</button><button type="button" className="detail-btn" disabled={run.currentIndex===run.questions.length-1||finishing} onClick={()=>setRun(old=>({...old,currentIndex:old.currentIndex+1}))}>Próxima</button><button type="button" className="primary-btn" disabled={finishing} onClick={()=>void finish("manual")}>{finishing?"Corrigindo…":finishError?"Tentar corrigir novamente":"Finalizar e corrigir"}</button></div>
          {finishError&&<p className="answer bad" role="alert">{finishError}</p>}
        </div>
        <aside className="simulator-question-map" aria-label="Navegação pelas questões"><strong>Ir para questão</strong><div>{run.questions.map((question,index)=><button type="button" key={question.id} disabled={finishing} className={(index===run.currentIndex?"current ":"")+(run.answers[question.id]?"answered":"")} aria-label={"Ir para questão "+(index+1)} aria-current={index===run.currentIndex?"step":undefined} onClick={()=>setRun(old=>({...old,currentIndex:index}))}>{index+1}</button>)}</div><small>{run.questions.length-answered} sem resposta</small></aside>
      </div><p className="simulator-warning">O cronômetro continua durante a navegação. Ao zerar, a prova é encerrada automaticamente.</p>
    </div>}
    {result&&<div className="simulator-result" aria-label="Resultado do simulado">
      <div className="simulator-result-hero"><div><div className="eyebrow">SIMULADO CONCLUÍDO</div><h3>{result.correct} de {result.total} acertos</h3><p>{result.finishReason==="time"?"Tempo encerrado automaticamente.":"Prova finalizada."} · {clock(result.durationSeconds)} de duração</p></div><div className="simulator-score"><strong>{result.percentage}%</strong><span>aproveitamento</span></div></div>
      <div className="simulator-discipline-results">{result.byDiscipline.map(item=><div key={item.discipline}><div><strong>{item.discipline}</strong><span>{item.correct}/{item.total} · {item.percentage}%</span></div><div className="progress-track"><div style={{width:item.percentage+"%"}}/></div></div>)}</div>
      <div className="simulator-result-actions"><button type="button" className="primary-btn" onClick={()=>setReviewOpen(value=>!value)}>{reviewOpen?"Ocultar correção":"Revisar questões e comentários"}</button><button type="button" className="detail-btn" onClick={reset}>Novo simulado</button></div>
      {reviewOpen&&<div className="simulator-review">{result.review.map((item,index)=><article key={item.questionId} className="simulator-review-item"><div><strong>Questão {index+1} · {item.discipline}</strong><span className={item.correct?"review-correct":"review-wrong"}>{item.correct?"Acertou":item.selected?"Errou":"Não respondida"}</span></div><p>{item.topic}</p><small>Sua resposta: {item.selected?item.selected.toUpperCase():"Em branco"} · {item.answer?"Gabarito: "+item.answer.toUpperCase():item.selected?"Gabarito não exibido":"Sem resposta selecionada"}</small><p>{item.explanation}</p></article>)}</div>}
    </div>}
    {history.length>0&&<div className="simulator-history"><strong>Histórico de simulados</strong><div>{[...history].reverse().slice(0,4).map(item=><article key={item.id}><span>{item.total} questões</span><strong>{item.percentage}%</strong><small>{item.completedAt?new Date(item.completedAt).toLocaleDateString("pt-BR"):"Data não informada"} · {item.correct}/{item.total} acertos</small></article>)}</div></div>}
  </section>;
}
