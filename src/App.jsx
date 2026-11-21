import React, { useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient";
import { concursos, materias, sourceUrl, sourceUpdated, fetchedAt } from "./data/concursos";

const readStore = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const matchesFilters = (item, filters) => {
  const text = [item.cargo, item.orgao, item.vinculo, item.atoOficial, item.nivel, item.area, item.estado, item.localidade, item.status].join(" ").toLowerCase();
  const status = (item.status || "").toLowerCase();
  const matchesSituation = filters.situacao === "Todas as situações"
    || (filters.situacao === "Pré-edital / anunciado" && /(autorizado|anunciado|pré-edital)/.test(status))
    || (filters.situacao === "Inscrições abertas" && /inscrições abertas/.test(status))
    || (filters.situacao === "Inscrições encerradas" && /inscrições encerradas/.test(status))
    || (filters.situacao === "Provas / resultados" && /(prova|resultado|provas realizadas)/.test(status));

  return text.includes((filters.query || "").toLowerCase())
    && (filters.nivel === "Todos os níveis" || item.nivel === filters.nivel)
    && (filters.esfera === "Todas as esferas" || (item.area || "Federal") === filters.esfera)
    && (filters.estado === "Todos os estados" || (item.estado || "Brasil") === filters.estado)
    && (filters.localidade === "Todas as cidades" || (item.localidade || "Brasil") === filters.localidade)
    && matchesSituation
    && (!filters.ocultarPreliminares || !isPreliminary(item));
};

const describeAlert = (filters) => {
  const parts = [filters.estado, filters.localidade, filters.esfera, filters.nivel, filters.situacao, filters.query]
    .filter((value) => value && ![
      "Todos os estados", "Todas as cidades", "Todas as esferas", "Todos os níveis", "Todas as situações"
    ].includes(value));
  if (filters.ocultarPreliminares) parts.push("Somente fichas não preliminares");
  return parts.length ? parts.join(" · ") : "Todos os concursos";
};

const isPreliminary = (item) => /concurso listado\s*·\s*verificar/i.test(item?.status || "");

export default function App({ authClient = supabase, authConfigured = isSupabaseConfigured } = {}) {
  const [page, setPage] = useState("concursos");
  const [query, setQuery] = useState("");
  const [nivel, setNivel] = useState("Todos os níveis");
  const [esfera, setEsfera] = useState("Todas as esferas");
  const [estado, setEstado] = useState("Todos os estados");
  const [localidade, setLocalidade] = useState("Todas as cidades");
  const [situacao, setSituacao] = useState("Todas as situações");
  const [ocultarPreliminares, setOcultarPreliminares] = useState(false);
  const [alerts, setAlerts] = useState(() => {
    const stored = readStore("er-alerts", []);
    return Array.isArray(stored) ? stored : [];
  });
  const [favorites, setFavorites] = useState(() => readStore("er-favorites", []));
  const [tasks, setTasks] = useState(() => readStore("er-tasks", [false, false, false, false]));
  const [selected, setSelected] = useState(null);
  const [answer, setAnswer] = useState("");
  const [checkedAnswer, setCheckedAnswer] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("local");
  const syncQueueRef = useRef(Promise.resolve());
  const syncReadyUserRef = useRef(null);
  const pendingChangesRef = useRef({});
  const pendingWritesRef = useRef(0);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authMessageType, setAuthMessageType] = useState("info");
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileMessageType, setProfileMessageType] = useState("info");

  useEffect(() => {
    if (!authClient) {
      setAuthReady(true);
      return undefined;
    }

    let mounted = true;
    authClient.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      setAuthUser(data.session?.user || null);
      setAuthReady(true);
      if (error) {
        setAuthMessage("Não foi possível recuperar sua sessão. Entre novamente.");
        setAuthMessageType("error");
      }
    });

    const { data: { subscription } } = authClient.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user || null);
      setAuthReady(true);
      if (event === "PASSWORD_RECOVERY") {
        setAuthEmail(session?.user?.email || "");
        setAuthMode("reset");
        setShowAuth(true);
        setAuthMessage("Defina uma nova senha para concluir a recuperação da sua conta.");
        setAuthMessageType("info");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authClient || !authUser) {
      syncReadyUserRef.current = null;
      pendingChangesRef.current = {};
      pendingWritesRef.current = 0;
      setSyncStatus("local");
      return undefined;
    }

    const userId = authUser.id;
    let cancelled = false;
    syncReadyUserRef.current = null;
    pendingChangesRef.current = {};
    pendingWritesRef.current = 0;
    setSyncStatus("loading");

    const loadAccountData = async () => {
      let resolved = null;
      try {
        const { data, error } = await authClient
          .from("user_data")
          .select("favorites, alerts, tasks")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        // Preserve actions made while the cloud row was loading instead of
        // replacing those fresh local changes with an older remote snapshot.
        const pending = { ...pendingChangesRef.current };
        pendingChangesRef.current = {};
        resolved = {
          favorites: Array.isArray(data?.favorites) ? data.favorites : favorites,
          alerts: Array.isArray(data?.alerts) ? data.alerts : alerts,
          tasks: Array.isArray(data?.tasks) ? data.tasks : tasks,
          ...pending
        };

        setFavorites(resolved.favorites);
        setAlerts(resolved.alerts);
        setTasks(resolved.tasks);
        localStorage.setItem("er-favorites", JSON.stringify(resolved.favorites));
        localStorage.setItem("er-alerts", JSON.stringify(resolved.alerts));
        localStorage.setItem("er-tasks", JSON.stringify(resolved.tasks));

        // Create the initial row, or persist any actions made during hydration.
        if (!data || Object.keys(pending).length > 0) {
          const { error: saveError } = await authClient.from("user_data").upsert({
            user_id: userId,
            ...resolved,
            updated_at: new Date().toISOString()
          });
          if (saveError) throw saveError;
        }

        // Flush interactions that arrived while the first upsert was in flight.
        while (Object.keys(pendingChangesRef.current).length > 0) {
          const changes = { ...pendingChangesRef.current };
          pendingChangesRef.current = {};
          const { error: saveError } = await authClient.from("user_data").upsert({
            user_id: userId,
            ...changes,
            updated_at: new Date().toISOString()
          });
          if (saveError) throw saveError;
        }

        if (!cancelled) {
          syncReadyUserRef.current = userId;
          setSyncStatus("synced");
          setAuthMessage("");
        }
      } catch (error) {
        if (cancelled) return;
        if (resolved) pendingChangesRef.current = { ...resolved, ...pendingChangesRef.current };
        setSyncStatus("error");
        setAuthMessage(error?.message || "Conta conectada, mas não foi possível sincronizar os dados. Confira a tabela e as políticas de acesso do Supabase.");
        setAuthMessageType("error");
      }
    };

    loadAccountData();
    return () => {
      cancelled = true;
      if (syncReadyUserRef.current === userId) syncReadyUserRef.current = null;
    };
  }, [authUser?.id]);

  const estados = [...new Set(concursos.map((item) => item.estado || "Brasil"))].sort();
  const cidades = [...new Set(concursos.map((item) => item.localidade || "Brasil"))].sort();

  const currentFilters = { query, nivel, esfera, estado, localidade, situacao, ocultarPreliminares };
  const filtered = useMemo(
    () => concursos.filter((item) => matchesFilters(item, currentFilters)),
    [query, nivel, esfera, estado, localidade, situacao, ocultarPreliminares]
  );

  const syncUserData = async (changes) => {
    if (!authClient || !authUser) return;
    const userId = authUser.id;

    // Buffer changes made while the initial account snapshot is being loaded.
    if (syncReadyUserRef.current !== userId) {
      pendingChangesRef.current = { ...pendingChangesRef.current, ...changes };
      return;
    }

    pendingWritesRef.current += 1;
    setSyncStatus("syncing");
    const write = syncQueueRef.current.catch(() => {}).then(async () => {
      const { error } = await authClient.from("user_data").upsert({
        user_id: userId,
        ...changes,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
    });
    syncQueueRef.current = write.catch(() => {});

    try {
      await write;
      pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
      if (pendingWritesRef.current === 0 && syncReadyUserRef.current === userId) {
        setSyncStatus("synced");
        setAuthMessage("");
      }
    } catch (error) {
      pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
      setSyncStatus("error");
      setAuthMessage(error?.message || "Não foi possível sincronizar seus dados. Eles continuam salvos neste navegador.");
      setAuthMessageType("error");
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (!authClient) return;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      if (authMode === "recovery") {
        const { error } = await authClient.auth.resetPasswordForEmail(authEmail.trim(), {
          redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
        setAuthMessage("Se este e-mail estiver cadastrado, enviaremos um link para redefinir sua senha.");
        setAuthMessageType("success");
      } else if (authMode === "reset") {
        if (!authUser) throw new Error("Abra o link de recuperação enviado ao seu e-mail antes de definir uma nova senha.");
        if (authPassword !== authPasswordConfirm) throw new Error("As senhas não coincidem.");
        const { error } = await authClient.auth.updateUser({ password: authPassword });
        if (error) throw error;
        setAuthPassword("");
        setAuthPasswordConfirm("");
        setAuthMode("login");
        setShowAuth(false);
        setAuthMessage("Senha atualizada com sucesso. Você já pode continuar usando sua conta.");
        setAuthMessageType("success");
      } else if (authMode === "signup") {
        const { data, error } = await authClient.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: { emailRedirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
        if (data.session) {
          setAuthMessage("Conta criada e acesso realizado com sucesso.");
          setAuthMessageType("success");
        } else {
          setAuthMessage("Cadastro iniciado. Confira seu e-mail para confirmar a conta antes de entrar.");
          setAuthMessageType("success");
        }
      } else {
        const { error } = await authClient.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword
        });
        if (error) throw error;
        setAuthMessage("Login realizado com sucesso.");
        setAuthMessageType("success");
      }
    } catch (error) {
      setAuthMessage(error.message || "Não foi possível concluir a autenticação.");
      setAuthMessageType("error");
    } finally {
      setAuthBusy(false);
    }
  };

  const openProfileEditor = () => {
    if (!authUser) {
      setShowAuth(true);
      setAuthMessage("");
      return;
    }
    setProfileName(authUser.user_metadata?.full_name || authUser.user_metadata?.name || "");
    setProfileMessage("");
    setProfileMessageType("info");
    setShowProfile(true);
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    if (!authClient || !authUser) return;
    const name = profileName.trim();
    if (!name) {
      setProfileMessage("Informe seu nome para salvar o perfil.");
      setProfileMessageType("error");
      return;
    }

    setProfileBusy(true);
    setProfileMessage("");
    try {
      const { data, error } = await authClient.auth.updateUser({
        data: { full_name: name }
      });
      if (error) throw error;
      setAuthUser(data?.user || {
        ...authUser,
        user_metadata: { ...authUser.user_metadata, full_name: name }
      });
      setProfileName(name);
      setProfileMessage("Nome atualizado com sucesso.");
      setProfileMessageType("success");
    } catch (error) {
      setProfileMessage(error.message || "Não foi possível atualizar seu perfil.");
      setProfileMessageType("error");
    } finally {
      setProfileBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!authClient) return;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const { error } = await authClient.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
    } catch (error) {
      setAuthMessage(error.message || "Não foi possível iniciar o acesso com Google.");
      setAuthMessageType("error");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!authClient) return;
    const { error } = await authClient.auth.signOut();
    if (error) {
      setAuthMessage("Não foi possível sair da conta. Tente novamente.");
      setAuthMessageType("error");
      return;
    }
    setAuthUser(null);
    setShowAuth(false);
    setAuthMessage("Você saiu da sua conta. Seus dados locais continuam neste navegador.");
    setAuthMessageType("success");
  };

  const matchingAlert = (alert) => concursos.filter((item) => matchesFilters(item, alert.filters)).length;
  const currentAlertName = describeAlert(currentFilters);
  const alertAlreadySaved = alerts.some((alert) => JSON.stringify(alert.filters) === JSON.stringify(currentFilters));
  const saveCurrentAlert = () => {
    if (alertAlreadySaved) return;
    const next = [...alerts, {
      id: `alert-${Date.now()}`,
      name: currentAlertName,
      filters: { ...currentFilters }
    }];
    setAlerts(next);
    localStorage.setItem("er-alerts", JSON.stringify(next));
    void syncUserData({ alerts: next });
  };
  const removeAlert = (id) => {
    const next = alerts.filter((alert) => alert.id !== id);
    setAlerts(next);
    localStorage.setItem("er-alerts", JSON.stringify(next));
    void syncUserData({ alerts: next });
  };

  const saveFavorites = (next) => {
    setFavorites(next);
    localStorage.setItem("er-favorites", JSON.stringify(next));
    void syncUserData({ favorites: next });
  };
  const toggleFavorite = (id) => {
    saveFavorites(favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id]);
  };
  const toggleTask = (index) => {
    const next = tasks.map((done, i) => i === index ? !done : done);
    setTasks(next);
    localStorage.setItem("er-tasks", JSON.stringify(next));
    void syncUserData({ tasks: next });
  };
  const progress = Math.round(tasks.filter(Boolean).length / tasks.length * 100);
  const catalogCount = concursos.filter(Boolean).length;
  const preliminaryCount = concursos.filter(isPreliminary).length;
  const verifiedRecords = concursos.filter((item) => item && !isPreliminary(item));
  const totalVagas = verifiedRecords.reduce((sum, item) => sum + (Number(item.vagas) || 0), 0);

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
          <div className="profile"><div className="avatar">{(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "C")[0]?.toUpperCase() || "C"}</div><div className="profile-copy" title={authUser?.email || "Modo visitante"}><strong>{authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "Concurseiro"}</strong><small>{!authUser ? "Modo visitante" : syncStatus === "loading" || syncStatus === "syncing" ? "Sincronizando dados..." : syncStatus === "synced" ? "Dados sincronizados" : syncStatus === "error" ? "Falha na sincronização" : "Conta conectada"}</small></div><button className="dots profile-edit" type="button" onClick={openProfileEditor} aria-label={authUser ? "Editar perfil" : "Entrar para editar perfil"}>•••</button></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">Início <span>/</span> {page === "concursos" ? "Concursos" : page === "estudos" ? "Área de estudos" : "Meus favoritos"}</div>
          <div className="top-actions"><span className="date-chip">◷ &nbsp;Sua jornada começa hoje</span>{authUser ? <button className="auth-trigger" onClick={handleSignOut} disabled={!authReady}>Sair da conta</button> : <button className="auth-trigger" onClick={() => { setShowAuth(true); setAuthMessage(""); }}>Entrar / cadastrar</button>}<div className="mini-avatar">{(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "C")[0]?.toUpperCase() || "C"}</div></div>
        </header>

        {page === "estudos" ? (
          <section className="content">
            <div className="eyebrow">SUA ROTINA, SEU RITMO</div>
            <h1>Área de estudos</h1>
            <p className="subhead">Pequenos passos todos os dias constroem grandes aprovações.</p>
            <div className="study-grid">
              <div className="panel progress-panel"><div className="panel-head"><div><div className="eyebrow">VISÃO GERAL</div><h2>Seu progresso diário</h2></div><span className="soft-pill">Hoje</span></div>
                <div className="progress-number">{progress}%</div><div className="progress-track"><div style={{ width: progress + "%" }} /></div><p className="muted">{tasks.filter(Boolean).length} de {tasks.length} atividades concluídas</p>
                <div className="task-list">{["Revisar português","Resolver 10 questões","Estudar direito constitucional","Fazer uma revisão rápida"].map((task, i) => <label className="task" key={task}><input type="checkbox" checked={tasks[i]} onChange={() => toggleTask(i)} disabled={Boolean(authUser && syncStatus === "loading")} /><span className={tasks[i] ? "task-done" : ""}>{task}</span><small>{i === 0 ? "25 min" : i === 1 ? "30 min" : i === 2 ? "40 min" : "15 min"}</small></label>)}</div>
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
              <div><strong>Confira a etapa e a origem de cada oportunidade.</strong><p>{preliminaryCount} registro(s) são preliminares e vêm de uma listagem secundária: não são confirmação de edital ou de vagas e ficam fora da soma de vagas. Os demais registros levam à página da seleção ou do órgão responsável.</p></div>
              <a href={sourceUrl} target="_blank" rel="noreferrer">Consultar base federal do MGI ↗</a>
            </div>
            <div className="stats-row">
              <div className="stat"><span className="stat-icon blue">▦</span><div><strong>{catalogCount}</strong><small>Registros no catálogo</small></div></div>
              <div className="stat"><span className="stat-icon green">⌁</span><div><strong>{new Intl.NumberFormat("pt-BR").format(totalVagas)}</strong><small>Vagas em fichas com fonte oficial</small></div></div>
              <div className="stat"><span className="stat-icon gold">☆</span><div><strong>{favorites.length}</strong><small>Oportunidades salvas</small></div></div>
            </div>
            <div className="section-title"><div><div className="eyebrow">CATÁLOGO DE OPORTUNIDADES</div><h2>{page === "favoritos" ? "Seus concursos favoritos" : "Concursos e avisos no catálogo"}</h2></div><span className="results">{(page === "favoritos" ? filtered.filter(c => favorites.includes(c.id)) : filtered).length} registros</span></div>
            <div className="filters">
              <label className="search-filter"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cargo ou órgão..." /></label>
              <select aria-label="Esfera" value={esfera} onChange={(e) => setEsfera(e.target.value)}><option>Todas as esferas</option>{["Federal", "Estadual", "Municipal"].map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option>Todos os estados</option>{estados.map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Cidade" value={localidade} onChange={(e) => setLocalidade(e.target.value)}><option>Todas as cidades</option>{cidades.map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Escolaridade" value={nivel} onChange={(e) => setNivel(e.target.value)}><option>Todos os níveis</option>{[...new Set(concursos.map(c => c.nivel))].sort().map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value)}><option>Todas as situações</option>{["Pré-edital / anunciado", "Inscrições abertas", "Inscrições encerradas", "Provas / resultados"].map(x => <option key={x}>{x}</option>)}</select>
            </div>
            <div className="filter-options">
              <label className="preliminary-toggle">
                <input
                  type="checkbox"
                  aria-label="Ocultar registros preliminares"
                  checked={ocultarPreliminares}
                  onChange={(event) => setOcultarPreliminares(event.target.checked)}
                />
                <span>Ocultar registros preliminares sem confirmação individual ({preliminaryCount})</span>
              </label>
              {ocultarPreliminares && <span className="filter-hint">Exibindo apenas fichas não preliminares</span>}
            </div>
            <section className="alerts-panel" aria-label="Alertas personalizados">
              <div className="alerts-intro">
                <div>
                  <strong>Alertas personalizados</strong>
                  <p>Salve seus filtros e confira rapidamente quantas oportunidades combinam com seu perfil neste catálogo.</p>
                </div>
                <button className="primary-btn alert-save" onClick={saveCurrentAlert} disabled={alertAlreadySaved || Boolean(authUser && syncStatus === "loading")}>
                  {alertAlreadySaved ? "Alerta já salvo" : "＋ Salvar alerta"}
                </button>
              </div>
              {alerts.length > 0 ? (
                <div className="saved-alerts">
                  {alerts.map((alert) => (
                    <div className="saved-alert" key={alert.id}>
                      <div className="saved-alert-copy">
                        <strong>{alert.name}</strong>
                        <span>{matchingAlert(alert)} oportunidade(s) correspondente(s)</span>
                      </div>
                      <button className="alert-remove" onClick={() => removeAlert(alert.id)} aria-label={`Remover alerta ${alert.name}`} disabled={Boolean(authUser && syncStatus === "loading")}>Remover</button>
                    </div>
                  ))}
                </div>
              ) : <p className="alerts-empty">Você ainda não salvou alertas. Ajuste os filtros acima e clique em “Salvar alerta”.</p>}
              <small className="alerts-note">{!authUser ? "No modo visitante, os alertas ficam salvos neste navegador. Entre na sua conta para sincronizá-los entre aparelhos." : syncStatus === "synced" ? "Alertas sincronizados com sua conta. As correspondências são calculadas a partir do catálogo disponível." : syncStatus === "error" ? "Não foi possível confirmar a sincronização. Seus alertas continuam salvos neste navegador." : "Sincronizando seus alertas com a conta..."}</small>
            </section>
            <div className="cards">
              {(page === "favoritos" ? filtered.filter(c => favorites.includes(c.id)) : filtered).map((item) => <article className="contest-card" key={item.id}>
                <div className="card-top"><div className="org-icon">{item.sigla}</div><button className={favorites.includes(item.id) ? "heart saved" : "heart"} onClick={() => toggleFavorite(item.id)} aria-label="Salvar favorito" disabled={Boolean(authUser && syncStatus === "loading")}>{favorites.includes(item.id) ? "♥" : "♡"}</button></div>
                <span className={`status ${isPreliminary(item) ? "preliminary" : ""}`}><i />{item.status}</span><h3>{item.cargo}</h3><p className="org-name">{item.orgao}</p>
                <div className="card-meta"><span>⌁ {item.vagas == null ? "Vagas a divulgar" : `${item.vagas} vaga(s) informada(s)`}</span><span>▤ {item.nivel}</span><span>⌖ {item.localidade || "Brasil"}</span></div>
                <div className="card-bottom"><div><small>{isPreliminary(item) ? "Listagem de referência" : "Fonte oficial"}</small><strong>{item.atoOficial || "Não informado"}</strong></div><button className="detail-btn" onClick={() => setSelected(item)}>Ver detalhes ↗</button></div>
              </article>)}
              {((page === "favoritos" && filtered.filter(c => favorites.includes(c.id)).length === 0) || (page !== "favoritos" && filtered.length === 0)) && <div className="empty">Nenhum concurso encontrado. Experimente ajustar os filtros.</div>}
            </div>
            <div className="source-footnote"><span>Fontes: órgãos federais, Governo de Alagoas, Cebraspe, IGEDUC e portais municipais.</span><span>Conferência editorial: {sourceUpdated} · Dados compilados em: {fetchedAt ? new Date(fetchedAt).toLocaleString("pt-BR") : "não informado"}</span><a href={sourceUrl} target="_blank" rel="noreferrer">Ver página geral do MGI ↗</a></div>
            <p className="disclaimer">Este catálogo é uma amostra inicial e não cobre todos os estados e municípios do Brasil. Registros marcados como preliminares vêm de listagem secundária e ainda não foram confirmados individualmente em edital oficial; não considere suas vagas, requisitos ou cronograma como definitivos. Eles não entram na soma de vagas. “Vagas a divulgar” indica que o quantitativo não foi informado nesta ficha. Confirme sempre datas, requisitos, lotação e etapas na publicação oficial.</p>
          </section>
        )}
        <footer>© 2026 EditalRadar · Feito para apoiar sua jornada até a aprovação.</footer>
      </main>

      {showAuth && <div className="modal-backdrop" onClick={() => setShowAuth(false)}>
        <section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setShowAuth(false)} aria-label="Fechar cadastro e login">×</button>
          <div className="eyebrow">SUA CONTA EDITALRADAR</div>
          <h2 id="auth-title">{authMode === "signup" ? "Criar sua conta" : authMode === "recovery" ? "Recuperar senha" : authMode === "reset" ? "Criar nova senha" : "Entrar na sua conta"}</h2>
          {authConfigured ? (
            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {(authMode === "login" || authMode === "signup") && (
                <>
                  <button className="google-auth-btn" type="button" onClick={handleGoogleSignIn} disabled={authBusy}>
                    <span className="google-mark" aria-hidden="true">G</span>
                    {authBusy ? "Conectando..." : "Continuar com Google"}
                  </button>
                  <div className="auth-divider"><span>ou use seu e-mail</span></div>
                </>
              )}
              <label>E-mail<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" required placeholder="voce@exemplo.com" disabled={authMode === "reset"} /></label>
              {authMode !== "recovery" && <label>{authMode === "reset" ? "Nova senha" : "Senha"}<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === "signup" || authMode === "reset" ? "new-password" : "current-password"} minLength={8} required placeholder="Pelo menos 8 caracteres" /></label>}
              {authMode === "reset" && <label>Confirmar nova senha<input type="password" value={authPasswordConfirm} onChange={(event) => setAuthPasswordConfirm(event.target.value)} autoComplete="new-password" minLength={8} required placeholder="Digite a nova senha novamente" /></label>}
              <button className="primary-btn full" type="submit" disabled={authBusy}>{authBusy ? "Aguarde..." : authMode === "signup" ? "Criar conta" : authMode === "recovery" ? "Enviar link de recuperação" : authMode === "reset" ? "Salvar nova senha" : "Entrar"}</button>
              {authMode === "login" && <button className="auth-mode-toggle" type="button" onClick={() => { setAuthMode("recovery"); setAuthMessage(""); }}>Esqueci minha senha</button>}
              {authMode === "login" && <button className="auth-mode-toggle" type="button" onClick={() => { setAuthMode("signup"); setAuthPassword(""); setAuthMessage(""); }}>Não tem conta? Criar conta</button>}
              {authMode === "recovery" && <button className="auth-mode-toggle" type="button" onClick={() => { setAuthMode("login"); setAuthPassword(""); setAuthPasswordConfirm(""); setAuthMessage(""); }}>Voltar ao login</button>}
              {authMode === "signup" && <button className="auth-mode-toggle" type="button" onClick={() => { setAuthMode("login"); setAuthPassword(""); setAuthPasswordConfirm(""); setAuthMessage(""); }}>Já tenho uma conta — entrar</button>}
              {authMessage && <p className={`auth-message ${authMessageType}`} role="status">{authMessage}</p>}
            </form>
          ) : (
            <div className="auth-setup">
              <p>O cadastro e a recuperação de senha estão preparados, mas falta conectar o projeto ao Supabase para ativar as contas.</p>
              <ol>
                <li>Crie um projeto gratuito no Supabase.</li>
                <li>Execute o SQL de <code>supabase/migrations/202611210001_user_data.sql</code> no SQL Editor.</li>
                <li>Adicione <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> nas Actions Variables do GitHub.</li>
              </ol>
              <a href="https://github.com/dagamavasco170-lang/editalradar/blob/main/SUPABASE_SETUP.md" target="_blank" rel="noreferrer">Abrir guia de configuração ↗</a>
            </div>
          )}
        </section>
      </div>}
      {showProfile && <div className="modal-backdrop" onClick={() => setShowProfile(false)}>
        <section className="modal auth-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setShowProfile(false)} aria-label="Fechar edição de perfil">×</button>
          <div className="eyebrow">SUA CONTA EDITALRADAR</div>
          <h2 id="profile-title">Editar perfil</h2>
          <p className="muted">Escolha como seu nome aparece no EditalRadar. A alteração fica salva na sua conta.</p>
          <form className="auth-form" onSubmit={handleProfileSubmit}>
            <label>Nome de exibição<input type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} autoComplete="name" maxLength={60} required placeholder="Como quer ser chamado?" /></label>
            <button className="primary-btn full" type="submit" disabled={profileBusy}>{profileBusy ? "Salvando..." : "Salvar perfil"}</button>
            {profileMessage && <p className={`auth-message ${profileMessageType}`} role="status">{profileMessage}</p>}
          </form>
        </section>
      </div>}
            {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)}>×</button><span className={`status ${isPreliminary(selected) ? "preliminary" : ""}`}><i />{selected.status}</span><div className="eyebrow">DETALHES DA SELEÇÃO</div><h2>{selected.cargo}</h2><p className="org-name">{selected.orgao}</p><div className="modal-facts"><div><small>Vagas informadas</small><strong>{selected.vagas == null ? "A divulgar" : selected.vagas}</strong></div><div><small>Escolaridade</small><strong>{selected.nivel}</strong></div><div><small>Vínculo</small><strong>{selected.vinculo || "Não informado"}</strong></div><div><small>{isPreliminary(selected) ? "Referência cadastrada" : "Ato oficial"}</small><strong>{selected.atoOficial || "Não informado"}</strong></div></div><p className="muted">{selected.observacao}</p><a className="primary-btn full modal-source-link" href={selected.sourceUrl || sourceUrl} target="_blank" rel="noreferrer">{isPreliminary(selected) ? "Abrir listagem de referência — não é edital ↗" : "Consultar página oficial do concurso ↗"}</a><button className="detail-btn full" onClick={() => toggleFavorite(selected.id)} disabled={Boolean(authUser && syncStatus === "loading")}>{favorites.includes(selected.id) ? "Remover dos favoritos" : "Salvar nos favoritos"}</button></div></div>}
    </div>
  );
}
