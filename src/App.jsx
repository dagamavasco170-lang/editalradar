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
  const [esfera, setEsfera] = useState("Todas as esferas");
  const [estado, setEstado] = useState("Todos os estados");
  const [localidade, setLocalidade] = useState("Todas as cidades");
  const [situacao, setSituacao] = useState("Todas as situações");
  const [favorites, setFavorites] = useState(() => readStore("er-favorites", []));
  const [tasks, setTasks] = useState(() => readStore("er-tasks", [false, false, false, false]));
  const [selected, setSelected] = useState(null);
  const [answer, setAnswer] = useState("");
  const [checkedAnswer, setCheckedAnswer] = useState(false);

  const estados = [...new Set(concursos.map((item) => item.estado || "Brasil"))].sort();
  const cidades = [...new Set(concursos.map((item) => item.localidade || "Brasil"))].sort();

  const filtered = useMemo(() => concursos.filter((item) => {
    const text = [item.cargo, item.orgao, item.vinculo, item.atoOficial, item.nivel, item.area, item.estado, item.localidade, item.status].join(" ").toLowerCase();
    const status = (item.status || "").toLowerCase();
    const matchesSituation = situacao === "Todas as situações"
      || (situacao === "Pré-edital / anunciado" && /(autorizado|anunciado|pré-edital)/.test(status))
      || (situacao === "Inscrições abertas" && /inscrições abertas/.test(status))
      || (situacao === "Inscrições encerradas" && /inscrições encerradas/.test(status))
      || (situacao === "Provas / resultados" && /(prova|resultado|provas realizadas)/.test(status));
    return text.includes(query.toLowerCase())
      && (nivel === "Todos os níveis" || item.nivel === nivel)
      && (esfera === "Todas as esferas" || (item.area || "Federal") === esfera)
      && (estado === "Todos os estados" || (item.estado || "Brasil") === estado)
      && (localidade === "Todas as cidades" || (item.localidade || "Brasil") === localidade)
      && matchesSituation;
  }), [query, nivel, esfera, estado, localidade, situacao]);

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
              <div><div className="eyebrow light">FONTES OFICIAIS · FEDERAL, ESTADUAL E MUNICIPAL</div><h1>Encontre concursos<br/>em todo o Brasil.</h1><p>Filtre oportunidades por esfera, estado, cidade, escolaridade e situação do edital.</p>
                <div className="hero-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cargo, órgão ou palavra-chave..." /><button onClick={() => setPage("concursos")}>Buscar concursos</button></div>
              </div>
              <div className="hero-art"><div className="art-circle">✦</div><div className="art-card"><span>✧</span><strong>Seu esforço<br/>vai valer a pena.</strong><small>Um dia de cada vez.</small></div></div>
            </div>
            <div className="source-notice">
              <div><strong>Confira a etapa e a origem de cada oportunidade.</strong><p>O catálogo está começando a incorporar concursos estaduais e municipais de Alagoas. Cada cartão leva à fonte oficial; vagas não divulgadas aparecem como “A divulgar”.</p></div>
              <a href={sourceUrl} target="_blank" rel="noreferrer">Consultar base federal do MGI ↗</a>
            </div>
            <div className="stats-row">
              <div className="stat"><span className="stat-icon blue">▦</span><div><strong>{concursos.length}</strong><small>Oportunidades verificadas</small></div></div>
              <div className="stat"><span className="stat-icon green">⌁</span><div><strong>{new Intl.NumberFormat("pt-BR").format(totalVagas)}</strong><small>Vagas informadas (sem cadastro reserva)</small></div></div>
              <div className="stat"><span className="stat-icon gold">☆</span><div><strong>{favorites.length}</strong><small>Oportunidades salvas</small></div></div>
            </div>
            <div className="section-title"><div><div className="eyebrow">ACOMPANHAMENTO NACIONAL</div><h2>{page === "favoritos" ? "Seus concursos favoritos" : "Concursos com fontes oficiais"}</h2></div><span className="results">{(page === "favoritos" ? filtered.filter(c => favorites.includes(c.id)) : filtered).length} registros</span></div>
            <div className="filters">
              <label className="search-filter"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cargo ou órgão..." /></label>
              <select aria-label="Esfera" value={esfera} onChange={(e) => setEsfera(e.target.value)}><option>Todas as esferas</option>{["Federal", "Estadual", "Municipal"].map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option>Todos os estados</option>{estados.map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Cidade" value={localidade} onChange={(e) => setLocalidade(e.target.value)}><option>Todas as cidades</option>{cidades.map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Escolaridade" value={nivel} onChange={(e) => setNivel(e.target.value)}><option>Todos os níveis</option>{[...new Set(concursos.map(c => c.nivel))].sort().map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value)}><option>Todas as situações</option>{["Pré-edital / anunciado", "Inscrições abertas", "Inscrições encerradas", "Provas / resultados"].map(x => <option key={x}>{x}</option>)}</select>
            </div>
            <div className="cards">
              {(page === "favoritos" ? filtered.filter(c => favorites.includes(c.id)) : filtered).map((item) => <article className="contest-card" key={item.id}>
                <div className="card-top"><div className="org-icon">{item.sigla}</div><button className={favorites.includes(item.id) ? "heart saved" : "heart"} onClick={() => toggleFavorite(item.id)} aria-label="Salvar favorito">{favorites.includes(item.id) ? "♥" : "♡"}</button></div>
                <span className="status"><i />{item.status}</span><h3>{item.cargo}</h3><p className="org-name">{item.orgao}</p>
                <div className="card-meta"><span>⌁ {item.vagas == null ? "Vagas a divulgar" : `${item.vagas} vaga(s) informada(s)`}</span><span>▤ {item.nivel}</span><span>⌖ {item.localidade || "Brasil"}</span></div>
                <div className="card-bottom"><div><small>Referência oficial</small><strong>{item.atoOficial || "Consulte a fonte"}</strong></div><button className="detail-btn" onClick={() => setSelected(item)}>Ver detalhes ↗</button></div>
              </article>)}
              {((page === "favoritos" && filtered.filter(c => favorites.includes(c.id)).length === 0) || (page !== "favoritos" && filtered.length === 0)) && <div className="empty">Nenhum concurso encontrado. Experimente ajustar os filtros.</div>}
            </div>
            <div className="source-footnote"><span>Fontes: órgãos federais, Governo de Alagoas, Cebraspe, IGEDUC e portais municipais.</span><span>Conferência editorial: {sourceUpdated} · Dados compilados em: {fetchedAt ? new Date(fetchedAt).toLocaleString("pt-BR") : "não informado"}</span><a href={sourceUrl} target="_blank" rel="noreferrer">Ver página geral do MGI ↗</a></div>
            <p className="disclaimer">Este catálogo é uma amostra inicial: reúne registros federais e seleções estaduais/municipais de Alagoas já identificadas em fontes oficiais. Ainda não cobre todos os estados e municípios do Brasil. “Vagas a divulgar” indica que o órgão ainda não publicou o quantitativo. Confirme sempre datas, requisitos, lotação e etapas na página oficial de cada seleção.</p>
          </section>
        )}
        <footer>© 2026 EditalRadar · Feito para apoiar sua jornada até a aprovação.</footer>
      </main>

      {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)}>×</button><span className="status"><i />{selected.status}</span><div className="eyebrow">DETALHES DA SELEÇÃO</div><h2>{selected.cargo}</h2><p className="org-name">{selected.orgao}</p><div className="modal-facts"><div><small>Vagas informadas</small><strong>{selected.vagas == null ? "A divulgar" : selected.vagas}</strong></div><div><small>Escolaridade</small><strong>{selected.nivel}</strong></div><div><small>Vínculo</small><strong>{selected.vinculo || "Não informado"}</strong></div><div><small>Ato oficial</small><strong>{selected.atoOficial || "Consulte a planilha"}</strong></div></div><p className="muted">{selected.observacao}</p><a className="primary-btn full modal-source-link" href={selected.sourceUrl || sourceUrl} target="_blank" rel="noreferrer">Consultar página oficial do concurso ↗</a><button className="detail-btn full" onClick={() => toggleFavorite(selected.id)}>{favorites.includes(selected.id) ? "Remover dos favoritos" : "Salvar nos favoritos"}</button></div></div>}
    </div>
  );
}
