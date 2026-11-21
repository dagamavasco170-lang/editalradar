import React, { useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient";
import { concursos, materias, sourceUrl, sourceUpdated, fetchedAt } from "./data/concursos";
import { detectCatalogNotifications, dismissNotificationById, dismissNotificationHistory, getVisibleNotifications, mergeNotificationHistory } from "./lib/notifications";
import { applyCatalogOverrides } from "./lib/catalog";

export const scoreRecommendation = (item, profile = {}) => {
 const area=(profile.interest_area||"").toLowerCase(), text=[item.cargo,item.orgao,item.area,item.nivel,item.estado,item.localidade,item.status].join(" ").toLowerCase();
 const keywords={administrativa:["administr","assistente","técnico","tecnico","analista"],policial:["polícia","policia","policial","segurança","seguranca"],tribunais:["tribunal","judiciário","judiciario","justiça","justica"],"fiscal e controle":["auditor","fiscal","receita","controle","cgu"],bancária:["banco","bancário","bancaria","bacen","central"],educação:["professor","educação","educacao","pedag"],saúde:["saúde","saude","médico","medico","enferm"],jurídica:["procurador","juríd","jurid","adv"],tecnologia:["tecnologia","dados","sistemas","ti","infraestrutura"]};
 const areaMatches=(keywords[area]||[]).some(w=>text.includes(w)), level=(profile.education_level||"").toLowerCase(), itemLevel=(item.nivel||"").toLowerCase();
 const levelMatches=!level||!itemLevel||itemLevel==="não informado"||(level.includes("médio")&&itemLevel.includes("médio"))||(level.includes("técnico")&&(itemLevel.includes("médio")||itemLevel.includes("técnico")))||(level.includes("superior")&&itemLevel.includes("superior"));
 const stateMatches=!profile.state||item.estado===profile.state||item.estado==="Brasil", cityMatches=!profile.city||item.localidade===profile.city||item.localidade==="Brasil";
 const active=/(inscriç|autorizado|pré-edital|edital publicado|anunciado)/.test((item.status||"").toLowerCase());
 return Math.round((areaMatches?40:0)+(levelMatches?25:0)+(stateMatches?20:0)+(cityMatches?5:0)+(active?10:0));
};
const readStore = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const isMissingNotificationsColumn = (error) =>
  ["42703", "PGRST204"].includes(error?.code)
  || /notifications.*(column|schema cache)|column.*notifications/i.test(error?.message || "");

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

const brazilianStates = [
  "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal",
  "Espírito Santo", "Goiás", "Maranhão", "Mato Grosso", "Mato Grosso do Sul",
  "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco", "Piauí",
  "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia",
  "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins"
];

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
  const [notifications, setNotifications] = useState(() => {
    const stored = readStore("er-notifications:visitor", []);
    return Array.isArray(stored) ? stored : [];
  });
  const [notificationCloudSyncAvailable, setNotificationCloudSyncAvailable] = useState(true);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [catalogOverrides, setCatalogOverrides] = useState([]);
  const [catalogSyncMessage, setCatalogSyncMessage] = useState("");
  const [discoveryItems, setDiscoveryItems] = useState([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoverySyncMessage, setDiscoverySyncMessage] = useState("");
  const [discoveryDraftId, setDiscoveryDraftId] = useState(null);
  const [adminDraft, setAdminDraft] = useState(null);
  const [adminEditingId, setAdminEditingId] = useState(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminMessageType, setAdminMessageType] = useState("info");
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported"
  );
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(() =>
    readStore("er-browser-notifications", false) === true
  );
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationView, setNotificationView] = useState("all");
  const [jumpToNotifications, setJumpToNotifications] = useState(false);
  const notificationsSectionRef = useRef(null);
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
  const notificationsColumnAvailableRef = useRef(null);
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
  const [profileCity, setProfileCity] = useState("");
  const [profileState, setProfileState] = useState("");
  const [profileEducation, setProfileEducation] = useState("");
  const [profileArea, setProfileArea] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileMessageType, setProfileMessageType] = useState("info");
  const notificationStorageKey = "er-notifications:" + (authUser?.id || "visitor");
  const catalogSnapshotStorageKey = "er-catalog-snapshot:" + (authUser?.id || "visitor");
  const catalog = useMemo(() => applyCatalogOverrides(concursos, catalogOverrides), [catalogOverrides]);
  const isAdmin = authUser?.app_metadata?.role === "admin";

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event);
    };
    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setDeferredInstallPrompt(null);
      setShowInstallHelp(false);
    };
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches
      || window.navigator.standalone === true;

    setIsAppInstalled(Boolean(standalone));
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {
        // O site continua funcionando normalmente mesmo se o navegador bloquear o service worker.
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    const loadCatalogOverrides = async () => {
      try {
        const { data, error } = await supabase.from("contest_catalog").select("id, data, deleted, updated_at");
        if (error) throw error;
        if (!cancelled) {
          setCatalogOverrides(Array.isArray(data) ? data : []);
          setCatalogSyncMessage("");
        }
      } catch (error) {
        if (!cancelled) setCatalogSyncMessage(error?.message || "Não foi possível carregar as alterações do catálogo. A lista base continua disponível.");
      }
    };
    void loadCatalogOverrides();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAdmin || !authClient) {
      setDiscoveryItems([]);
      setDiscoverySyncMessage("");
      setDiscoveryLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadDiscoveries = async () => {
      setDiscoveryLoading(true);
      try {
        const { data, error } = await authClient
          .from("contest_discoveries")
          .select("id, source_url, candidate_url, title, context, discovery_type, detected_at, status")
          .eq("status", "pending")
          .order("detected_at", { ascending: false });
        if (error) throw error;
        if (!cancelled) {
          setDiscoveryItems(Array.isArray(data) ? data : []);
          setDiscoverySyncMessage("");
        }
      } catch (error) {
        if (!cancelled) {
          setDiscoverySyncMessage(error?.message || "Não foi possível carregar a fila. Confira se a migração de descobertas foi executada.");
        }
      } finally {
        if (!cancelled) setDiscoveryLoading(false);
      }
    };

    void loadDiscoveries();
    return () => { cancelled = true; };
  }, [authClient, isAdmin]);

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

  // Atualiza os claims após uma mudança de papel no Supabase (por exemplo,
  // quando o usuário recebe app_metadata.role = "admin").
  useEffect(() => {
    if (!authClient || !authUser?.id || typeof authClient.auth.refreshSession !== "function") {
      return undefined;
    }

    let cancelled = false;
    const refreshAccountClaims = async () => {
      try {
        const { data, error } = await authClient.auth.refreshSession();
        if (error) throw error;
        const refreshedUser = data?.user || data?.session?.user || null;
        if (!cancelled && refreshedUser?.id === authUser.id) {
          setAuthUser(refreshedUser);
        }
      } catch {
        // Mantém a sessão atual; as políticas RLS continuam protegendo o catálogo.
      }
    };

    void refreshAccountClaims();
    return () => { cancelled = true; };
  }, [authClient, authUser?.id]);

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
        let accountQuery = await authClient
          .from("user_data")
          .select("favorites, alerts, tasks, notifications")
          .eq("user_id", userId)
          .maybeSingle();

        if (accountQuery.error && isMissingNotificationsColumn(accountQuery.error)) {
          // Keep the existing account sync working until the new SQL migration is applied.
          notificationsColumnAvailableRef.current = false;
          setNotificationCloudSyncAvailable(false);
          accountQuery = await authClient
            .from("user_data")
            .select("favorites, alerts, tasks")
            .eq("user_id", userId)
            .maybeSingle();
        } else if (!accountQuery.error) {
          notificationsColumnAvailableRef.current = true;
          setNotificationCloudSyncAvailable(true);
        }

        if (cancelled) return;
        const { data, error } = accountQuery;
        if (error) throw error;

        // Preserve actions made while the cloud row was loading instead of
        // replacing those fresh local changes with an older remote snapshot.
        const pending = { ...pendingChangesRef.current };
        pendingChangesRef.current = {};
        const localNotifications = readStore("er-notifications:" + userId, []);
        const remoteNotifications = Array.isArray(data?.notifications) ? data.notifications : localNotifications;
        const mergedNotifications = Array.isArray(data?.notifications)
          ? mergeNotificationHistory(remoteNotifications, localNotifications)
          : remoteNotifications;
        const hasLocalNotificationsToSync = Array.isArray(data?.notifications)
          && JSON.stringify(mergedNotifications) !== JSON.stringify(remoteNotifications);
        resolved = {
          favorites: Array.isArray(data?.favorites) ? data.favorites : favorites,
          alerts: Array.isArray(data?.alerts) ? data.alerts : alerts,
          tasks: Array.isArray(data?.tasks) ? data.tasks : tasks,
          notifications: mergedNotifications,
          ...pending
        };

        setFavorites(resolved.favorites);
        setAlerts(resolved.alerts);
        setTasks(resolved.tasks);
        setNotifications(resolved.notifications);
        localStorage.setItem("er-favorites", JSON.stringify(resolved.favorites));
        localStorage.setItem("er-alerts", JSON.stringify(resolved.alerts));
        localStorage.setItem("er-tasks", JSON.stringify(resolved.tasks));
        localStorage.setItem("er-notifications:" + userId, JSON.stringify(resolved.notifications));

        // Create the initial row, migrate any local notification history, or
        // persist actions made while the cloud snapshot was loading.
        if (!data || Object.keys(pending).length > 0 || hasLocalNotificationsToSync) {
          const payload = notificationsColumnAvailableRef.current === false
            ? Object.fromEntries(Object.entries(resolved).filter(([key]) => key !== "notifications"))
            : resolved;
          const { error: saveError } = await authClient.from("user_data").upsert({
            user_id: userId,
            ...payload,
            updated_at: new Date().toISOString()
          });
          if (saveError) throw saveError;
        }

        // Flush interactions that arrived while the first upsert was in flight.
        while (Object.keys(pendingChangesRef.current).length > 0) {
          const changes = { ...pendingChangesRef.current };
          pendingChangesRef.current = {};
          const payload = notificationsColumnAvailableRef.current === false
            ? Object.fromEntries(Object.entries(changes).filter(([key]) => key !== "notifications"))
            : changes;
          if (Object.keys(payload).length > 0) {
            const { error: saveError } = await authClient.from("user_data").upsert({
              user_id: userId,
              ...payload,
              updated_at: new Date().toISOString()
            });
            if (saveError) throw saveError;
          }
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

  useEffect(() => {
    // Authenticated notification history is hydrated from Supabase above.
    // Visitors continue using their own local-only history.
    if (authUser) return;
    const stored = readStore(notificationStorageKey, []);
    setNotifications(Array.isArray(stored) ? stored : []);
  }, [notificationStorageKey, authUser?.id]);

  useEffect(() => {
    if (!authReady) return;
    // Wait for the cloud favorites snapshot before comparing this browser's catalog.
    if (authUser && syncStatus !== "error" && syncReadyUserRef.current !== authUser.id) return;

    const previousSnapshot = readStore(catalogSnapshotStorageKey, null);
    const detected = detectCatalogNotifications({
      catalog: catalog,
      previousSnapshot,
      favoriteIds: favorites
    });
    localStorage.setItem(catalogSnapshotStorageKey, JSON.stringify(detected.snapshot));
    if (detected.notifications.length === 0) return;

    const existing = readStore(notificationStorageKey, []);
    const knownIds = new Set(existing.map((item) => item.id));
    const hasRecommendationProfile = Boolean(
      authUser?.user_metadata?.interest_area
      || authUser?.user_metadata?.education_level
      || authUser?.user_metadata?.state
    );
    const fresh = detected.notifications.filter((notice) => {
      if (knownIds.has(notice.id)) return false;
      if (notice.type !== "new" || !hasRecommendationProfile) return true;
      const contest = catalog.find((item) => String(item.id) === String(notice.itemId));
      return contest && scoreRecommendation(contest, authUser.user_metadata || {}) >= 70;
    });
    if (fresh.length === 0) return;

    const dismissedHistory = existing.filter((item) => item.dismissedAt);
    const activeHistory = existing.filter((item) => !item.dismissedAt);
    const next = [
      ...[...fresh, ...activeHistory].slice(0, 50),
      ...dismissedHistory
    ];
    setNotifications(next);
    localStorage.setItem(notificationStorageKey, JSON.stringify(next));
    void syncUserData({ notifications: next });

    if (browserNotificationsEnabled && notificationPermission === "granted" && "Notification" in window) {
      fresh.slice(0, 3).forEach((item) => {
        const browserNotice = new window.Notification(item.title, {
          body: item.message,
          tag: item.id
        });
        browserNotice.onclick = () => {
          window.focus();
          const contest = catalog.find((entry) => String(entry.id) === String(item.itemId));
          if (contest) setSelected(contest);
          browserNotice.close();
        };
      });
    }
  }, [
    authReady,
    authUser?.id,
    syncStatus,
    favorites,
    browserNotificationsEnabled,
    notificationPermission,
    notificationStorageKey,
    catalogSnapshotStorageKey,
    catalog,
    authUser?.user_metadata?.interest_area,
    authUser?.user_metadata?.education_level,
    authUser?.user_metadata?.state,
    authUser?.user_metadata?.city
  ]);

  const estados = [...new Set(catalog.map((item) => item.estado || "Brasil"))].sort();
  const cidades = [...new Set(catalog.map((item) => item.localidade || "Brasil"))].sort();

  const recommendationProfile=authUser?.user_metadata||{};
  const profileRecommendations=useMemo(()=>{
    if(!authUser||(!recommendationProfile.interest_area&&!recommendationProfile.education_level&&!recommendationProfile.state))return [];
    return catalog.map(item=>({item,score:scoreRecommendation(item,recommendationProfile)})).sort((a,b)=>b.score-a.score||(Number(b.item.vagas)||0)-(Number(a.item.vagas)||0)).slice(0,3);
  },[catalog,authUser?.id,authUser?.user_metadata?.interest_area,authUser?.user_metadata?.education_level,authUser?.user_metadata?.state,authUser?.user_metadata?.city]);
  const currentFilters = { query, nivel, esfera, estado, localidade, situacao, ocultarPreliminares };
  const filtered = useMemo(
    () => catalog.filter((item) => matchesFilters(item, currentFilters)),
    [query, nivel, esfera, estado, localidade, situacao, ocultarPreliminares]
  );

  const syncUserData = async (changes) => {
    if (!authClient || !authUser) return;
    const userId = authUser.id;
    const supportedChanges = notificationsColumnAvailableRef.current === false
      ? Object.fromEntries(Object.entries(changes).filter(([key]) => key !== "notifications"))
      : changes;
    if (Object.keys(supportedChanges).length === 0) return;

    // Buffer changes made while the initial account snapshot is being loaded.
    if (syncReadyUserRef.current !== userId) {
      pendingChangesRef.current = { ...pendingChangesRef.current, ...supportedChanges };
      return;
    }

    pendingWritesRef.current += 1;
    setSyncStatus("syncing");
    const write = syncQueueRef.current.catch(() => {}).then(async () => {
      const { error } = await authClient.from("user_data").upsert({
        user_id: userId,
        ...supportedChanges,
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
    const metadata = authUser.user_metadata || {};
    setProfileName(metadata.full_name || metadata.name || "");
    setProfileCity(metadata.city || "");
    setProfileState(metadata.state || "");
    setProfileEducation(metadata.education_level || "");
    setProfileArea(metadata.interest_area || "");
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

    const profileData = {
      full_name: name,
      city: profileCity.trim(),
      state: profileState,
      education_level: profileEducation,
      interest_area: profileArea
    };

    setProfileBusy(true);
    setProfileMessage("");
    try {
      const { data, error } = await authClient.auth.updateUser({
        data: profileData
      });
      if (error) throw error;
      setAuthUser(data?.user || {
        ...authUser,
        user_metadata: { ...authUser.user_metadata, ...profileData }
      });
      setProfileName(name);
      setProfileCity(profileData.city);
      setProfileMessage("Perfil atualizado com sucesso.");
      setProfileMessageType("success");
    } catch (error) {
      setProfileMessage(error.message || "Não foi possível atualizar seu perfil.");
      setProfileMessageType("error");
    } finally {
      setProfileBusy(false);
    }
  };

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) {
      setShowInstallHelp(true);
      return;
    }

    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === "accepted") setIsAppInstalled(true);
    } catch {
      setShowInstallHelp(true);
    } finally {
      setDeferredInstallPrompt(null);
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

  const matchingAlert = (alert) => catalog.filter((item) => matchesFilters(item, alert.filters)).length;
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
  const enableBrowserNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      setNotificationMessage("Este navegador não oferece notificações de desktop.");
      return;
    }
    if (window.Notification.permission === "denied") {
      setNotificationPermission("denied");
      setNotificationMessage("A permissão está bloqueada. Altere-a nas configurações do navegador para este site.");
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      const enabled = permission === "granted";
      setBrowserNotificationsEnabled(enabled);
      localStorage.setItem("er-browser-notifications", JSON.stringify(enabled));
      setNotificationMessage(enabled
        ? "Notificações do navegador ativadas neste dispositivo."
        : "A permissão não foi concedida. Você continuará vendo os avisos dentro do EditalRadar.");
      if (enabled) {
        new window.Notification("EditalRadar", {
          body: "Notificações ativadas. Avisaremos quando houver novidades no catálogo."
        });
      }
    } catch {
      setNotificationMessage("Não foi possível solicitar a permissão neste navegador.");
    }
  };

  const markAllNotificationsRead = () => {
    const next = notifications.map((item) => ({ ...item, read: true }));
    setNotifications(next);
    localStorage.setItem(notificationStorageKey, JSON.stringify(next));
    void syncUserData({ notifications: next });
  };

  const openNotification = (notification) => {
    const next = notifications.map((item) => item.id === notification.id ? { ...item, read: true } : item);
    setNotifications(next);
    localStorage.setItem(notificationStorageKey, JSON.stringify(next));
    void syncUserData({ notifications: next });
    const contest = catalog.find((item) => String(item.id) === String(notification.itemId));
    if (contest) setSelected(contest);
  };

  const dismissSingleNotification = (notificationId) => {
    const next = dismissNotificationById(notifications, notificationId);
    setNotifications(next);
    localStorage.setItem(notificationStorageKey, JSON.stringify(next));
    void syncUserData({ notifications: next });
  };

  const activeNotifications = getVisibleNotifications(notifications);
  const unreadNotificationCount = activeNotifications.filter((item) => !item.read).length;
  const visibleNotifications = notificationView === "unread"
    ? activeNotifications.filter((item) => !item.read)
    : activeNotifications;

  const clearNotificationHistory = () => {
    // Keep compact ID tombstones so the same catalog event is never announced again.
    const dismissed = dismissNotificationHistory(notifications);
    setNotifications(dismissed);
    localStorage.setItem(notificationStorageKey, JSON.stringify(dismissed));
    void syncUserData({ notifications: dismissed });
  };

  const openNotifications = () => {
    setPage("concursos");
    setJumpToNotifications(true);
  };

  useEffect(() => {
    if (page !== "concursos" || !jumpToNotifications) return;
    notificationsSectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    setJumpToNotifications(false);
  }, [page, jumpToNotifications]);

  const openAdminEditor = (item = null) => {
    setDiscoveryDraftId(null);
    setAdminEditingId(item?.id ?? null);
    setAdminDraft({
      cargo: "", orgao: "", sigla: "", vagas: "", nivel: "", area: "Federal",
      estado: "Brasil", localidade: "Brasil", status: "Pré-edital / anunciado",
      atoOficial: "", sourceUrl: "", observacao: "", vinculo: "",
      ...(item || {}),
      vagas: item?.vagas == null ? "" : String(item.vagas)
    });
    setAdminMessage("");
    setAdminMessageType("info");
  };

  const openDiscoveryDraft = (item) => {
    setDiscoveryDraftId(item.id);
    setAdminEditingId(null);
    setAdminDraft({
      cargo: String(item.title || "Oportunidade identificada").slice(0, 160),
      orgao: "",
      sigla: "",
      vagas: "",
      nivel: "",
      area: "Federal",
      estado: "Brasil",
      localidade: "Brasil",
      status: item.discovery_type === "new_link" ? "Edital a verificar" : item.discovery_type === "source_baseline" ? "A verificar na fonte oficial" : "Pré-edital / anunciado",
      atoOficial: "",
      sourceUrl: item.candidate_url || item.source_url,
      observacao: [
        "Oportunidade detectada automaticamente pelo monitor de fontes do EditalRadar.",
        "Página monitorada: " + item.source_url,
        "Contexto: " + (item.context || "Não informado"),
        "Revise a publicação oficial e preencha os dados antes de salvar."
      ].join("\n"),
      vinculo: ""
    });
    setAdminMessage("");
    setAdminMessageType("info");
  };

  const dismissDiscovery = async (item) => {
    if (!isAdmin || !authClient) return;
    setAdminBusy(true);
    setAdminMessage("");
    try {
      const { error } = await authClient.from("contest_discoveries").update({
        status: "dismissed",
        reviewed_at: new Date().toISOString(),
        reviewed_by: authUser?.id || null
      }).eq("id", item.id);
      if (error) throw error;
      setDiscoveryItems(current => current.filter(row => String(row.id) !== String(item.id)));
      setAdminMessage("Oportunidade descartada da fila.");
      setAdminMessageType("success");
    } catch (error) {
      setAdminMessage(error?.message || "Não foi possível descartar esta descoberta.");
      setAdminMessageType("error");
    } finally {
      setAdminBusy(false);
    }
  };

  const saveAdminContest = async (event) => {
    event.preventDefault();
    if (!isAdmin || !authClient) return;
    const cargo = String(adminDraft.cargo || "").trim();
    const orgao = String(adminDraft.orgao || "").trim();
    const sourceUrlValue = String(adminDraft.sourceUrl || "").trim();
    if (!cargo || !orgao || !adminDraft.nivel || !adminDraft.area || !adminDraft.status) {
      setAdminMessage("Preencha cargo, órgão, escolaridade, esfera e situação.");
      setAdminMessageType("error");
      return;
    }
    if (!/^https:\/\//i.test(sourceUrlValue)) {
      setAdminMessage("Informe um link oficial iniciado por https://.");
      setAdminMessageType("error");
      return;
    }
    const vacancyText = String(adminDraft.vagas ?? "").trim();
    const vagas = vacancyText === "" ? null : Number(vacancyText);
    if (vagas !== null && (!Number.isInteger(vagas) || vagas < 0)) {
      setAdminMessage("O número de vagas deve ser um inteiro igual ou maior que zero.");
      setAdminMessageType("error");
      return;
    }
    const data = {
      cargo, orgao,
      sigla: String(adminDraft.sigla || "").trim().slice(0,12) || orgao.slice(0,6).toUpperCase(),
      vagas, nivel: String(adminDraft.nivel).trim(), area: String(adminDraft.area).trim(),
      estado: String(adminDraft.estado || "Brasil").trim(),
      localidade: String(adminDraft.localidade || "Brasil").trim(),
      status: String(adminDraft.status).trim(),
      atoOficial: String(adminDraft.atoOficial || "").trim(),
      sourceUrl: sourceUrlValue,
      observacao: String(adminDraft.observacao || "").trim(),
      vinculo: String(adminDraft.vinculo || "").trim(),
      historicoAtualizacoes: Array.isArray(adminDraft.historicoAtualizacoes) ? adminDraft.historicoAtualizacoes : []
    };
    setAdminBusy(true);
    setAdminMessage("");
    try {
      const payload = { data, deleted: false, updated_at: new Date().toISOString() };
      if (adminEditingId !== null) payload.id = Number(adminEditingId);
      const { data: saved, error } = await authClient.from("contest_catalog")
        .upsert(payload).select("id, data, deleted, updated_at").single();
      if (error) throw error;
      const record = { ...saved, id: Number(saved.id), data: { ...saved.data, id: Number(saved.id) }, deleted: false };
      setCatalogOverrides(current => [...current.filter(row => String(row.id)!==String(record.id)),record]);
      const editing = adminEditingId !== null;
      let successMessage = editing ? "Concurso atualizado com sucesso." : "Concurso cadastrado com sucesso.";
      if (discoveryDraftId !== null) {
        const { error: reviewError } = await authClient.from("contest_discoveries").update({
          status: "published",
          reviewed_at: new Date().toISOString(),
          reviewed_by: authUser?.id || null,
          published_catalog_id: Number(saved.id)
        }).eq("id", discoveryDraftId);
        if (reviewError) {
          successMessage = "Concurso salvo, mas não foi possível concluir a revisão na fila: " + reviewError.message;
        } else {
          setDiscoveryItems(current => current.filter(row => String(row.id) !== String(discoveryDraftId)));
        }
        setDiscoveryDraftId(null);
      }
      setAdminDraft(null);
      setAdminMessage(successMessage);
      setAdminMessageType("success");
    } catch(error) {
      setAdminMessage(error?.message || "Não foi possível salvar. Confira a migração e sua permissão.");
      setAdminMessageType("error");
    } finally {
      setAdminBusy(false);
    }
  };

  const removeAdminContest = async (item) => {
    if (!isAdmin || !authClient || !window.confirm(`Remover "${item.cargo}" do catálogo?`)) return;
    setAdminBusy(true);
    setAdminMessage("");
    try {
      const payload = { id: Number(item.id), data: { ...item }, deleted: true, updated_at: new Date().toISOString() };
      const { data: saved, error } = await authClient.from("contest_catalog")
        .upsert(payload).select("id, data, deleted, updated_at").single();
      if (error) throw error;
      const record = { ...saved, id: Number(saved.id), data: { ...saved.data, id: Number(saved.id) }, deleted: true };
      setCatalogOverrides(current => [...current.filter(row => String(row.id)!==String(record.id)),record]);
      setAdminMessage("Concurso removido do catálogo.");
      setAdminMessageType("success");
    } catch(error) {
      setAdminMessage(error?.message || "Não foi possível remover este concurso.");
      setAdminMessageType("error");
    } finally {
      setAdminBusy(false);
    }
  };

  const toggleTask = (index) => {
    const next = tasks.map((done, i) => i === index ? !done : done);
    setTasks(next);
    localStorage.setItem("er-tasks", JSON.stringify(next));
    void syncUserData({ tasks: next });
  };
  const progress = Math.round(tasks.filter(Boolean).length / tasks.length * 100);
  const catalogCount = catalog.filter(Boolean).length;
  const preliminaryCount = catalog.filter(isPreliminary).length;
  const verifiedRecords = catalog.filter((item) => item && !isPreliminary(item));
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
        {isAdmin && <button className={page === "admin" ? "nav-item active" : "nav-item"} onClick={() => setPage("admin")} aria-label="Administração"><span aria-hidden="true">⚙</span> Administração</button>}
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">✦</span><strong>Seu futuro começa com planejamento.</strong><p>Organize sua preparação e acompanhe suas oportunidades.</p><button onClick={() => setPage("estudos")}>Ver meu plano →</button></div>
          <div className="profile"><div className="avatar">{(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "C")[0]?.toUpperCase() || "C"}</div><div className="profile-copy" title={authUser?.email || "Modo visitante"}><strong>{authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "Concurseiro"}</strong><small>{!authUser ? "Modo visitante" : syncStatus === "loading" || syncStatus === "syncing" ? "Sincronizando dados..." : syncStatus === "synced" ? "Dados sincronizados" : syncStatus === "error" ? "Falha na sincronização" : "Conta conectada"}</small></div><button className="dots profile-edit" type="button" onClick={openProfileEditor} aria-label={authUser ? "Editar perfil" : "Entrar para editar perfil"}>Editar</button></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">Início <span>/</span> {page === "concursos" ? "Concursos" : page === "estudos" ? "Área de estudos" : page === "admin" ? "Administração" : "Meus favoritos"}</div>
          <div className="top-actions"><span className="date-chip">◷ &nbsp;Sua jornada começa hoje</span><button className="install-trigger" type="button" onClick={handleInstallApp} disabled={isAppInstalled}>{isAppInstalled ? "App instalado" : deferredInstallPrompt ? "Instalar app" : "Como instalar"}</button><button className="notification-bell" type="button" onClick={openNotifications} aria-label={`Ver notificações (${unreadNotificationCount} não lidas)`} title="Ver notificações">♧{unreadNotificationCount > 0 && <span>{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}</button>{authUser ? <button className="auth-trigger" onClick={handleSignOut} disabled={!authReady}>Sair da conta</button> : <button className="auth-trigger" onClick={() => { setShowAuth(true); setAuthMessage(""); }}>Entrar / cadastrar</button>}<div className="mini-avatar">{(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "C")[0]?.toUpperCase() || "C"}</div></div>
        </header>
        {!isOnline && <div className="offline-status" role="status">Você está offline. O catálogo em cache e os dados locais continuam acessíveis; login e sincronização precisam de internet.</div>}

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
        ) : page === "admin" && isAdmin ? (
          <section className="content admin-page">
            <div className="eyebrow">GESTÃO DO CATÁLOGO</div>
            <h1>Administração</h1>
            <p className="subhead">Cadastre, revise e remova oportunidades. As alterações são exibidas para todos os usuários.</p>
            <div className="panel admin-panel">
              <div className="admin-panel-heading">
                <div><strong>Concursos cadastrados</strong><small>{catalog.length} oportunidade(s) no catálogo</small></div>
                <button className="primary-btn" type="button" onClick={() => openAdminEditor()}>＋ Novo concurso</button>
              </div>
              {catalogSyncMessage && <p className="auth-message info" role="status">Catálogo base mantido. {catalogSyncMessage}</p>}
              <div className="admin-list">
                {catalog.map(item => <article className="admin-row" key={item.id}>
                  <div className="admin-row-copy"><strong>{item.cargo}</strong><span>{item.orgao} · {item.estado || "Brasil"} · {item.status}</span>
                    {Array.isArray(item.historicoAtualizacoes) && item.historicoAtualizacoes.length > 0 && <small>Histórico de {item.historicoAtualizacoes.length} atualização(ões). Última: {item.historicoAtualizacoes[item.historicoAtualizacoes.length - 1].at ? new Date(item.historicoAtualizacoes[item.historicoAtualizacoes.length - 1].at).toLocaleString("pt-BR") : "data não informada"}.</small>}
                  </div>
                  <div className="admin-row-actions">
                    <button className="detail-btn" type="button" onClick={() => openAdminEditor(item)} disabled={adminBusy}>Editar</button>
                    <button className="alert-remove" type="button" onClick={() => removeAdminContest(item)} disabled={adminBusy}>Remover</button>
                  </div>
                </article>)}
              </div>
            </div>
            <div className="panel admin-panel discovery-panel">
              <div className="admin-panel-heading">
                <div><strong>Fila de revisão de oportunidades</strong><small>{discoveryItems.length} descoberta(s) aguardando análise</small></div>
                <span className="discovery-status-pill">Revisão manual</span>
              </div>
              <p className="muted discovery-help">O monitor identifica páginas alteradas e novos links em fontes oficiais. Nenhuma descoberta entra no catálogo sem sua conferência e aprovação.</p>
              {discoverySyncMessage && <p className="auth-message info" role="status">Fila indisponível. Execute a migração <strong>202611220003_contest_discoveries.sql</strong> no Supabase e configure os secrets do GitHub Actions. Detalhe: {discoverySyncMessage}</p>}
              {discoveryLoading ? <p className="muted">Carregando descobertas...</p> : discoveryItems.length === 0 ? (
                <div className="discovery-empty">Nenhuma oportunidade pendente no momento.</div>
              ) : (
                <div className="admin-list discovery-list">
                  {discoveryItems.map(item => <article className="admin-row discovery-row" key={item.id}>
                    <div className="admin-row-copy">
                      <strong>{item.title}</strong>
                      <span>{item.discovery_type === "new_link" ? "Novo link identificado" : item.discovery_type === "source_baseline" ? "Fonte para verificação inicial" : "Página oficial alterada"} · {item.detected_at ? new Date(item.detected_at).toLocaleString("pt-BR") : "Data não informada"}</span>
                      <small>{item.context}</small>
                      <a href={item.candidate_url} target="_blank" rel="noreferrer">Abrir publicação ou página identificada ↗</a>
                    </div>
                    <div className="admin-row-actions">
                      <button className="detail-btn" type="button" onClick={() => openDiscoveryDraft(item)} disabled={adminBusy}>Revisar e cadastrar</button>
                      <button className="alert-remove" type="button" onClick={() => dismissDiscovery(item)} disabled={adminBusy}>Descartar</button>
                    </div>
                  </article>)}
                </div>
              )}
              {adminMessage && <p className={`auth-message ${adminMessageType}`} role="status">{adminMessage}</p>}
            </div>
            <p className="disclaimer">Confira sempre o edital e a página oficial do órgão ou banca antes de alterar a situação de uma oportunidade.</p>
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
            <section className="notification-panel" aria-label="Notificações do EditalRadar" ref={notificationsSectionRef}>
              <div className="notification-heading">
                <div>
                  <div className="eyebrow">AVISOS DO EDITALRADAR</div>
                  <h2>Notificações {unreadNotificationCount > 0 && <span className="notification-count">{unreadNotificationCount}</span>}</h2>
                  <p>Novos concursos, retificações oficiais e atualizações dos seus favoritos.</p>
                  {authUser && !notificationCloudSyncAvailable && <p className="notification-sync-hint">Para sincronizar este histórico entre aparelhos, execute no SQL Editor do Supabase o arquivo <strong>supabase/migrations/202611220001_user_notifications.sql</strong> e depois atualize o aplicativo.</p>}
                </div>
                <div className="notification-actions">
                  <button className="detail-btn" type="button" onClick={enableBrowserNotifications} disabled={notificationPermission === "unsupported" || (notificationPermission === "granted" && browserNotificationsEnabled)}>
                    {notificationPermission === "granted" && browserNotificationsEnabled ? "Notificações ativadas" : notificationPermission === "denied" ? "Permissão bloqueada" : "Ativar no navegador"}
                  </button>
                  {unreadNotificationCount > 0 && <button className="alert-remove" type="button" onClick={markAllNotificationsRead}>Marcar como lidas</button>}
                  {activeNotifications.length > 0 && <button className="alert-remove" type="button" onClick={clearNotificationHistory}>Limpar histórico</button>}
                </div>
              </div>
              <div className="notification-filters" role="group" aria-label="Filtrar notificações">
                <button type="button" className={notificationView === "all" ? "notification-filter active" : "notification-filter"} aria-pressed={notificationView === "all"} onClick={() => setNotificationView("all")}>Todas ({activeNotifications.length})</button>
                <button type="button" className={notificationView === "unread" ? "notification-filter active" : "notification-filter"} aria-pressed={notificationView === "unread"} onClick={() => setNotificationView("unread")}>Não lidas ({unreadNotificationCount})</button>
              </div>
              {visibleNotifications.length > 0 ? (
                <div className="notification-list">
                  {visibleNotifications.slice(0, 8).map((notification) => (
                    <div className="notification-entry" key={notification.id}>
                      <button className={notification.read ? "notification-item read" : "notification-item"} type="button" onClick={() => openNotification(notification)}>
                        <span className="notification-dot" aria-hidden="true" />
                        <span className="notification-copy"><strong>{notification.title}</strong><small>{notification.message}</small></span>
                        <span className="notification-open">Ver ↗</span>
                      </button>
                      <button
                        className="notification-dismiss"
                        type="button"
                        aria-label="Dispensar este aviso"
                        title="Dispensar este aviso"
                        onClick={() => dismissSingleNotification(notification.id)}
                      >×</button>
                    </div>
                  ))}
                </div>
              ) : <p className="alerts-empty">{activeNotifications.length === 0 ? "Nenhuma novidade por enquanto. Quando o catálogo receber novos concursos ou um favorito for atualizado, o aviso aparecerá aqui." : "Não há notificações não lidas. Você já conferiu todas as novidades."}</p>}
              <small className="alerts-note">
                {notificationPermission === "granted" && browserNotificationsEnabled
                  ? "Notificações de desktop ativadas neste navegador."
                  : notificationPermission === "denied"
                    ? "O navegador bloqueou os avisos de desktop; os avisos internos continuam disponíveis."
                    : notificationPermission === "unsupported"
                      ? "Seu navegador não oferece notificações de desktop."
                      : "Ative os avisos do navegador para receber uma notificação quando o EditalRadar detectar novidades."}
                {" "}Os avisos são detectados quando você abre ou atualiza o site após uma mudança no catálogo.
              </small>
              {notificationMessage && <small className="notification-feedback" role="status">{notificationMessage}</small>}
            </section>
            {authUser && profileRecommendations.length>0 && page!=="favoritos" && (
              <section className="recommendations-panel" aria-label="Recomendações personalizadas">
                <div className="recommendations-heading"><div><div className="eyebrow">PARA O SEU PERFIL</div><h2>Concursos recomendados</h2><p>Prioridade calculada com sua área de interesse, escolaridade e localização informadas.</p></div><button className="recommendations-edit" onClick={openProfileEditor}>Atualizar perfil</button></div>
                <div className="recommendations-list">{profileRecommendations.map(({item,score})=>(
                  <article className="recommendation-card" key={item.id}>
                    <div className="recommendation-score"><strong>{score}%</strong><small>compatibilidade</small></div>
                    <div className="recommendation-info"><strong>{item.cargo}</strong><span>{item.orgao} · {item.estado||"Brasil"}</span><small>{item.status}</small></div>
                    <button className="recommendation-open" onClick={()=>setSelected(item)}>Ver detalhes</button>
                  </article>
                ))}</div>
              </section>
            )}
            <div className="section-title"><div><div className="eyebrow">CATÁLOGO DE OPORTUNIDADES</div><h2>{page === "favoritos" ? "Seus concursos favoritos" : "Concursos e avisos no catálogo"}</h2></div><span className="results">{(page === "favoritos" ? filtered.filter(c => favorites.includes(c.id)) : filtered).length} registros</span></div>
            <div className="filters">
              <label className="search-filter"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cargo ou órgão..." /></label>
              <select aria-label="Esfera" value={esfera} onChange={(e) => setEsfera(e.target.value)}><option>Todas as esferas</option>{["Federal", "Estadual", "Municipal"].map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option>Todos os estados</option>{estados.map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Cidade" value={localidade} onChange={(e) => setLocalidade(e.target.value)}><option>Todas as cidades</option>{cidades.map(x => <option key={x}>{x}</option>)}</select>
              <select aria-label="Escolaridade" value={nivel} onChange={(e) => setNivel(e.target.value)}><option>Todos os níveis</option>{[...new Set(catalog.map(c => c.nivel))].sort().map(x => <option key={x}>{x}</option>)}</select>
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
        <footer>© 2026 EditalRadar · Software proprietário. Todos os direitos reservados.</footer>
      </main>

      {adminDraft && isAdmin && <div className="modal-backdrop" onClick={() => !adminBusy && setAdminDraft(null)}>
        <section className="modal auth-modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-editor-title" onClick={e => e.stopPropagation()}>
          <button className="modal-close" type="button" onClick={() => !adminBusy && setAdminDraft(null)} aria-label="Fechar formulário do concurso">×</button>
          <div className="eyebrow">GESTÃO DO CATÁLOGO</div><h2 id="admin-editor-title">{adminEditingId === null ? "Novo concurso" : "Editar concurso"}</h2>
          <form className="auth-form admin-form" onSubmit={saveAdminContest}>
            <label>Cargo<input aria-label="Cargo" value={adminDraft.cargo} onChange={e=>setAdminDraft(d=>({...d,cargo:e.target.value}))} required maxLength={160}/></label>
            <label>Órgão<input aria-label="Órgão" value={adminDraft.orgao} onChange={e=>setAdminDraft(d=>({...d,orgao:e.target.value}))} required maxLength={160}/></label>
            <div className="admin-form-grid">
              <label>Sigla<input aria-label="Sigla" value={adminDraft.sigla} onChange={e=>setAdminDraft(d=>({...d,sigla:e.target.value}))} maxLength={12}/></label>
              <label>Vagas<input aria-label="Vagas" type="number" min="0" step="1" value={adminDraft.vagas} onChange={e=>setAdminDraft(d=>({...d,vagas:e.target.value}))} placeholder="A divulgar"/></label>
              <label>Escolaridade<select aria-label="Escolaridade" value={adminDraft.nivel} onChange={e=>setAdminDraft(d=>({...d,nivel:e.target.value}))} required><option value="">Selecione</option>{["Fundamental","Médio","Técnico","Superior","Todos os níveis","Não informado"].map(x=><option key={x}>{x}</option>)}</select></label>
              <label>Esfera<select aria-label="Esfera do concurso" value={adminDraft.area} onChange={e=>setAdminDraft(d=>({...d,area:e.target.value}))} required>{["Federal","Estadual","Municipal"].map(x=><option key={x}>{x}</option>)}</select></label>
              <label>Estado<input aria-label="Estado" value={adminDraft.estado} onChange={e=>setAdminDraft(d=>({...d,estado:e.target.value}))} maxLength={80}/></label>
              <label>Cidade<input aria-label="Cidade" value={adminDraft.localidade} onChange={e=>setAdminDraft(d=>({...d,localidade:e.target.value}))} maxLength={100}/></label>
              <label>Situação<input aria-label="Situação" value={adminDraft.status} onChange={e=>setAdminDraft(d=>({...d,status:e.target.value}))} required maxLength={100}/></label>
              <label>Vínculo<input aria-label="Vínculo" value={adminDraft.vinculo} onChange={e=>setAdminDraft(d=>({...d,vinculo:e.target.value}))} maxLength={100}/></label>
            </div>
            <label>Edital ou ato oficial<input aria-label="Edital ou ato oficial" value={adminDraft.atoOficial} onChange={e=>setAdminDraft(d=>({...d,atoOficial:e.target.value}))} maxLength={180}/></label>
            <label>Link oficial (HTTPS)<input aria-label="Link oficial (HTTPS)" type="url" value={adminDraft.sourceUrl} onChange={e=>setAdminDraft(d=>({...d,sourceUrl:e.target.value}))} required placeholder="https://..."/></label>
            <label>Observações<textarea aria-label="Observações" rows={3} maxLength={1200} value={adminDraft.observacao} onChange={e=>setAdminDraft(d=>({...d,observacao:e.target.value}))}/></label>
            <button className="primary-btn full" type="submit" disabled={adminBusy}>{adminBusy ? "Salvando..." : "Salvar concurso"}</button>
            {adminMessage && <p className={`auth-message ${adminMessageType}`} role="status">{adminMessage}</p>}
          </form>
        </section>
      </div>}
      {showInstallHelp && <div className="modal-backdrop" onClick={() => setShowInstallHelp(false)}>
        <section className="modal auth-modal install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setShowInstallHelp(false)} aria-label="Fechar instruções de instalação">×</button>
          <div className="eyebrow">EDITALRADAR NO SEU DISPOSITIVO</div>
          <h2 id="install-title">Instale o EditalRadar</h2>
          <p className="muted">Adicione o aplicativo à tela inicial para abrir em uma janela própria e acessar o catálogo já carregado mesmo quando estiver sem conexão.</p>
          <div className="install-steps">
            <div><strong>Android</strong><p>No Chrome, abra o menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.</p></div>
            <div><strong>iPhone ou iPad</strong><p>No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p></div>
            <div><strong>Computador</strong><p>No Chrome ou Edge, use o ícone de instalação na barra de endereço ou procure “Instalar EditalRadar” no menu.</p></div>
          </div>
          <button className="primary-btn full" type="button" onClick={() => setShowInstallHelp(false)}>Entendi</button>
        </section>
      </div>}
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
          <p className="muted">Personalize seu perfil para acompanhar oportunidades mais relevantes. As informações ficam salvas na sua conta.</p>
          <form className="auth-form profile-form" onSubmit={handleProfileSubmit}>
            <label>Nome de exibição<input type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} autoComplete="name" maxLength={60} required placeholder="Como quer ser chamado?" /></label>
            <div className="profile-grid">
              <label>Cidade<input type="text" value={profileCity} onChange={(event) => setProfileCity(event.target.value)} autoComplete="address-level2" maxLength={80} placeholder="Ex.: Maceió" /></label>
              <label>Estado<select value={profileState} onChange={(event) => setProfileState(event.target.value)} autoComplete="address-level1"><option value="">Selecione</option>{brazilianStates.map((state) => <option key={state} value={state}>{state}</option>)}</select></label>
              <label>Escolaridade<select value={profileEducation} onChange={(event) => setProfileEducation(event.target.value)}><option value="">Selecione</option>{["Ensino fundamental", "Ensino médio", "Técnico", "Superior incompleto", "Superior completo", "Pós-graduação"].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
              <label>Área de interesse<select value={profileArea} onChange={(event) => setProfileArea(event.target.value)}><option value="">Selecione</option>{["Administrativa", "Policial", "Tribunais", "Fiscal e controle", "Bancária", "Educação", "Saúde", "Jurídica", "Tecnologia", "Outras"].map((area) => <option key={area} value={area}>{area}</option>)}</select></label>
            </div>
            <button className="primary-btn full" type="submit" disabled={profileBusy}>{profileBusy ? "Salvando..." : "Salvar perfil"}</button>
            {profileMessage && <p className={`auth-message ${profileMessageType}`} role="status">{profileMessage}</p>}
          </form>
        </section>
      </div>}
            {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)}>×</button><span className={`status ${isPreliminary(selected) ? "preliminary" : ""}`}><i />{selected.status}</span><div className="eyebrow">DETALHES DA SELEÇÃO</div><h2>{selected.cargo}</h2><p className="org-name">{selected.orgao}</p><div className="modal-facts"><div><small>Vagas informadas</small><strong>{selected.vagas == null ? "A divulgar" : selected.vagas}</strong></div><div><small>Escolaridade</small><strong>{selected.nivel}</strong></div><div><small>Vínculo</small><strong>{selected.vinculo || "Não informado"}</strong></div><div><small>{isPreliminary(selected) ? "Referência cadastrada" : "Ato oficial"}</small><strong>{selected.atoOficial || "Não informado"}</strong></div></div><p className="muted">{selected.observacao}</p><a className="primary-btn full modal-source-link" href={selected.sourceUrl || sourceUrl} target="_blank" rel="noreferrer">{isPreliminary(selected) ? "Abrir listagem de referência — não é edital ↗" : "Consultar página oficial do concurso ↗"}</a><button className="detail-btn full" onClick={() => toggleFavorite(selected.id)} disabled={Boolean(authUser && syncStatus === "loading")}>{favorites.includes(selected.id) ? "Remover dos favoritos" : "Salvar nos favoritos"}</button></div></div>}
    </div>
  );
}
