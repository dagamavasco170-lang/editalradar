import React, { useEffect, useMemo, useState } from "react";

const questionBank = [
  { id:"p1", discipline:"Língua Portuguesa", board:"Cebraspe", topic:"Ortografia", prompt:"Julgue: a palavra 'exceção' está grafada corretamente.", options:[["Certo","certo"],["Errado","errado"]], answer:"certo", explanation:"A grafia oficial é exceção, com ç." },
  { id:"p2", discipline:"Língua Portuguesa", board:"FGV", topic:"Concordância", prompt:"Assinale a frase com concordância adequada.", options:[["Fazem dois anos que o edital saiu.","a"],["Houveram alterações.","b"],["Faz dois anos que o edital saiu.","c"],["Existe muitas vagas.","d"]], answer:"c", explanation:"O verbo fazer, indicando tempo decorrido, é impessoal e fica no singular." },
  { id:"r1", discipline:"Raciocínio lógico", board:"Vunesp", topic:"Sequências", prompt:"Qual é o próximo número da sequência 3, 6, 12, 24?", options:[["30","a"],["36","b"],["48","c"],["54","d"]], answer:"c", explanation:"Cada termo é o dobro do anterior; 24 × 2 = 48." },
  { id:"c1", discipline:"Direito Constitucional", board:"Cebraspe", topic:"Direitos fundamentais", prompt:"Julgue: a manifestação do pensamento é livre, sendo vedado o anonimato.", options:[["Certo","certo"],["Errado","errado"]], answer:"certo", explanation:"É o que determina o art. 5º, IV, da Constituição Federal." },
  { id:"a1", discipline:"Direito Administrativo", board:"FCC", topic:"Princípios", prompt:"Quais princípios aparecem expressamente no caput do art. 37 da Constituição?", options:[["Legalidade, pessoalidade, sigilo, eficiência e hierarquia.","a"],["Legalidade, impessoalidade, moralidade, publicidade e eficiência.","b"],["Supremacia, autotutela, continuidade, motivação e proporcionalidade.","c"],["Legalidade, razoabilidade, disciplina, hierarquia e especialidade.","d"]], answer:"b", explanation:"A sigla LIMPE reúne legalidade, impessoalidade, moralidade, publicidade e eficiência." },
  { id:"i1", discipline:"Informática", board:"Vunesp", topic:"Segurança", prompt:"Mensagem fraudulenta que tenta obter senhas por link falso é exemplo de:", options:[["Phishing.","a"],["Desfragmentação.","b"],["Compactação.","c"],["Indexação.","d"]], answer:"a", explanation:"Phishing usa engenharia social para roubar credenciais e outros dados." },
  { id:"a2", discipline:"Direito Administrativo", board:"FGV", topic:"Atos administrativos", prompt:"A presunção de legitimidade dos atos administrativos significa que:", options:[["O ato nunca pode ser questionado.","a"],["O ato é considerado válido até prova em contrário.","b"],["Todo ato é discricionário.","c"],["O ato dispensa motivação em qualquer hipótese.","d"]], answer:"b", explanation:"É presunção relativa, que admite prova em contrário e controle judicial." }
];
const subjects=["Língua Portuguesa","Direito Constitucional","Raciocínio lógico","Direito Administrativo","Informática"];
const days=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
const storageKey=(userId)=>"er-study-plan:"+(userId||"visitor");
const focusStorageKey=(userId)=>"er-focus-sessions:"+(userId||"visitor");
const loadFocusSessions=(userId)=>{
 try { const value=Number(localStorage.getItem(focusStorageKey(userId))||0); return Number.isFinite(value)&&value>0?Math.floor(value):0; }
 catch { return 0; }
};
const formatClock=(seconds)=>String(Math.floor(seconds/60)).padStart(2,"0")+":"+String(seconds%60).padStart(2,"0");

const loadPlan=(userId)=>{
 try {
  const value=JSON.parse(localStorage.getItem(storageKey(userId))||"{}");
  return {hours:[5,8,10,15,20].includes(Number(value.hours))?Number(value.hours):10,days:Array.isArray(value.days)&&value.days.length?value.days:days.slice(0,5),done:Array.isArray(value.done)?value.done:[]};
 } catch { return {hours:10,days:days.slice(0,5),done:[]}; }
};
export default function StudyArea({selected,tasks,progress,onToggleTask,onBackDetails,onClearFocus,userId}) {
 const [plan,setPlan]=useState(()=>loadPlan(userId));
 const [discipline,setDiscipline]=useState("Todas");
 const [board,setBoard]=useState("Todas");
 const [index,setIndex]=useState(0);
 const [answer,setAnswer]=useState("");
 const [checked,setChecked]=useState(false);
 const [stats,setStats]=useState({answered:0,correct:0});
 const [timerMinutes,setTimerMinutes]=useState(25);
 const [timerRemaining,setTimerRemaining]=useState(25*60);
 const [timerRunning,setTimerRunning]=useState(false);
 const [focusSessions,setFocusSessions]=useState(()=>loadFocusSessions(userId));
 const [timerNotice,setTimerNotice]=useState("");

 useEffect(()=>setPlan(loadPlan(userId)),[userId]);
 useEffect(()=>{
  setTimerRunning(false);
  setTimerRemaining(timerMinutes*60);
  setFocusSessions(loadFocusSessions(userId));
  setTimerNotice("");
 },[userId]);
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
  try{localStorage.setItem(focusStorageKey(userId),String(nextCount));}catch{}
  setTimerNotice("Sessão concluída! Faça uma pausa e volte com energia.");
 },[timerRunning,timerRemaining,userId]);

 useEffect(()=>{try{localStorage.setItem(storageKey(userId),JSON.stringify(plan));}catch{}},[plan,userId]);
 const filtered=useMemo(()=>questionBank.filter(q=>(discipline==="Todas"||q.discipline===discipline)&&(board==="Todas"||q.board===board)),[discipline,board]);
 const question=filtered.length?filtered[index%filtered.length]:null;
 const sessions=useMemo(()=>{
  const chosen=plan.days.filter(day=>days.includes(day));
  const count=chosen.length||1, total=plan.hours*60, base=Math.floor(total/count), rem=total%count;
  const preferred=/pol[ií]cia|bombeiro|tribunal|procurador/i.test((selected?.cargo||"")+" "+(selected?.orgao||""))
   ? ["Direito Constitucional","Língua Portuguesa","Raciocínio lógico","Direito Administrativo","Informática"]
   : /auditor|controle|fiscal|analista/i.test((selected?.cargo||"")+" "+(selected?.orgao||""))
    ? ["Direito Administrativo","Língua Portuguesa","Direito Constitucional","Raciocínio lógico","Informática"]
    : subjects;
  return chosen.map((day,i)=>{const subject=preferred[i%preferred.length];const slug=subject.toLowerCase().replace(/[^a-z0-9]+/g,"-");return {id:day+"-"+slug,day,subject,minutes:base+(i<rem?1:0)};});
 },[plan,selected]);
 const update=(patch)=>setPlan(current=>({...current,...patch}));
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
 const check=()=>{if(!question||!answer||checked)return;setChecked(true);setStats(s=>({answered:s.answered+1,correct:s.correct+(answer===question.answer?1:0)}));};
 const next=()=>{setIndex(i=>(i+1)%Math.max(filtered.length,1));setAnswer("");setChecked(false);};
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
    <div className="focus-timer-summary"><strong>{focusSessions}</strong><span>sessões concluídas nesta conta e neste dispositivo</span></div>
    {timerNotice&&<p className="focus-timer-notice" role="status">{timerNotice}</p>}
   </div>
  </section>
  <div className="study-grid">
   <div className="panel progress-panel"><div className="panel-head"><div><div className="eyebrow">VISÃO GERAL</div><h2>Seu progresso diário</h2></div><span className="soft-pill">Hoje</span></div><div className="progress-number">{progress}%</div><div className="progress-track"><div style={{width:progress+"%"}}/></div><p className="muted">{tasks.filter(Boolean).length} de {tasks.length} atividades concluídas</p><div className="task-list">{["Revisar português","Resolver 10 questões","Estudar direito constitucional","Fazer uma revisão rápida"].map((task,i)=><label className="task" key={task}><input type="checkbox" checked={Boolean(tasks[i])} onChange={()=>onToggleTask(i)}/><span className={tasks[i]?"task-done":""}>{task}</span><small>{[25,30,40,15][i]} min</small></label>)}</div></div>
   <div className="panel study-plan-panel"><div className="panel-head"><div><div className="eyebrow">PLANEJAMENTO SEMANAL</div><h2>Monte sua rotina</h2></div><span className="soft-pill">{plan.hours} h/semana</span></div><label className="study-field">Carga horária semanal<select aria-label="Carga horária semanal" value={plan.hours} onChange={e=>update({hours:Number(e.target.value)})}>{[5,8,10,15,20].map(h=><option key={h} value={h}>{h} horas</option>)}</select></label><div className="study-days"><span>Dias disponíveis</span><div>{days.map(day=><label key={day}><input type="checkbox" checked={plan.days.includes(day)} onChange={()=>toggleDay(day)}/>{day}</label>)}</div></div><div className="study-session-list">{sessions.map(s=><label className="study-session" key={s.id}><input type="checkbox" checked={plan.done.includes(s.id)} onChange={()=>update({done:plan.done.includes(s.id)?plan.done.filter(x=>x!==s.id):[...plan.done,s.id]})}/><span><strong>{s.day} · {s.subject}</strong><small>{s.minutes} minutos · teoria, revisão e questões</small></span><small>{plan.done.includes(s.id)?"Concluído":"Pendente"}</small></label>)}</div><p className="study-disclaimer">Plano salvo neste dispositivo e separado por conta. A distribuição é sugestiva e não substitui o edital.</p></div>
  </div>
  <section className="panel study-question-bank" aria-label="Banco de questões autorais"><div className="panel-head"><div><div className="eyebrow">PRÁTICA CONTÍNUA</div><h2>Banco de questões</h2></div><span className="soft-pill">{stats.correct}/{stats.answered} acertos na sessão</span></div><div className="question-filters"><label>Disciplina<select aria-label="Filtrar questões por disciplina" value={discipline} onChange={e=>{setDiscipline(e.target.value);setIndex(0);setAnswer("");setChecked(false);}}><option>Todas</option>{[...new Set(questionBank.map(q=>q.discipline))].sort().map(x=><option key={x}>{x}</option>)}</select></label><label>Estilo de banca<select aria-label="Filtrar questões por estilo de banca" value={board} onChange={e=>{setBoard(e.target.value);setIndex(0);setAnswer("");setChecked(false);}}><option>Todas</option>{[...new Set(questionBank.map(q=>q.board))].sort().map(x=><option key={x}>{x}</option>)}</select></label></div>
   {question?<div className="question-card"><div className="question-meta"><span>{question.discipline}</span><span>Formato inspirado em {question.board}</span><span>{question.topic}</span></div><h3>{question.prompt}</h3><div className="question-options">{question.options.map(([label,value])=><button type="button" key={value} disabled={checked} className={"option "+(answer===value?"chosen ":"")+(checked&&value===question.answer?"correct":checked&&answer===value?"wrong":"")} onClick={()=>setAnswer(value)}>{label}</button>)}</div><div className="question-actions"><button className="primary-btn" type="button" disabled={!answer||checked} onClick={check}>Conferir resposta</button><button className="detail-btn" type="button" onClick={next}>Próxima questão</button></div>{checked&&<p className={"answer "+(answer===question.answer?"good":"bad")}>{answer===question.answer?"Resposta correta. ":"Resposta incorreta. "}{question.explanation}</p>}<small className="study-disclaimer">Questões autorais de treino em formato inspirado nas bancas indicadas. Não são questões oficiais nem reproduções de provas.</small></div>:<p className="muted">Nenhuma questão encontrada para esses filtros.</p>}
  </section>
 </section>;
}
