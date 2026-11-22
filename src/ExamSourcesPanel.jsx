import React,{useEffect,useMemo,useState} from "react";
import { isTrustedOfficialUrl } from "./lib/official-sources.js";

const fallbackSources=[
{id:"cebraspe-trego-2008",board:"Cebraspe",exam_name:"TRE/GO — Analista Judiciário — Caderno A",exam_year:2008,discipline:"Diversas disciplinas",role_name:"Analista Judiciário — Área Administrativa",source_url:"https://cdn.cebraspe.org.br/concursos/TRE_GO2008/",exam_url:"https://cdn.cebraspe.org.br/concursos/TRE_GO2008/arquivos/TREGO_CARGO_01_CADERNO_A.pdf",answer_key_url:"https://cdn.cebraspe.org.br/concursos/TRE_GO2008/arquivos/TREGO08_Gab_Definitivo_001_1.PDF",notes:"Caderno e gabarito definitivo publicados no arquivo oficial do Cebraspe."},
{id:"cebraspe-trego-omega-2008",board:"Cebraspe",exam_name:"TRE/GO — Caderno OMEGA",exam_year:2008,discipline:"Diversas disciplinas",role_name:"Analista/Técnico Judiciário",source_url:"https://cdn.cebraspe.org.br/concursos/TRE_GO2008/",answer_key_url:"https://cdn.cebraspe.org.br/concursos/TRE_GO2008/arquivos/TREGO08_Gab_Definitivo_012_16.PDF",notes:"Página oficial disponibiliza vários cadernos e gabaritos definitivos."},
{id:"cebraspe-pcma-2017",board:"Cebraspe",exam_name:"Polícia Civil do Maranhão — Delegado",exam_year:2017,discipline:"Direito",role_name:"Delegado de Polícia",source_url:"https://cdn.cebraspe.org.br/concursos/PC_MA_17_DELEGADO/",exam_url:"https://cdn.cebraspe.org.br/concursos/PC_MA_17_DELEGADO/arquivos/372_PCMADELEGADO_001_01.PDF",notes:"Página oficial lista caderno de provas e gabarito definitivo."},
{id:"fgv-tjce-2025",board:"FGV",exam_name:"Tribunal de Justiça do Ceará — Juiz Substituto — Tipo 1",exam_year:2025,discipline:"Direito",role_name:"Juiz Substituto",source_url:"https://conhecimento.fgv.br/concursos/tjce25",exam_url:"https://conhecimento.fgv.br/sites/default/files/concursos/juiz-substituto-cns001-tipo-1.pdf",answer_key_url:"https://conhecimento.fgv.br/sites/default/files/concursos/gabarito-definitivo.pdf",notes:"Prova objetiva de 100 questões e gabarito definitivo na página oficial."},
{id:"fgv-tjto-2025",board:"FGV",exam_name:"Tribunal de Justiça do Tocantins — Juiz Substituto — Tipo 1",exam_year:2025,discipline:"Direito",role_name:"Juiz Substituto",source_url:"https://conhecimento.fgv.br/concursos/tjto25",exam_url:"https://conhecimento.fgv.br/sites/default/files/concursos/tjto-t1.pdf",answer_key_url:"https://conhecimento.fgv.br/sites/default/files/concursos/gabarito-definitivo-tj-to.pdf",notes:"Prova objetiva e gabarito definitivo publicados na página oficial."},
{id:"fgv-trf3-2025",board:"FGV",exam_name:"Tribunal Regional Federal da 3ª Região — Juiz Federal — Tipo A101",exam_year:2025,discipline:"Direito",role_name:"Juiz Federal Substituto",source_url:"https://conhecimento.fgv.br/concursos/trf3juiz",exam_url:"https://conhecimento.fgv.br/sites/default/files/concursos/a101.pdf",answer_key_url:"https://conhecimento.fgv.br/sites/default/files/concursos/juiz-federal-substituto-e-juiza-federal-substituta-da-3a-regiao-gabaritos-preliminares-retificado.pdf",notes:"Página oficial lista provas e gabaritos; confira se houve publicação posterior de gabarito definitivo."},
{id:"vunesp-pmes-2026",board:"Vunesp",exam_name:"Polícia Militar de São Paulo — Aluno-Soldado",exam_year:2026,discipline:"Diversas disciplinas",role_name:"Aluno-Soldado PM do Quadro de Praças",source_url:"https://www.vunesp.com.br/PMES2601",notes:"Página oficial informa a publicação do caderno e do gabarito; consulte a seção de documentos."},
{id:"cebraspe-pgeal-2008",board:"Cebraspe",exam_name:"Procuradoria-Geral do Estado de Alagoas — Procurador",exam_year:2008,discipline:"Direito",role_name:"Procurador do Estado",source_url:"https://cdn.cebraspe.org.br/concursos/PGE_AL2008/",notes:"Página oficial arquivada com cadernos e acesso ao gabarito/folha de respostas."}
];
const secureUrl=url=>isTrustedOfficialUrl(url);

export default function ExamSourcesPanel({authClient}){
 const [sources,setSources]=useState(fallbackSources);
 const [search,setSearch]=useState("");
 const [board,setBoard]=useState("Todas");
 const [status,setStatus]=useState("fallback");
 useEffect(()=>{
  if(!authClient)return undefined;
  let cancelled=false;
  const loadSources = async () => {
   try {
    const {data,error}=await authClient.from("study_exam_sources")
     .select("id,board,exam_name,exam_year,discipline,role_name,source_url,exam_url,answer_key_url,notes")
     .eq("published",true).order("exam_year",{ascending:false});
    if(error)throw error;
    if(cancelled)return;
    if(Array.isArray(data)){setSources(data.length?data:fallbackSources);setStatus("ready");}
   } catch {
    if(!cancelled){setSources(fallbackSources);setStatus("fallback");}
   }
  };
  void loadSources();
  return()=>{cancelled=true;};
 },[authClient]);
 const filtered=useMemo(()=>sources.filter(item=>
  (board==="Todas"||item.board===board)&&
  (item.exam_name+" "+(item.role_name||"")+" "+(item.discipline||"")+" "+item.exam_year).toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))
 ),[sources,board,search]);
 return <section className="panel official-exams-panel" aria-label="Provas reais oficiais">
  <div className="panel-head"><div><div className="eyebrow">ARQUIVOS DAS BANCAS</div><h2>Provas reais e gabaritos oficiais</h2><p className="question-bank-subtitle">Cadernos originais nos sites das organizadoras, sem cópia não autorizada.</p><a className="pci-source-link" href="https://www.pciconcursos.com.br/concursos/" target="_blank" rel="noopener noreferrer">Acompanhar concursos no PCI Concursos ↗</a></div><span className="soft-pill">{sources.length} fontes</span></div>
  <div className="official-exams-toolbar"><label>Buscar prova<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Órgão, cargo, ano ou disciplina" aria-label="Buscar provas oficiais"/></label><label>Banca<select value={board} onChange={e=>setBoard(e.target.value)} aria-label="Filtrar provas oficiais por banca"><option>Todas</option>{[...new Set(sources.map(item=>item.board))].sort().map(item=><option key={item}>{item}</option>)}</select></label></div>
  {filtered.length?<div className="official-exam-list">{filtered.map(item=><article className="official-exam-card" key={item.id}><div className="official-exam-meta"><span>{item.board}</span><span>{item.exam_year}</span><span>{item.discipline||"Diversas disciplinas"}</span></div><h3>{item.exam_name}</h3>{item.role_name&&<p>{item.role_name}</p>}{item.notes&&<small>{item.notes}</small>}<div className="official-exam-actions">{secureUrl(item.exam_url)?<a href={item.exam_url} target="_blank" rel="noopener noreferrer">Abrir caderno de prova ↗</a>:<a href={item.source_url} target="_blank" rel="noopener noreferrer">Localizar prova oficial ↗</a>}{secureUrl(item.answer_key_url)&&<a href={item.answer_key_url} target="_blank" rel="noopener noreferrer">Abrir gabarito ↗</a>}{secureUrl(item.source_url)&&<a className="official-source-secondary" href={item.source_url} target="_blank" rel="noopener noreferrer">Página da banca ↗</a>}</div></article>)}</div>:<div className="question-empty"><strong>Nenhuma prova encontrada.</strong><p>Altere o texto ou a banca selecionada.</p></div>}
  <p className="study-disclaimer">Arquivos abrem nos domínios oficiais das bancas. A disponibilidade e a versão do gabarito podem mudar; confira retificações e anulações na página de origem. {status==="fallback"?"Catálogo local de fontes oficiais.":"Catálogo atualizado pelo banco do EditalRadar."}</p>
 </section>;
}
