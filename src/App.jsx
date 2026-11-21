import React, { useMemo, useState } from "react";
import { concursos, materias, sourceUrl, sourceUpdated, fetchedAt } from "./data/concursos";

const readStore = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export default function App() {
  const [page, setPage] = useState("concursos");
  const [query, setQuery] = useState("");
  const [nivel, setNivel] = useState("Todos os níveis");
  const [favorites, setFavorites] = useState(() => readStore("er-favorites", []));
  const [tasks, setTasks] = useState(() => readStore("er-tasks", [false, false, false, false]));
  const [selected, setSelected] = useState(null);
  const [answer, setAnswer] = useState("");
  const [checkedAnswer, setCheckedAnswer] = useState(false);

  const filtered = useMemo(() => concursos.filter((item) => {
    const text = [item.cargo, item.orgao, item.vinculo, item.atoOficial, item.nivel].join(" ").toLowerCase();
    return text.includes(query.toLowerCase())
      && (nivel === "Todos os níveis" || item.nivel === nivel);
  }), [query, nivel]);

  const saveFavorites = (next) => {
    setFavorites(next);
    localStorage.setItem("er-favorites", JSON.stringify(next));
  };
  const toggleFavorite = (id) => {
    saveFavorites(favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id]);
  };
  const toggleTask = (index) => {
    const next = tasks.map((done, i) => i === index ? !done : done);
    setTasks(next);
    localStorage.setItem("er-tasks", JSON.stringify(next));
  };
  const progress = Math.round(tasks.filter(Boolean).length / tasks.length * 100);
  const totalVagas = concursos.reduce((sum, item) => sum + (Number(item.vagas) || 0), 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setPage("concursos")}>
          <span className="brand-mark">E</span>
          <span>Edital<span className="brand-light">Radar</span><small>SEU PRÓXIMO PASSO</small></span>
        </a>
        <div className="side-label">MENU PRINCIPAL</div>
        <button className={page === "concursos" ? "nav-item active" : "nav-item"} onClick={() => setPage("concursos")}><span>▦</span> Concursos</button>
        <button className={page === "estudos" ? "nav-item active" : "nav-item"} onClick={() => setPage("estudos")}><span>◷</span> Área de estudos</button>
        <button className={page === "favoritos" ? "nav-item active" : "nav-item"} onClick={() => setPage("favoritos")}><span>♡</span> Meus favoritos <b>{favorites.length}</b></button>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">✦</span><strong>Seu futuro começa com planejamento.</strong><p>Organize sua preparação e acompanhe suas oportunidades.</p><button onClick={() => setPage("estudos")}>Ver meu plano →</button></div>
          <div className="profile"><div className="avatar">C</div><div><strong>Concurseiro</strong><small>Plano gratuito</small></div><span className="dots">•••</span></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">Início <span>/</span> {page === "concursos" ? "Concursos" : page === "estudos" ? "Área de estudos" : "Meus favoritos"}</div>
          <div className="top-actions"><span className="date-chip">◷ &nbsp;Sua jornada começa hoje</span><div className="mini-avatar">C</div></div>
        </header>

        {page === "estudos" ? (
          <section className="content">
            <div className="eyebrow">SUA ROTINA, SEU RITMO</div>
            <h1>Área de estudos</h1>
            <p className="subhead">Pequenos passos todos os dias constroem grandes aprovações.</p>
            <div className="study-grid">
              <div className="panel progress-panel"><div className="panel-head"><div><div className="eyebrow">VISÃO GERAL</div><h2>Seu progresso diário</h2></div><span className="soft-pill">Hoje</span></div>
                <div className="progress-number">{progress}%</div><div className="progress-track"><div style={{ width: progress + "%" }} /></div><p className="muted">{tasks.filter(Boolean).length} de {tasks.length} atividades concluídas</p>
                <div className="task-list">{["Revisar português","Resolver 10 questões","Estudar direito constitucional","Fazer uma revisão rápida"].map((task, i) => <label className="task" key={task}><input type="checkbox" checked={tasks[i]} onChange={() => toggleTask(i)} /><span className={tasks[i] ? "task-done" : ""}>{task}</span><small>{i === 0 ? "25 min" : i === 1 ? "30 min" : i === 2 ? "40 min" : "15 min"}</small></label>)}</div>
              </div>
              <div className="panel question-panel"><div className="eyebrow">QUESTÃO DO DIA</div><span className="question-tag">PORTUGUÊS · DEMONSTRAÇÃO</span><h2>Qual alternativa apresenta uma palavra escrita corretamente?</h2>
                {["Excessão","Exceção","Esceção","Excesssão"].map((option) => <button key={option} className={"option " + (answer === option ? "chosen " : "") + (checkedAnswer && option === "Exceção" ? "correct" : checkedAnswer && answer === option ? "wrong" : "")} onClick={() => { setAnswer(option); setCheckedAnswer(false); }}>{option}</button>)}
                <button className="primary-btn full" disabled={!answer} onClick={() => setCheckedAnswer(true)}>Conferir resposta</button>
                {checkedAnswer && <p className={answer === "Exceção" ? "answer good" : "answer bad"}>{answer === "Exceção" ? "Muito bem! Você acertou." : "A resposta correta é Exceção. Continue praticando!"}</p>}
              </div>
            </div>
            <div className="panel subjects"><div className="panel-head"><div><div className="eyebrow">ORGANIZE SUA PREPARAÇÃO</div><h2>Matérias para acompanhar</h2></div><span className="muted">Sugestões iniciais</span></div><div className="subject-grid">{materias.map((m) => <div className="subject" key={m.nome}><span>{m.icon}</span><div><strong>{m.nome}</strong><small>{m.descricao}</small></div><span className="subject-arrow">↗</span></div>)}</div></div>
          </section>
        ) : (
          <section className="content">
            <div className="hero">
              <div><div className="eyebrow light">FONTES OFICIAIS · GOVERNO FEDERAL</div><h1>Encontre concursos<br/>com informação verificada.</h1><p>Acompanhe autorizações, editais publicados e etapas de seleções federais.</p>
                <div className="hero-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cargo, órgão ou palavra-chave..." /><button onClick={() => setPage("concursos")}>Buscar concursos</button></div>
              </div>
              <div className="hero-art"><div className="art-circle">✦</div><div className="art-card"><span>✧</span><strong>Seu esforço<br/>vai valer a pena.</strong><small>Um dia de cada vez.</small></div></div>
            </div>
            <div className="source-notice">
              <div><strong>Confira a etapa de cada seleção.</strong><p>“Autorizado” significa que o órgão pode avançar para as próximas etapas. Edital publicado e inscrições encerradas são situações diferentes — veja o status e consulte a fonte oficial de cada concurso.</p></div>
              <a href={sourceUrl} target="_blank" rel="noreferrer">Consultar orientações do MGI ↗</a>
            </div>
            <div className="stats-row">
              <div className="stat"><span className="stat-icon blue">▦</span><div><strong>{concursos.length}</strong><small>Oportunidades verificadas</small></div></div>
              <div className="stat"><span className="stat-icon green">⌁</span><div><strong>{new Intl.NumberFormat("pt-BR").format(totalVagas)}</strong><small>Vagas deste recorte</small></div></div>
              <div className="stat"><span className="stat-icon gold">☆</span><div><strong>{favorites.length}</strong><small>Oportunidades salvas</small></div></div>
            </div>
            <div className="section-title"><div><div className="eyebrow">ACOMPANHAMENTO FEDERAL</div><h2>{page === "favoritos" ? "Seus concursos favoritos" : "Concursos com fontes oficiais"}</h2></div><span className="results">{(page === "favoritos" ? filtered.filter(c => favorites.includes(c.id)) : filtered).length} registros</span></div>
            <div className="filters">
              <label className="search-filter"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cargo ou órgão..." /></label>
              <select value={nivel} onChange={(e) => setNivel(e.target.value)}><option>Todos os níveis</option>{[...new Set(concursos.map(c => c.nivel))].map(x => <option key={x}>{x}</option>)}</select>
            </div>
            <div className="cards">
              {(page === "favoritos" ? filtered.filter(c => favorites.includes(c.id)) : filtered).map((item) => <article className="contest-card" key={item.id}>
                <div className="card-top"><div className="org-icon">{item.sigla}</div><button className={favorites.includes(item.id) ? "heart saved" : "heart"} onClick={() => toggleFavorite(item.id)} aria-label="Salvar favorito">{favorites.includes(item.id) ? "♥" : "♡"}</button></div>
                <span className="status"><i />{item.status}</span><h3>{item.cargo}</h3><p className="org-name">{item.orgao}</p>
                <div className="card-meta"><span>⌁ {item.vagas} vaga(s) autorizada(s)</span><span>▤ {item.nivel}</span></div>
                <div className="card-bottom"><div><small>Ato de autorização</small><strong>{item.atoOficial || "Consulte a fonte"}</strong></div><button className="detail-btn" onClick={() => setSelected(item)}>Ver detalhes ↗</button></div>
              </article>)}
              {((page === "favoritos" && filtered.filter(c => favorites.includes(c.id)).length === 0) || (page !== "favoritos" && filtered.length === 0)) && <div className="empty">Nenhum concurso encontrado. Experimente ajustar os filtros.</div>}
            </div>
            <div className="source-footnote"><span>Fontes: Banco Central, Receita Federal, CGU e MGI.</span><span>Conferência editorial: {sourceUpdated} · Dados compilados em: {fetchedAt ? new Date(fetchedAt).toLocaleString("pt-BR") : "não informado"}</span><a href={sourceUrl} target="_blank" rel="noreferrer">Ver página geral do MGI ↗</a></div>
            <p className="disclaimer">Esta é uma seleção inicial de concursos federais identificados em páginas oficiais, não uma lista completa do Brasil. Concursos estaduais, municipais, de outros Poderes e de empresas públicas ainda serão adicionados. Confirme sempre as datas, requisitos e etapas na página oficial de cada órgão.</p>
          </section>
        )}
        <footer>© 2026 EditalRadar · Feito para apoiar sua jornada até a aprovação.</footer>
      </main>

      {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)}>×</button><span className="status"><i />{selected.status}</span><div className="eyebrow">DETALHES DA SELEÇÃO</div><h2>{selected.cargo}</h2><p className="org-name">{selected.orgao}</p><div className="modal-facts"><div><small>Vagas autorizadas</small><strong>{selected.vagas}</strong></div><div><small>Escolaridade</small><strong>{selected.nivel}</strong></div><div><small>Vínculo</small><strong>{selected.vinculo || "Não informado"}</strong></div><div><small>Ato oficial</small><strong>{selected.atoOficial || "Consulte a planilha"}</strong></div></div><p className="muted">{selected.observacao}</p><a className="primary-btn full modal-source-link" href={selected.sourceUrl || sourceUrl} target="_blank" rel="noreferrer">Consultar página oficial do concurso ↗</a><button className="detail-btn full" onClick={() => toggleFavorite(selected.id)}>{favorites.includes(selected.id) ? "Remover dos favoritos" : "Salvar nos favoritos"}</button></div></div>}
    </div>
  );
}
