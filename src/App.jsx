import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "./lib/supabaseClient";
import { concursos, sourceUrl, sourceUpdated, fetchedAt } from "./data/concursos";
import { detectCatalogNotifications, dismissNotificationById, dismissNotificationHistory, getVisibleNotifications, mergeNotificationHistory } from "./lib/notifications";
import { applyCatalogOverrides } from "./lib/catalog";
import { isTrustedOfficialUrl, officialSourceLabel, parseHttpsUrl } from "./lib/official-sources.js";
import { getUpcomingMilestones } from "./lib/dashboard";
import { parseBrazilianNumber } from "./lib/brazilian-numbers.js";
import { buildCsv } from "./lib/csv-export.js";
import { buildContestChangeHistory, formatContestHistoryDate } from "./lib/admin-history.js";
import { classifyDiscoveryKind, classifyDiscoveryTopic, discoveryKindLabel, discoveryTopicLabel, discoveryStatusLabel, filterDiscoveries, countDiscoveriesByStatus } from "./lib/discovery-filters.js";
const StudyArea = React.lazy(() => import("./StudyArea.jsx"));
const StudyQuestionAdmin = React.lazy(() => import("./StudyQuestionAdmin.jsx"));

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

const accountStorageKey = (userId, key) => `er-account:${userId}:${key}`;
const readUserDataStore = (userId, key, fallback) =>
  readStore(userId ? accountStorageKey(userId, key) : `er-${key}`, fallback);
const persistUserDataStore = (userId, key, value) => {
  const storageKey = userId ? accountStorageKey(userId, key) : `er-${key}`;
  localStorage.setItem(storageKey, JSON.stringify(value));
};

const isMissingNotificationsColumn = (error) =>
  ["42703", "PGRST204"].includes(error?.code)
  || /notifications.*(column|schema cache)|column.*notifications/i.test(error?.message || "");

const matchesFilters = (item, filters) => {
  const text = [item.sigla, item.cargo, item.orgao, item.vinculo, item.atoOficial, item.nivel, item.area, item.estado, item.localidade, item.status].join(" ").toLowerCase();
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
const getStatusTone = (value = "") => {
  const status = String(value).toLocaleLowerCase("pt-BR");
  if (/inscri.{0,18}abertas|edital publicado/.test(status)) return "status-open";
  if (/pré.?edital|autorizad|anunciad|previst|comissão formada/.test(status)) return "status-upcoming";
  if (/encerrad|finalizad|homologad|cancelad|suspens/.test(status)) return "status-closed";
  if (/prova|resultado|convoca|classifica/.test(status)) return "status-stage";
  return "status-neutral";
};



const PORTUGUESE_MONTHS = {
  janeiro: 0, fevereiro: 1, "março": 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11
};

const extractContestTimeline = (item) => {
  if (!item || typeof item !== "object") return [];
  const fields = [
    { origin: "Situação atual", value: item.status || "" },
    { origin: "Observações da ficha", value: item.observacao || "" },
    { origin: "Ato oficial informado", value: item.atoOficial || "" }
  ];
  const events = [];
  const seen = new Set();
  const patterns = [
    /\b(\d{2})\/(\d{2})\/(\d{4})\b/g,
    /\b(\d{1,2})º?\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi
  ];
  for (const field of fields) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(field.value)) !== null) {
        let day;
        let month;
        let year;
        if (pattern === patterns[0]) {
          day = Number(match[1]);
          month = Number(match[2]) - 1;
          year = Number(match[3]);
        } else {
          day = Number(match[1]);
          month = PORTUGUESE_MONTHS[match[2].toLocaleLowerCase("pt-BR")];
          year = Number(match[3]);
        }
        const date = new Date(year, month, day, 12, 0, 0, 0);
        if (!Number.isInteger(month) || date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) continue;
        const context = field.value.slice(Math.max(0, match.index - 95), Math.min(field.value.length, match.index + match[0].length + 65));
        const normalized = context.toLocaleLowerCase("pt-BR");
        const label = /inscri|prazo/.test(normalized) ? "Inscrições e prazos"
          : /prova|exame/.test(normalized) ? "Prova ou avaliação"
          : /resultado|gabarito|classifica|convoca/.test(normalized) ? "Resultado ou etapa"
          : /edital|portaria|publica|retifica|autoriza/.test(normalized) ? "Publicação oficial"
          : "Data mencionada na ficha";
        const key = date.toISOString().slice(0, 10) + "|" + label;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({ date, label, origin: field.origin, context: context.replace(/\s+/g, " ").trim() });
      }
    }
  }
  return events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.label.localeCompare(b.label, "pt-BR"));
};

const getAdditionalOfficialDocuments = (item) => {
  const documents = Array.isArray(item?.documentos) ? item.documentos
    : Array.isArray(item?.documents) ? item.documents : [];
  return documents.filter((document) => {
    const url = typeof document === "string" ? document : document?.url || document?.href;
    return isTrustedOfficialUrl(url);
  }).map((document) => ({
    title: typeof document === "string" ? "Documento oficial" : document.title || document.titulo || document.label || "Documento oficial",
    url: typeof document === "string" ? document : document.url || document.href,
    description: typeof document === "string" ? "" : document.description || document.descricao || ""
  }));
};


const getContestRemuneration = (item) => {
  const raw = item?.remuneracao ?? item?.salario ?? item?.salarioInicial
    ?? item?.remuneracaoInicial ?? item?.vencimento ?? item?.salarioBase;
  if (raw == null || raw === "") return null;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { valor: raw };
};

const formatContestMoney = (value) => {
  if (value == null || value === "") return "";
  const numeric = typeof value === "number"
    ? value
    : Number(String(value).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(numeric)
    : String(value).trim();
};

const getContestSalary = (item) => {
  const remuneration = getContestRemuneration(item);
  if (!remuneration?.valor) return "Não informado nesta ficha";
  const amount = formatContestMoney(remuneration.valor);
  const nature = remuneration.natureza ? " · " + remuneration.natureza : "";
  return amount + nature;
};
const getSalaryAmount = (item) => {
  const raw = getContestRemuneration(item)?.valor;
  return parseBrazilianNumber(raw, { pick: "highest" });
};
const getVacancyAmount = (item) => {
  const raw = item?.vagasTotais ?? item?.vagas;
  return parseBrazilianNumber(raw);
};
const getStatusPriority = (item) => ({
  "status-open": 0,
  "status-upcoming": 1,
  "status-stage": 2,
  "status-neutral": 3,
  "status-closed": 4
}[getStatusTone(item?.status)] ?? 5);


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
  const [sortMode, setSortMode] = useState(() => readStore("er-catalog-sort", "catalog"));
  const [catalogView, setCatalogView] = useState(() => readStore("er-catalog-view", "grid"));
  const [exportMessage, setExportMessage] = useState("");

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
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoveryKind, setDiscoveryKind] = useState("all");
  const [discoveryTopic, setDiscoveryTopic] = useState("all");
  const [discoveryStatus, setDiscoveryStatus] = useState("pending");
  const [discoveryPeriod, setDiscoveryPeriod] = useState("all");
  const [discoveryDraftId, setDiscoveryDraftId] = useState(null);
  const [adminDraft, setAdminDraft] = useState(null);
  const [adminEditingId, setAdminEditingId] = useState(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminMessageType, setAdminMessageType] = useState("info");
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : typeof window !== "undefined" && typeof window.EditalRadarNative?.requestNotificationPermission === "function"
        ? "default"
        : "unsupported"
  );
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(() =>
    readStore("er-browser-notifications", false) === true
  );
  const [notificationMessage, setNotificationMessage] = useState("");
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [notificationView, setNotificationView] = useState("all");
  const [notificationLimit, setNotificationLimit] = useState(8);
  const [jumpToNotifications, setJumpToNotifications] = useState(false);
  const notificationsSectionRef = useRef(null);
  const [favorites, setFavorites] = useState(() => readStore("er-favorites", []));
  const [tasks, setTasks] = useState(() => readStore("er-tasks", [false, false, false, false]));
  const [selected, setSelected] = useState(null);
  const [detailOrigin, setDetailOrigin] = useState("concursos");
  const [comparisonIds, setComparisonIds] = useState(() => readStore("er-comparison:visitor", []));
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("local");
  const syncQueueRef = useRef(Promise.resolve());
  const syncReadyUserRef = useRef(null);
  const notificationsColumnAvailableRef = useRef(null);
  const pendingChangesRef = useRef({});
  const pendingWritesRef = useRef(0);
  const fcmTokenRef = useRef(null);
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
  const comparisonStorageKey = "er-comparison:" + (authUser?.id || "visitor");
  const catalog = useMemo(() => applyCatalogOverrides(concursos, catalogOverrides), [catalogOverrides]);
  const isAdmin = authUser?.app_metadata?.role === "admin";
  const openContestDetails = (contest) => {
    if (!contest) return;
    setDetailOrigin(page === "favoritos" ? "favoritos" : "concursos");
    setSelected(contest);
    setPage("detalhes");
  };
  const closeContestDetails = () => {
    setPage(detailOrigin);
    setSelected(null);
  };
  const selectedTimeline = useMemo(() => extractContestTimeline(selected), [selected]);
  const selectedDocuments = useMemo(() => getAdditionalOfficialDocuments(selected), [selected]);
  const selectedSourceReference = parseHttpsUrl(selected?.sourceUrl);
  const selectedSourceUrl = selectedSourceReference ? selectedSourceReference.href : sourceUrl;
  const selectedSourceIsOfficial = isTrustedOfficialUrl(selectedSourceUrl);
  const selectedRemuneration = getContestRemuneration(selected);
  const selectedSalarySourceUrl = isTrustedOfficialUrl(selectedRemuneration?.sourceUrl)
    ? selectedRemuneration.sourceUrl
    : "";
  const comparisonItems = useMemo(
    () => (Array.isArray(comparisonIds) ? comparisonIds : [])
      .map((id) => catalog.find((item) => String(item.id) === String(id)))
      .filter(Boolean)
      .slice(0, 3),
    [comparisonIds, catalog]
  );
  const persistComparison = (next) => {
    const normalized = next.slice(0, 3);
    setComparisonIds(normalized);
    try { localStorage.setItem(comparisonStorageKey, JSON.stringify(normalized)); } catch { /* comparação continua nesta sessão */ }
  };
  const toggleComparison = (item) => {
    const exists = comparisonItems.some((entry) => String(entry.id) === String(item.id));
    if (exists) {
      persistComparison(comparisonItems.filter((entry) => String(entry.id) !== String(item.id)).map((entry) => entry.id));
    } else if (comparisonItems.length < 3) {
      persistComparison([...comparisonItems.map((entry) => entry.id), item.id]);
    }
  };
  const removeFromComparison = (itemId) => {
    persistComparison(comparisonItems.filter((entry) => String(entry.id) !== String(itemId)).map((entry) => entry.id));
  };
  const clearComparison = () => persistComparison([]);

  useLayoutEffect(() => {
    const stored = readStore(comparisonStorageKey, []);
    setComparisonIds(Array.isArray(stored) ? stored.slice(0, 3) : []);
  }, [comparisonStorageKey]);

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

    const handleNativeNotificationPermission = (event) => {
      const enabled = event?.detail?.granted === true;
      setNotificationPermission(enabled ? "granted" : "denied");
      setBrowserNotificationsEnabled(enabled);
      localStorage.setItem("er-browser-notifications", JSON.stringify(enabled));
      setNotificationMessage(enabled
        ? "Notificações nativas ativadas neste dispositivo."
        : "A permissão de notificações não foi concedida. Os avisos internos continuam disponíveis.");
      if (enabled) {
        window.EditalRadarNative?.showNotification?.(
          "EditalRadar",
          "Notificações ativadas. Avisaremos quando o app detectar novidades.",
          "editalradar-notifications-enabled"
        );
      }
    };
    const handleNativeOAuthError = (event) => {
      setAuthMessage(event?.detail?.message || "Não foi possível concluir o acesso com Google.");
      setAuthMessageType("error");
      setAuthBusy(false);
    };
    window.addEventListener("editalradar:native-notification-permission", handleNativeNotificationPermission);
    window.addEventListener("editalradar:oauth-error", handleNativeOAuthError);

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
      window.removeEventListener("editalradar:native-notification-permission", handleNativeNotificationPermission);
      window.removeEventListener("editalradar:oauth-error", handleNativeOAuthError);
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
          .select("id, source_url, candidate_url, title, context, discovery_type, detected_at, status, reviewed_at, reviewed_by, published_catalog_id")
          .order("detected_at", { ascending: false })
          .limit(300);
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

  // O Android devolve a decisão de permissão de forma assíncrona.
  // Sem ouvir esse evento, o estado permanecia "default" e o token FCM nunca era registrado.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleNativeNotificationPermission = (event) => {
      const enabled = event?.detail?.granted === true;
      setNotificationPermission(enabled ? "granted" : "denied");
      setBrowserNotificationsEnabled(enabled);
      try {
        localStorage.setItem("er-browser-notifications", JSON.stringify(enabled));
      } catch {
        // A permissão continua válida mesmo se o armazenamento local estiver indisponível.
      }
      setNotificationMessage(enabled
        ? "Notificações nativas ativadas neste dispositivo. O cadastro do push será concluído automaticamente."
        : "A permissão não foi concedida. Autorize as notificações nas configurações do Android para receber avisos.");
    };

    window.addEventListener("editalradar:native-notification-permission", handleNativeNotificationPermission);
    return () => window.removeEventListener(
      "editalradar:native-notification-permission",
      handleNativeNotificationPermission
    );
  }, []);

  useEffect(() => {
    const nativeBridge = typeof window !== "undefined" ? window.EditalRadarNative : null;
    if (!authClient || !authUser?.id || !browserNotificationsEnabled
      || typeof nativeBridge?.requestFcmToken !== "function"
      || typeof authClient.functions?.invoke !== "function") return undefined;

    let cancelled = false;
    const registerFcmToken = async (event) => {
      const token = String(event?.detail?.token || "").trim();
      if (cancelled || token.length < 32) return;
      fcmTokenRef.current = token;
      try {
        const { error } = await authClient.functions.invoke("push-notifications", {
          body: { action: "register_device", token, platform: "android" }
        });
        if (error && !cancelled) {
          console.warn("Não foi possível registrar o token de notificações push:", error);
          setNotificationMessage("O aparelho está autorizado, mas o cadastro do push ainda não foi concluído.");
        }
      } catch (error) {
        if (!cancelled) console.warn("Falha ao registrar dispositivo para push:", error);
      }
    };
    const handleFcmStatus = (event) => {
      if (!cancelled && event?.detail?.configured === false) {
        setNotificationMessage("O recebimento de avisos com o aplicativo fechado será ativado após configurar o Firebase.");
      }
    };

    window.addEventListener("editalradar:fcm-token", registerFcmToken);
    window.addEventListener("editalradar:fcm-status", handleFcmStatus);
    nativeBridge.requestFcmToken();

    return () => {
      cancelled = true;
      window.removeEventListener("editalradar:fcm-token", registerFcmToken);
      window.removeEventListener("editalradar:fcm-status", handleFcmStatus);
    };
  }, [authClient, authUser?.id, browserNotificationsEnabled]);

  useLayoutEffect(() => {
    if (!authClient || !authUser) {
      syncReadyUserRef.current = null;
      pendingChangesRef.current = {};
      pendingWritesRef.current = 0;
      setFavorites(readUserDataStore(null, "favorites", []));
      setAlerts(readUserDataStore(null, "alerts", []));
      setTasks(readUserDataStore(null, "tasks", [false, false, false, false]));
      setSyncStatus("local");
      return undefined;
    }

    const userId = authUser.id;
    const accountDefaults = {
      favorites: readUserDataStore(userId, "favorites", []),
      alerts: readUserDataStore(userId, "alerts", []),
      tasks: readUserDataStore(userId, "tasks", [false, false, false, false])
    };
    // Switch immediately to this account's own cache. Visitor data and other
    // accounts' data are never used as fallbacks for a missing cloud row.
    setFavorites(accountDefaults.favorites);
    setAlerts(accountDefaults.alerts);
    setTasks(accountDefaults.tasks);

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
          favorites: Array.isArray(data?.favorites) ? data.favorites : accountDefaults.favorites,
          alerts: Array.isArray(data?.alerts) ? data.alerts : accountDefaults.alerts,
          tasks: Array.isArray(data?.tasks) ? data.tasks : accountDefaults.tasks,
          notifications: mergedNotifications,
          ...pending
        };

        setFavorites(resolved.favorites);
        setAlerts(resolved.alerts);
        setTasks(resolved.tasks);
        setNotifications(resolved.notifications);
        persistUserDataStore(userId, "favorites", resolved.favorites);
        persistUserDataStore(userId, "alerts", resolved.alerts);
        persistUserDataStore(userId, "tasks", resolved.tasks);
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

    if (browserNotificationsEnabled && notificationPermission === "granted"
      && typeof window.EditalRadarNative?.showNotification === "function") {
      fresh.slice(0, 3).forEach((item) => {
        window.EditalRadarNative.showNotification(item.title, item.message, item.id);
      });
    } else if (browserNotificationsEnabled && notificationPermission === "granted" && "Notification" in window) {
      fresh.slice(0, 3).forEach((item) => {
        const browserNotice = new window.Notification(item.title, {
          body: item.message,
          tag: item.id
        });
        browserNotice.onclick = () => {
          window.focus();
          const contest = catalog.find((entry) => String(entry.id) === String(item.itemId));
          if (contest) openContestDetails(contest);
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
  const upcomingMilestones = useMemo(() => getUpcomingMilestones(catalog), [catalog]);
  const currentFilters = { query, nivel, esfera, estado, localidade, situacao, ocultarPreliminares };
  const activeFilterCount = [
    Boolean(query.trim()),
    nivel !== "Todos os níveis",
    esfera !== "Todas as esferas",
    estado !== "Todos os estados",
    localidade !== "Todas as cidades",
    situacao !== "Todas as situações",
    ocultarPreliminares
  ].filter(Boolean).length;
  const clearCatalogFilters = () => {
    setQuery("");
    setNivel("Todos os níveis");
    setEsfera("Todas as esferas");
    setEstado("Todos os estados");
    setLocalidade("Todas as cidades");
    setSituacao("Todas as situações");
    setOcultarPreliminares(false);
  };
  const filtered = useMemo(
    () => catalog.filter((item) => matchesFilters(item, currentFilters)),
    [catalog, query, nivel, esfera, estado, localidade, situacao, ocultarPreliminares]
  );
  const visibleCatalog = useMemo(() => {
    const items = page === "favoritos"
      ? filtered.filter((item) => favorites.includes(item.id))
      : filtered;
    if (sortMode === "catalog") return items;
    return [...items].sort((a, b) => {
      if (sortMode === "salary") {
        const aValue = getSalaryAmount(a), bValue = getSalaryAmount(b);
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        return bValue - aValue;
      }
      if (sortMode === "vacancies") {
        const aValue = getVacancyAmount(a), bValue = getVacancyAmount(b);
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        return bValue - aValue;
      }
      if (sortMode === "status") {
        return getStatusPriority(a) - getStatusPriority(b)
          || String(a.cargo || "").localeCompare(String(b.cargo || ""), "pt-BR");
      }
      return String(a.cargo || "").localeCompare(String(b.cargo || ""), "pt-BR");
    });
  }, [filtered, page, favorites, sortMode]);

  const updateSortMode = (value) => {
    setSortMode(value);
    try { localStorage.setItem("er-catalog-sort", JSON.stringify(value)); } catch { /* preferência temporária */ }
  };
  const updateCatalogView = (value) => {
    setCatalogView(value);
    try { localStorage.setItem("er-catalog-view", JSON.stringify(value)); } catch { /* preferência temporária */ }
  };
  const exportFavoriteContests = () => {
    const favoriteItems = catalog.filter((item) => favorites.includes(item.id));
    if (!favoriteItems.length) return;
    const columns = [
      ["Órgão", "orgao"], ["Cargo", "cargo"], ["Sigla", "sigla"], ["Situação", "status"],
      ["Vagas", "vagas"], ["Remuneração", "salary"], ["Escolaridade", "nivel"],
      ["Localidade", "localidade"], ["Estado", "estado"], ["Fonte", "source"]
    ];
    const rows = [
      columns.map(([label]) => label),
      ...favoriteItems.map((item) => columns.map(([, key]) => key === "salary"
        ? getContestSalary(item)
        : key === "source" ? (item.sourceUrl || item.url || sourceUrl) : item[key]))
    ];
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "editalradar-favoritos-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    setExportMessage(favoriteItems.length + " oportunidade(s) exportada(s) para CSV.");
  };


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
      const isAndroidNative = typeof window.EditalRadarNative?.isAndroidApp === "function"
        && window.EditalRadarNative.isAndroidApp() === true;
      const { error } = await authClient.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: isAndroidNative
            ? "editalradar://auth-callback"
            : window.location.origin + window.location.pathname
        }
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
    if (fcmTokenRef.current && typeof authClient.functions?.invoke === "function") {
      try {
        const { error: pushError } = await authClient.functions.invoke("push-notifications", {
          body: { action: "unregister_device", token: fcmTokenRef.current }
        });
        if (pushError) console.warn("Não foi possível desvincular o dispositivo do push:", pushError);
      } catch (pushError) {
        console.warn("Falha ao desvincular o dispositivo do push:", pushError);
      }
      fcmTokenRef.current = null;
    }
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
    persistUserDataStore(authUser?.id, "alerts", next);
    void syncUserData({ alerts: next });
  };
  const removeAlert = (id) => {
    const next = alerts.filter((alert) => alert.id !== id);
    setAlerts(next);
    persistUserDataStore(authUser?.id, "alerts", next);
    void syncUserData({ alerts: next });
  };

  const saveFavorites = (next) => {
    setFavorites(next);
    persistUserDataStore(authUser?.id, "favorites", next);
    void syncUserData({ favorites: next });
  };
  const toggleFavorite = (id) => {
    saveFavorites(favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id]);
  };
  const enableBrowserNotifications = async () => {
    const nativeBridge = typeof window !== "undefined" ? window.EditalRadarNative : null;
    if (typeof nativeBridge?.requestNotificationPermission === "function") {
      try {
        const enabled = nativeBridge.requestNotificationPermission() === true;
        if (enabled) {
          setNotificationPermission("granted");
          setBrowserNotificationsEnabled(true);
          localStorage.setItem("er-browser-notifications", JSON.stringify(true));
          setNotificationMessage("Notificações nativas ativadas neste dispositivo.");
          nativeBridge.showNotification?.(
            "EditalRadar",
            "Notificações ativadas. Avisaremos quando o app detectar novidades.",
            "editalradar-notifications-enabled"
          );
        } else {
          setNotificationMessage("Autorize as notificações na janela do Android. O aplicativo confirmará a ativação automaticamente.");
        }
      } catch {
        setNotificationMessage("Não foi possível ativar as notificações do Android.");
      }
      return;
    }
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

  const sendPushSelfTest = async (background = false) => {
    if (!authUser?.id || typeof authClient?.functions?.invoke !== "function") {
      setNotificationMessage("Entre na sua conta para testar as notificações push.");
      return;
    }
    setPushTestBusy(true);
    setNotificationMessage(background
      ? "Teste programado para daqui a 15 segundos. Saia do EditalRadar e bloqueie a tela agora."
      : "");
    try {
      const { data, error } = await authClient.functions.invoke("push-notifications", {
        body: { action: background ? "test_self_background" : "test_self" }
      });
      if (error) throw error;
      if (data?.ok && data.sent > 0) {
        setNotificationMessage(background
          ? "Teste em segundo plano enviado. Confira a notificação com o aplicativo minimizado ou a tela bloqueada."
          : "Teste enviado ao seu aparelho. Confira a central de notificações do Android.");
      } else {
        setNotificationMessage(data?.error || "O teste não foi enviado. Ative as notificações e confirme o cadastro do aparelho.");
      }
    } catch (error) {
      let message = error?.message || "Não foi possível enviar o teste push.";
      try {
        const response = error?.context;
        if (response && typeof response.clone === "function") {
          const payload = await response.clone().json();
          message = payload?.error || message;
        }
      } catch {
        // Mantém a mensagem de erro da chamada quando a resposta não contém JSON.
      }
      setNotificationMessage(message);
    } finally {
      setPushTestBusy(false);
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
    if (contest) openContestDetails(contest);
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
  const displayedNotifications = visibleNotifications.slice(0, notificationLimit);

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
      cargo: "", orgao: "", sigla: "", nivel: "", area: "Federal",
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
      setDiscoveryItems(current => current.map(row => String(row.id) === String(item.id)
        ? { ...row, status: "dismissed", reviewed_at: new Date().toISOString(), reviewed_by: authUser?.id || null }
        : row));
      setAdminMessage("Oportunidade descartada. O registro foi mantido no histórico.");
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
    if (!isTrustedOfficialUrl(sourceUrlValue)) {
      setAdminMessage("Informe uma URL HTTPS de órgão público ou banca organizadora reconhecida.");
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
    const previousContest = adminEditingId !== null
      ? catalog.find(item => String(item.id) === String(adminEditingId))
      : null;
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
    if (previousContest) {
      data.historicoAtualizacoes = buildContestChangeHistory(previousContest, data, {
        at: new Date().toISOString(),
        actor: authUser?.email || "Administrador"
      });
    }
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
          setDiscoveryItems(current => current.map(row => String(row.id) === String(discoveryDraftId)
            ? { ...row, status: "published", reviewed_at: new Date().toISOString(), reviewed_by: authUser?.id || null, published_catalog_id: Number(saved.id) }
            : row));
        }
        setDiscoveryDraftId(null);
      }
      setAdminDraft(null);
      setAdminMessage(successMessage);
      setAdminMessageType("success");
      if (typeof authClient.functions?.invoke === "function") {
        const pushTitle = editing ? "Concurso atualizado no EditalRadar" : "Novo concurso no EditalRadar";
        const pushBody = (data.orgao + ": " + data.cargo + (data.estado ? " — " + data.estado : "")).slice(0, 350);
        void authClient.functions.invoke("push-notifications", {
          body: { action: "broadcast", title: pushTitle, body: pushBody, url: "/" }
        }).then(({ error: pushError, data: pushResult }) => {
          if (pushError) {
            console.warn("O concurso foi salvo, mas o push não foi enviado:", pushError);
            setNotificationMessage("Concurso salvo. O envio de avisos push depende da configuração do Firebase.");
          } else if (pushResult?.sent > 0) {
            setNotificationMessage("Aviso push enviado para " + pushResult.sent + " dispositivo(s).");
          }
        }).catch((pushError) => console.warn("Falha ao enviar aviso push:", pushError));
      }
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
    persistUserDataStore(authUser?.id, "tasks", next);
    void syncUserData({ tasks: next });
  };
  const progress = Math.round(tasks.filter(Boolean).length / tasks.length * 100);
  const catalogCount = catalog.filter(Boolean).length;
  const preliminaryCount = catalog.filter(isPreliminary).length;
  const verifiedRecords = catalog.filter((item) => item && !isPreliminary(item));
  const totalVagas = verifiedRecords.reduce((sum, item) => sum + (Number(item.vagas) || 0), 0);
  const discoveryCounts = useMemo(() => countDiscoveriesByStatus(discoveryItems), [discoveryItems]);
  const filteredDiscoveryItems = useMemo(() => filterDiscoveries(discoveryItems, {
    query: discoveryQuery,
    kind: discoveryKind,
    topic: discoveryTopic,
    status: discoveryStatus,
    period: discoveryPeriod
  }), [discoveryItems, discoveryQuery, discoveryKind, discoveryTopic, discoveryStatus, discoveryPeriod]);

  return (
    <div className="app-shell" data-page={page}>
      <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setPage("concursos")}>
          <span className="brand-mark">E</span>
          <span>Edital<span className="brand-light">Radar</span><small>SEU PRÓXIMO PASSO</small></span>
        </a>
        <div className="side-label">MENU PRINCIPAL</div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <button className={page === "concursos" || (page === "detalhes" && detailOrigin === "concursos") ? "nav-item active" : "nav-item"} onClick={() => { setSelected(null); setPage("concursos"); }} aria-current={page === "concursos" || (page === "detalhes" && detailOrigin === "concursos") ? "page" : undefined}><span aria-hidden="true">▦</span><span className="nav-label">Concursos</span></button>
          <button className={page === "estudos" ? "nav-item active" : "nav-item"} onClick={() => setPage("estudos")} aria-current={page === "estudos" ? "page" : undefined}><span aria-hidden="true">◷</span><span className="nav-label">Área de estudos</span></button>
          <button className={page === "favoritos" || (page === "detalhes" && detailOrigin === "favoritos") ? "nav-item active" : "nav-item"} onClick={() => { setSelected(null); setPage("favoritos"); }} aria-current={page === "favoritos" || (page === "detalhes" && detailOrigin === "favoritos") ? "page" : undefined}><span aria-hidden="true">♡</span><span className="nav-label">Meus favoritos</span> <b>{favorites.length}</b></button>
          <button className={page === "comparar" ? "nav-item active" : "nav-item"} onClick={() => setPage("comparar")} aria-current={page === "comparar" ? "page" : undefined} aria-label={`Comparar concursos (${comparisonItems.length})`}><span aria-hidden="true">⇄</span><span className="nav-label">Comparar</span> <b>{comparisonItems.length}</b></button>
          {isAdmin && <button className={page === "admin" ? "nav-item active" : "nav-item"} onClick={() => setPage("admin")} aria-label="Administração" aria-current={page === "admin" ? "page" : undefined}><span aria-hidden="true">⚙</span><span className="nav-label">Administração</span></button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">✦</span><strong>Seu futuro começa com planejamento.</strong><p>Organize sua preparação e acompanhe suas oportunidades.</p><button onClick={() => setPage("estudos")}>Ver meu plano →</button></div>
          <div className="profile"><div className="avatar">{(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "C")[0]?.toUpperCase() || "C"}</div><div className="profile-copy" title={authUser?.email || "Modo visitante"}><strong>{authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "Concurseiro"}</strong><small>{!authUser ? "Modo visitante" : syncStatus === "loading" || syncStatus === "syncing" ? "Sincronizando dados..." : syncStatus === "synced" ? "Dados sincronizados" : syncStatus === "error" ? "Falha na sincronização" : "Conta conectada"}</small></div><button className="dots profile-edit" type="button" onClick={openProfileEditor} aria-label={authUser ? "Editar perfil" : "Entrar para editar perfil"}>Editar</button></div>
        </div>
      </aside>

      <main className="main" id="main-content">
        <header className="topbar">
          <div className="breadcrumb">Início <span>/</span> {page === "detalhes" ? "Detalhes do concurso" : page === "comparar" ? "Comparador de concursos" : page === "concursos" ? "Concursos" : page === "estudos" ? "Área de estudos" : page === "admin" ? "Administração" : "Meus favoritos"}</div>
          <div className="top-actions"><span className="date-chip">◷ &nbsp;Sua jornada começa hoje</span><button className="install-trigger" type="button" onClick={handleInstallApp} disabled={isAppInstalled}>{isAppInstalled ? "App instalado" : deferredInstallPrompt ? "Instalar app" : "Como instalar"}</button><button className="notification-bell" type="button" onClick={openNotifications} aria-label={`Ver notificações (${unreadNotificationCount} não lidas)`} title="Ver notificações">♧{unreadNotificationCount > 0 && <span>{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}</button>{authUser ? <button className="auth-trigger" onClick={handleSignOut} disabled={!authReady}>Sair da conta</button> : <button className="auth-trigger" onClick={() => { setShowAuth(true); setAuthMessage(""); }}>Entrar / cadastrar</button>}<div className="mini-avatar">{(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || "C")[0]?.toUpperCase() || "C"}</div></div>
        </header>
        {!isOnline && <div className="offline-status" role="status">Você está offline. O catálogo em cache e os dados locais continuam acessíveis; login e sincronização precisam de internet.</div>}


        {page === "detalhes" && selected ? (
          <section className="content detail-page">
            <button className="detail-back" type="button" onClick={closeContestDetails}>← Voltar para {detailOrigin === "favoritos" ? "meus favoritos" : "concursos"}</button>
            <section className="detail-hero">
              <div className="detail-hero-copy">
                <div className="eyebrow light">FICHA DA OPORTUNIDADE · {selected.sigla || "EDITALRADAR"}</div>
                <span className={"status detail-status " + getStatusTone(selected.status) + (isPreliminary(selected) ? " preliminary" : "")}><i />{selected.status || "Situação não informada"}</span>
                <h1>{selected.cargo}</h1>
                <p>{selected.orgao}{selected.vinculo ? " · " + selected.vinculo : ""}</p>
                <div className="detail-hero-facts">
                  <span><small>VAGAS</small><strong>{selected.vagasTotais ?? selected.vagas ?? "A divulgar"}</strong></span>
                  <span><small>REMUNERAÇÃO</small><strong>{getContestSalary(selected)}</strong></span>
                  <span><small>ESCOLARIDADE</small><strong>{selected.nivel || "Não informada"}</strong></span>
                  <span><small>LOCALIDADE</small><strong>{selected.localidade || selected.estado || "Brasil"}</strong></span>
                </div>
              </div>
              <div className="detail-hero-actions">
                <button className="detail-favorite-btn" type="button" onClick={() => toggleFavorite(selected.id)} disabled={Boolean(authUser && syncStatus === "loading")}>
                  {favorites.includes(selected.id) ? "♥ Salvo nos favoritos" : "♡ Salvar oportunidade"}
                </button>
                <a className="detail-source-btn" href={selectedSourceUrl} target="_blank" rel="noopener noreferrer">
                  {isPreliminary(selected) || !selectedSourceIsOfficial ? "Abrir referência externa — confirme no órgão ↗" : "Acessar fonte oficial ↗"}
                </a>
              </div>
            </section>

            <nav className="detail-section-nav" aria-label="Seções desta oportunidade">
              <a href="#detail-overview">Visão geral</a>
              <a href="#detail-timeline">Cronograma</a>
              <a href="#detail-documents">Edital e documentos</a>
              <a href="#detail-history">Histórico</a>
            </nav>

            <div className="detail-content-grid">
              <div className="detail-main-column">
                <section className="detail-section" id="detail-overview">
                  <div className="detail-section-heading"><div><div className="eyebrow">RESUMO DA SELEÇÃO</div><h2>Visão geral</h2></div><span>{selected.area || "Esfera não informada"} · {selected.estado || "Brasil"}</span></div>
                  <div className="detail-facts-grid">
                    <div><small>Órgão responsável</small><strong>{selected.orgao || "Não informado"}</strong></div>
                    <div><small>Cargo / especialidade</small><strong>{selected.cargo || "Não informado"}</strong></div>
                    <div><small>Vagas informadas na ficha</small><strong>{selected.vagasTotais ?? selected.vagas ?? "Não divulgadas nesta ficha"}</strong></div>
                    <div><small>Vagas imediatas</small><strong>{selected.vagasImediatas == null ? "Não discriminadas nesta ficha" : new Intl.NumberFormat("pt-BR").format(selected.vagasImediatas)}</strong></div>
                    <div><small>Cadastro de reserva</small><strong>{selected.cadastroReserva == null ? "Não informado nesta ficha" : new Intl.NumberFormat("pt-BR").format(selected.cadastroReserva)}</strong></div>
                    <div><small>Remuneração</small><strong>{getContestSalary(selected)}</strong>
                      {selectedRemuneration?.observacao && <small>{selectedRemuneration.observacao}</small>}
                      {selectedSalarySourceUrl && <a href={selectedSalarySourceUrl} target="_blank" rel="noopener noreferrer">{selectedRemuneration.sourceLabel || "Fonte do valor remuneratório"} ↗</a>}
                    </div>
                    <div><small>Escolaridade</small><strong>{selected.nivel || "Não informada"}</strong></div>
                    <div><small>Esfera</small><strong>{selected.area || "Não informada"}</strong></div>
                    <div><small>Localidade</small><strong>{[selected.localidade, selected.estado].filter(Boolean).join(" · ") || "Não informada"}</strong></div>
                    <div><small>Vínculo / edição</small><strong>{selected.vinculo || "Não informado"}</strong></div>
                    <div><small>Ato ou edital informado</small><strong>{selected.atoOficial || "Não informado"}</strong></div>
                  </div>
                  <div className="detail-description">
                    <h3>O que sabemos sobre esta oportunidade</h3>
                    <p>{selected.observacao || "Esta ficha ainda não possui observações editoriais. Consulte a fonte oficial para confirmar requisitos, vagas e etapas."}</p>
                  </div>
                  {isPreliminary(selected) && <p className="detail-caution">Registro preliminar: os dados ainda não foram confirmados individualmente em edital oficial. O quantitativo de vagas, os requisitos e o cronograma não devem ser tratados como definitivos.</p>}
                </section>

                <section className="detail-section" id="detail-timeline">
                  <div className="detail-section-heading"><div><div className="eyebrow">DATAS MENCIONADAS NA FICHA</div><h2>Cronograma e etapas</h2></div><span>{selectedTimeline.length} data(s) identificada(s)</span></div>
                  {selectedTimeline.length > 0 ? (
                    <ol className="detail-timeline">
                      {selectedTimeline.map((event, index) => (
                        <li className="detail-timeline-item" key={event.date.toISOString() + event.label}>
                          <span className="detail-timeline-marker" aria-hidden="true">{index + 1}</span>
                          <div className="detail-timeline-copy">
                            <strong>{event.label}</strong>
                            <time dateTime={event.date.toISOString().slice(0, 10)}>{event.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</time>
                            <p>{event.context}</p>
                            <small>Origem: {event.origin}</small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="detail-empty-state">Esta ficha ainda não informa datas específicas de inscrições, provas ou resultados. Consulte o cronograma na publicação oficial.</div>
                  )}
                  <p className="detail-data-note">As datas são extraídas do texto disponível na ficha. Retificações e comunicados posteriores podem alterar o cronograma; confirme sempre na fonte oficial.</p>
                </section>

                <section className="detail-section" id="detail-documents">
                  <div className="detail-section-heading"><div><div className="eyebrow">PUBLICAÇÕES E ARQUIVOS</div><h2>Edital e documentos</h2></div></div>
                  <article className="detail-document-card">
                    <span className="detail-document-icon" aria-hidden="true">↗</span>
                    <div><strong>{/\.pdf(?:$|[?#])/i.test(selectedSourceUrl) ? "Documento em PDF" : isPreliminary(selected) ? "Listagem secundária de referência" : "Página oficial da seleção"}</strong>
                      <p>{isPreliminary(selected) ? "Esta não é uma confirmação de edital. Use a listagem apenas como ponto de partida para conferência." : "Acesse a publicação do órgão ou da banca para consultar edital, retificações, comunicados e arquivos disponibilizados."}</p>
                      <small>{selected.atoOficial || "Ato ou número de edital não informado nesta ficha"}</small>
                    </div>
                    <a href={selectedSourceUrl} target="_blank" rel="noopener noreferrer">{isPreliminary(selected) || !selectedSourceIsOfficial ? "Abrir referência externa" : "Abrir fonte oficial"} ↗</a>
                  </article>
                  {selectedDocuments.length > 0 ? (
                    <div className="detail-extra-documents">
                      {selectedDocuments.map((document, index) => (
                        <article className="detail-document-card" key={document.url + index}>
                          <span className="detail-document-icon" aria-hidden="true">PDF</span>
                          <div><strong>{document.title}</strong><p>{document.description || "Documento vinculado à ficha desta seleção."}</p></div>
                          <a href={document.url} target="_blank" rel="noopener noreferrer">Abrir ↗</a>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="detail-data-note">Nenhum arquivo adicional foi anexado individualmente a esta ficha. A fonte acima é o endereço cadastrado para acompanhamento oficial.</p>
                  )}
                </section>

                <section className="detail-section" id="detail-history">
                  <div className="detail-section-heading"><div><div className="eyebrow">RASTREABILIDADE</div><h2>Histórico de atualizações</h2></div><span>{Array.isArray(selected.historicoAtualizacoes) ? selected.historicoAtualizacoes.length : 0} registro(s)</span></div>
                  {Array.isArray(selected.historicoAtualizacoes) && selected.historicoAtualizacoes.length > 0 ? (
                    <ol className="detail-history-list">
                      {[...selected.historicoAtualizacoes].reverse().map((entry, index) => {
                        const record = typeof entry === "string" ? { description: entry } : entry || {};
                        const dateValue = record.at || record.updated_at || record.date || record.data;
                        const date = dateValue && !Number.isNaN(new Date(dateValue).getTime()) ? new Date(dateValue) : null;
                        return <li key={dateValue || index}>
                          <span className="detail-history-dot" />
                          <div>
                            <strong>{record.title || record.titulo || record.description || record.descricao || record.message || record.mensagem || record.status || "Atualização registrada"}</strong>
                            <small>{date ? date.toLocaleString("pt-BR") : "Data não informada"}{record.source ? " · " + record.source : ""}</small>
                            {Array.isArray(record.changes) && record.changes.length > 0 && (
                              <ul className="detail-history-changes">
                                {record.changes.map((change, changeIndex) => {
                                  const label = change.label || change.field || "Campo";
                                  const before = change.oldValue ?? change.from ?? "Não informado";
                                  const after = change.newValue ?? change.to ?? "Não informado";
                                  const beforeText = before && typeof before === "object" ? before.valor ?? JSON.stringify(before) : String(before);
                                  const afterText = after && typeof after === "object" ? after.valor ?? JSON.stringify(after) : String(after);
                                  return <li key={change.field || changeIndex}><b>{label}:</b> {beforeText}<span aria-hidden="true"> → </span>{afterText}</li>;
                                })}
                              </ul>
                            )}
                            {(record.candidateUrl || record.sourceUrl) && isTrustedOfficialUrl(record.candidateUrl || record.sourceUrl) && (
                              <a className="detail-history-source" href={record.candidateUrl || record.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir documento da atualização ↗</a>
                            )}
                          </div>
                        </li>;
                      })}
                    </ol>
                  ) : (
                    <div className="detail-empty-state">Esta ficha ainda não possui histórico individual de alterações registrado no catálogo.</div>
                  )}
                </section>
              </div>

              <aside className="detail-side-column">
                <section className="detail-study-card">
                  <div className="eyebrow">PRÓXIMO PASSO</div>
                  <h2>Organize sua preparação</h2>
                  <p>Use esta oportunidade como foco da sua rotina e acompanhe as tarefas gerais na área de estudos.</p>
                  <button className="primary-btn full" type="button" onClick={() => setPage("estudos")}>Preparar para este concurso</button>
                  <button className="detail-btn full" type="button" onClick={() => toggleFavorite(selected.id)} disabled={Boolean(authUser && syncStatus === "loading")}>
                    {favorites.includes(selected.id) ? "Remover dos favoritos" : "Salvar nos favoritos"}
                  </button>
                </section>
                <section className="detail-trust-card">
                  <strong>Antes de tomar uma decisão</strong>
                  <p>Confira requisitos, remuneração, lotação, taxas, prazos e eventuais retificações diretamente na publicação oficial.</p>
                  <a href={selectedSourceUrl} target="_blank" rel="noopener noreferrer">Conferir fonte oficial ↗</a>
                </section>
              </aside>
            </div>
          </section>

        ) : page === "comparar" ? (
          <section className="content compare-page">
            <div className="compare-page-heading">
              <div>
                <div className="eyebrow">DECIDA COM MAIS CLAREZA</div>
                <h1>Comparador de concursos</h1>
                <p>Compare até três oportunidades lado a lado. Os dados refletem o que está cadastrado em cada ficha.</p>
              </div>
              <div className="compare-page-actions">
                <button className="detail-btn" type="button" onClick={() => setPage("concursos")}>Voltar ao catálogo</button>
                <button className="alert-remove" type="button" onClick={clearComparison} disabled={comparisonItems.length === 0}>Limpar seleção</button>
              </div>
            </div>
            {comparisonItems.length < 2 ? (
              <div className="compare-empty" role="status">
                <span aria-hidden="true">⇄</span>
                <h2>Escolha pelo menos dois concursos</h2>
                <p>Volte ao catálogo e use o botão “Comparar” nos cartões. Você pode selecionar até três oportunidades.</p>
                <button className="primary-btn" type="button" onClick={() => setPage("concursos")}>Escolher concursos</button>
                {comparisonItems.length === 1 && <div className="compare-selected-preview"><strong>Já selecionado:</strong> {comparisonItems[0].cargo} — {comparisonItems[0].orgao}</div>}
              </div>
            ) : (
              <>
                <div className="compare-summary">
                  <div><strong>{comparisonItems.length} oportunidades selecionadas</strong><span>Use a tabela para avaliar os critérios sem misturar informações não confirmadas.</span></div>
                  <button className="detail-btn" type="button" onClick={() => setPage("concursos")}>＋ Adicionar outro concurso</button>
                </div>
                <div className="compare-table-wrap" role="region" aria-label="Tabela de comparação dos concursos" tabIndex={0}>
                  <table className="compare-table">
                    <thead>
                      <tr>
                        <th scope="col">Critério</th>
                        {comparisonItems.map((item) => (
                          <th scope="col" key={item.id}>
                            <div className="compare-column-heading">
                              <small>{item.sigla || "CONCURSO"}</small>
                              <strong>{item.cargo}</strong>
                              <span>{item.orgao}</span>
                              <button type="button" className="compare-remove" onClick={() => removeFromComparison(item.id)} aria-label={`Remover ${item.cargo} da comparação`}>Remover ×</button>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr><th scope="row">Vagas informadas</th>{comparisonItems.map(item => <td key={item.id}>{item.vagas == null ? "Não divulgadas" : new Intl.NumberFormat("pt-BR").format(item.vagas)}{isPreliminary(item) && <small className="compare-caution">Quantidade preliminar</small>}</td>)}</tr>
                      <tr><th scope="row">Remuneração</th>{comparisonItems.map(item => <td key={item.id}>{getContestSalary(item)}</td>)}</tr>
                      <tr><th scope="row">Escolaridade</th>{comparisonItems.map(item => <td key={item.id}>{item.nivel || "Não informada"}</td>)}</tr>
                      <tr><th scope="row">Esfera</th>{comparisonItems.map(item => <td key={item.id}>{item.area || "Não informada"}</td>)}</tr>
                      <tr><th scope="row">Localidade</th>{comparisonItems.map(item => <td key={item.id}>{[item.localidade, item.estado].filter(Boolean).join(" · ") || "Não informada"}</td>)}</tr>
                      <tr><th scope="row">Situação atual</th>{comparisonItems.map(item => <td key={item.id}><span className={`compare-status ${isPreliminary(item) ? "is-preliminary" : ""}`}>{item.status || "Não informada"}</span></td>)}</tr>
                      <tr><th scope="row">Edital / ato informado</th>{comparisonItems.map(item => <td key={item.id}>{item.atoOficial || "Não informado"}</td>)}</tr>
                      <tr>
                        <th scope="row">Datas e etapas mencionadas</th>
                        {comparisonItems.map(item => {
                          const timeline = extractContestTimeline(item).slice(0, 4);
                          return <td key={item.id}>
                            {timeline.length ? <ul className="compare-dates">{timeline.map(event => <li key={event.date.toISOString() + event.label}><strong>{event.label}</strong><time dateTime={event.date.toISOString().slice(0, 10)}>{event.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</time></li>)}</ul> : "Nenhuma data identificada nesta ficha."}
                          </td>;
                        })}
                      </tr>
                      <tr><th scope="row">Nível de confirmação</th>{comparisonItems.map(item => <td key={item.id}>{isPreliminary(item) ? <span className="compare-caution">Registro preliminar: exige conferência individual no edital.</span> : "Ficha cadastrada com fonte de acompanhamento."}</td>)}</tr>
                      <tr><th scope="row">Fonte</th>{comparisonItems.map(item => {
                        const href = /^https:\/\//i.test(item.sourceUrl || "") ? item.sourceUrl : sourceUrl;
                        return <td key={item.id}><a className="compare-source-link" href={href} target="_blank" rel="noopener noreferrer">{isPreliminary(item) ? "Abrir referência" : "Abrir fonte"} ↗</a></td>;
                      })}</tr>
                    </tbody>
                  </table>
                </div>
                <p className="compare-disclaimer">Importante: remuneração só aparece quando existe um campo próprio preenchido na ficha. Datas são extraídas dos textos cadastrados e podem mudar por retificação. Confirme sempre os valores, requisitos e prazos na publicação oficial.</p>
              </>
            )}
          </section>
        ) : page === "estudos" ? (
          <React.Suspense fallback={<section className="content study-page"><div className="eyebrow">SUA ROTINA, SEU RITMO</div><h1>Carregando área de estudos…</h1></section>}>
            <StudyArea selected={selected} tasks={tasks} progress={progress} onToggleTask={toggleTask}
              onBackDetails={() => setPage("detalhes")} onClearFocus={() => setSelected(null)}
              userId={authUser?.id || null} authClient={authClient}/>
          </React.Suspense>
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
                    {Array.isArray(item.historicoAtualizacoes) && item.historicoAtualizacoes.length > 0 && (
                      <details className="admin-history-details">
                        <summary>Ver histórico de {item.historicoAtualizacoes.length} atualização(ões)</summary>
                        <ol>
                          {[...item.historicoAtualizacoes].slice(-10).reverse().map((entry, index) => (
                            <li key={entry.id || entry.at || index}>
                              <strong>{formatContestHistoryDate(entry.at)} · {entry.actor || "Administrador"}</strong>
                              <span>{entry.summary || (Array.isArray(entry.changes) ? entry.changes.length + " campo(s) alterado(s)" : "Atualização registrada")}</span>
                              {Array.isArray(entry.changes) && entry.changes.length > 0 && (
                                <ul>{entry.changes.map((change, changeIndex) => (
                                  <li key={change.field || changeIndex}>
                                    <b>{change.label || change.field || "Campo"}:</b> {change.from || "Não informado"} <span aria-hidden="true">→</span> {change.to || "Não informado"}
                                  </li>
                                ))}</ul>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
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
                <div><strong>Oportunidades detectadas e histórico</strong><small>{discoveryCounts.pending} pendente(s) · {discoveryCounts.published} publicada(s) · {discoveryCounts.dismissed} descartada(s) · últimos {discoveryItems.length} registros carregados</small></div>
                <span className="discovery-status-pill">Monitoramento automático</span>
              </div>
              <p className="muted discovery-help">O monitor verifica fontes e pesquisa a internet automaticamente a cada 6 horas. Use os filtros para localizar pistas, retificações e decisões anteriores. Notícias externas nunca são publicadas como concurso sem confirmação no site oficial do órgão ou da banca.</p>
              {discoverySyncMessage && <p className="auth-message info" role="status">Histórico indisponível. Execute a migração <strong>202611220003_contest_discoveries.sql</strong> no Supabase e configure os secrets do GitHub Actions. Detalhe: {discoverySyncMessage}</p>}
              <div className="discovery-summary" aria-label="Resumo da fila de oportunidades">
                <div><strong>{discoveryCounts.pending}</strong><span>Pendentes</span></div>
                <div><strong>{discoveryCounts.published}</strong><span>Publicadas</span></div>
                <div><strong>{discoveryCounts.dismissed}</strong><span>Descartadas</span></div>
                <div><strong>{discoveryCounts.total}</strong><span>No histórico carregado</span></div>
              </div>
              <div className="discovery-toolbar">
                <label>Pesquisar oportunidade
                  <input value={discoveryQuery} onChange={event => setDiscoveryQuery(event.target.value)} placeholder="Título, órgão, link ou texto..." />
                </label>
                <label>Origem
                  <select value={discoveryKind} onChange={event => setDiscoveryKind(event.target.value)}>
                    <option value="all">Todas as origens</option>
                    <option value="official">Fontes oficiais</option>
                    <option value="secondary">Notícias e pistas externas</option>
                  </select>
                </label>
                <label>Assunto
                  <select value={discoveryTopic} onChange={event => setDiscoveryTopic(event.target.value)}>
                    <option value="all">Todos os assuntos</option>
                    <option value="retification">Retificações e erratas</option>
                    <option value="result">Resultados e convocações</option>
                    <option value="pre_notice">Pré-edital e autorizações</option>
                    <option value="general">Editais e outras atualizações</option>
                  </select>
                </label>
                <label>Situação da revisão
                  <select value={discoveryStatus} onChange={event => setDiscoveryStatus(event.target.value)}>
                    <option value="pending">Aguardando revisão</option>
                    <option value="published">Publicadas no catálogo</option>
                    <option value="dismissed">Descartadas</option>
                    <option value="all">Todas as situações</option>
                  </select>
                </label>
                <label>Período
                  <select value={discoveryPeriod} onChange={event => setDiscoveryPeriod(event.target.value)}>
                    <option value="all">Todo o período</option>
                    <option value="24h">Últimas 24 horas</option>
                    <option value="7d">Últimos 7 dias</option>
                    <option value="30d">Últimos 30 dias</option>
                  </select>
                </label>
              </div>
              {discoveryLoading ? <p className="muted">Carregando oportunidades e histórico...</p> : discoveryItems.length === 0 ? (
                <div className="discovery-empty">Nenhuma oportunidade registrada ainda.</div>
              ) : filteredDiscoveryItems.length === 0 ? (
                <div className="discovery-empty">Nenhum registro corresponde aos filtros selecionados. Experimente ampliar a pesquisa ou o período.</div>
              ) : (
                <div className="admin-list discovery-list" aria-live="polite">
                  {filteredDiscoveryItems.map(item => {
                    const kind = classifyDiscoveryKind(item);
                    const linkedContest = item.published_catalog_id == null
                      ? null
                      : catalog.find(contest => String(contest.id) === String(item.published_catalog_id));
                    return (
                      <article className="admin-row discovery-row" key={item.id}>
                        <div className="admin-row-copy">
                          <strong>{item.title}</strong>
                          <div className="discovery-row-tags">
                            <span className={`discovery-chip discovery-chip-${kind}`}>{discoveryKindLabel(kind)}</span>
                            <span className="discovery-chip discovery-chip-topic">{discoveryTopicLabel(classifyDiscoveryTopic(item))}</span>
                            <span className={`discovery-chip discovery-status-${item.status || "unknown"}`}>{discoveryStatusLabel(item.status)}</span>
                            <small>{item.detected_at ? new Date(item.detected_at).toLocaleString("pt-BR") : "Data não informada"}</small>
                            {item.reviewed_at && <small>Revisada em {new Date(item.reviewed_at).toLocaleString("pt-BR")}</small>}
                          </div>
                          <small>{item.context}</small>
                          <a href={item.candidate_url} target="_blank" rel="noopener noreferrer">{item.discovery_type === "web_search_lead" ? "Abrir notícia ou resultado da busca ↗" : "Abrir publicação ou página identificada ↗"}</a>
                        </div>
                        <div className="admin-row-actions">
                          {item.status === "pending" ? (
                            <>
                              {item.discovery_type === "web_search_lead"
                                ? <span className="discovery-web-review-note">Confirme o edital no site do órgão ou da banca antes de cadastrar.</span>
                                : <button className="detail-btn" type="button" onClick={() => openDiscoveryDraft(item)} disabled={adminBusy}>Revisar e cadastrar</button>}
                              <button className="alert-remove" type="button" onClick={() => dismissDiscovery(item)} disabled={adminBusy}>Descartar</button>
                            </>
                          ) : item.status === "published" ? (
                            linkedContest
                              ? <button className="detail-btn" type="button" onClick={() => openAdminEditor(linkedContest)} disabled={adminBusy}>Editar concurso publicado</button>
                              : <span className="discovery-history-note">Registrada como publicada</span>
                          ) : (
                            <span className="discovery-history-note">Mantida no histórico</span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {adminMessage && <p className={`auth-message ${adminMessageType}`} role="status">{adminMessage}</p>}
            </div>
            <React.Suspense fallback={<div className="panel admin-panel"><p className="muted">Carregando gestão do banco de questões…</p></div>}>
              <StudyQuestionAdmin authClient={authClient} userId={authUser?.id || null}/>
            </React.Suspense>
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
            {page !== "favoritos" && (
              <section className="candidate-dashboard" aria-label="Painel inteligente do candidato">
                <div className="candidate-dashboard-heading">
                  <div>
                    <div className="eyebrow">PAINEL INTELIGENTE</div>
                    <h2>Sua jornada em um só lugar</h2>
                    <p>Acompanhe sua preparação, oportunidades salvas e as próximas datas divulgadas nos concursos.</p>
                  </div>
                  <button className="recommendations-edit" type="button" onClick={openProfileEditor}>
                    {authUser ? "Atualizar meu perfil" : "Personalizar meu perfil"}
                  </button>
                </div>
                <div className="candidate-dashboard-stats">
                  <button className="dashboard-stat" type="button" onClick={() => setPage("estudos")} aria-label={`Rotina de estudos: ${progress}% concluída`}>
                    <span className="dashboard-stat-icon">◷</span>
                    <span className="dashboard-stat-copy"><small>Rotina de estudos</small><strong>{progress}%</strong></span>
                    <em>{tasks.filter(Boolean).length}/{tasks.length} tarefas</em>
                  </button>
                  <button className="dashboard-stat" type="button" onClick={() => setPage("favoritos")} aria-label={`Abrir lista de favoritos (${favorites.length})`}>
                    <span className="dashboard-stat-icon">♡</span>
                    <span className="dashboard-stat-copy"><small>Meus favoritos</small><strong>{favorites.length}</strong></span>
                    <em>Oportunidades salvas</em>
                  </button>
                  <button className="dashboard-stat" type="button" onClick={openNotifications} aria-label={`Avisos não lidos: ${unreadNotificationCount}`}>
                    <span className="dashboard-stat-icon">♧</span>
                    <span className="dashboard-stat-copy"><small>Avisos não lidos</small><strong>{unreadNotificationCount}</strong></span>
                    <em>Novidades e retificações</em>
                  </button>
                </div>
                <div className="candidate-dashboard-content">
                  <div className="dashboard-milestones">
                    <div className="dashboard-section-heading">
                      <div><div className="eyebrow">AGENDA DE OPORTUNIDADES</div><h3>Próximas datas importantes</h3></div>
                      <span>{upcomingMilestones.length} data(s)</span>
                    </div>
                    {upcomingMilestones.length > 0 ? (
                      <div className="dashboard-milestone-list">
                        {upcomingMilestones.slice(0, 4).map((milestone) => (
                          <article className="dashboard-milestone" key={milestone.id + "-" + milestone.type}>
                            <time dateTime={milestone.date.toISOString().slice(0, 10)}>
                              {milestone.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                            </time>
                            <div className="dashboard-milestone-copy">
                              <strong>{milestone.label}</strong>
                              <span>{milestone.title}</span>
                              <small>{milestone.orgao}</small>
                            </div>
                            <button className="dashboard-milestone-open" type="button" aria-label={`Ver ${milestone.label.toLowerCase()}: ${milestone.title}`} onClick={() => {
                              const contest = catalog.find((item) => String(item.id) === String(milestone.id));
                              if (contest) openContestDetails(contest);
                            }}>Ver ↗</button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="dashboard-milestone-empty">Não há datas futuras explicitadas nas situações das fichas disponíveis. Consulte os detalhes e confirme o cronograma na fonte oficial.</p>
                    )}
                    <small className="dashboard-disclaimer">As datas são extraídas do campo de situação do catálogo e podem mudar. Confirme sempre o cronograma na publicação oficial.</small>
                  </div>
                  <div className="dashboard-focus">
                    <div className="eyebrow">SEU PRÓXIMO PASSO</div>
                    <h3>{authUser ? "Mantenha seu plano em dia" : "Prepare o EditalRadar para seu perfil"}</h3>
                    <p>{authUser
                      ? "Revise suas preferências para receber recomendações mais alinhadas à sua área, escolaridade e localização."
                      : "Entre na sua conta e informe sua área de interesse, escolaridade e localização para receber recomendações personalizadas."}</p>
                    <div className="dashboard-focus-actions">
                      <button className="primary-btn" type="button" onClick={openProfileEditor}>{authUser ? "Revisar perfil" : "Entrar e personalizar"}</button>
                      <button className="detail-btn" type="button" onClick={() => setPage("estudos")}>Abrir estudos</button>
                    </div>
                  </div>
                </div>
              </section>
            )}
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
                    {notificationPermission === "granted" && browserNotificationsEnabled ? "Notificações ativadas" : notificationPermission === "denied" ? "Permissão bloqueada" : "Ativar notificações"}
                  </button>
                  {authUser && browserNotificationsEnabled && typeof window.EditalRadarNative?.requestFcmToken === "function" && (
                    <>
                      <button className="detail-btn" type="button" onClick={() => sendPushSelfTest(false)} disabled={pushTestBusy}>
                        {pushTestBusy ? "Enviando teste..." : "Testar recebimento push"}
                      </button>
                      <button className="detail-btn" type="button" onClick={() => sendPushSelfTest(true)} disabled={pushTestBusy}>
                        {pushTestBusy ? "Preparando teste..." : "Testar com app fechado (15 s)"}
                      </button>
                    </>
                  )}
                  {unreadNotificationCount > 0 && <button className="alert-remove" type="button" onClick={markAllNotificationsRead}>Marcar como lidas</button>}
                  {activeNotifications.length > 0 && <button className="alert-remove" type="button" onClick={clearNotificationHistory}>Limpar histórico</button>}
                </div>
              </div>
              <div className="notification-filters" role="group" aria-label="Filtrar notificações">
                <button type="button" className={notificationView === "all" ? "notification-filter active" : "notification-filter"} aria-pressed={notificationView === "all"} onClick={() => { setNotificationView("all"); setNotificationLimit(8); }}>Todas ({activeNotifications.length})</button>
                <button type="button" className={notificationView === "unread" ? "notification-filter active" : "notification-filter"} aria-pressed={notificationView === "unread"} onClick={() => { setNotificationView("unread"); setNotificationLimit(8); }}>Não lidas ({unreadNotificationCount})</button>
              </div>
              {visibleNotifications.length > 0 ? (
                <>
                <div className="notification-list">
                  {displayedNotifications.map((notification) => (
                    <div className="notification-entry" key={notification.id} role="group" aria-label={notification.title}>
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
                {visibleNotifications.length > displayedNotifications.length && (
                  <div className="notification-more">
                    <button
                      className="detail-btn"
                      type="button"
                      onClick={() => setNotificationLimit((current) => Math.min(current + 8, 50))}
                    >
                      Ver mais avisos ({visibleNotifications.length - displayedNotifications.length} restantes)
                    </button>
                  </div>
                )}
                </>
              ) : <p className="alerts-empty">{activeNotifications.length === 0 ? "Nenhuma novidade por enquanto. Quando o catálogo receber novos concursos ou um favorito for atualizado, o aviso aparecerá aqui." : "Não há notificações não lidas. Você já conferiu todas as novidades."}</p>}
              <small className="alerts-note">
                {notificationPermission === "granted" && browserNotificationsEnabled
                  ? "Notificações de desktop ativadas neste navegador."
                  : notificationPermission === "denied"
                    ? "O navegador bloqueou os avisos de desktop; os avisos internos continuam disponíveis."
                    : notificationPermission === "unsupported"
                      ? "Seu navegador não oferece notificações de desktop."
                      : "Ative os avisos do navegador para receber uma notificação quando o EditalRadar detectar novidades."}
                {" "}Os avisos locais aparecem após a sincronização. No Android, os avisos com o aplicativo fechado dependem da configuração do Firebase Cloud Messaging.
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
                    <button className="recommendation-open" onClick={()=>openContestDetails(item)}>Ver detalhes</button>
                  </article>
                ))}</div>
              </section>
            )}
            <div className="section-title">
              <div><div className="eyebrow">{page === "favoritos" ? "SUA LISTA PESSOAL" : "CATÁLOGO DE OPORTUNIDADES"}</div><h2>{page === "favoritos" ? "Seus concursos favoritos" : "Concursos e avisos no catálogo"}</h2></div>
              <div className="section-heading-actions">
                <span className="results">{visibleCatalog.length} registros</span>
                {page === "favoritos" && <button className="export-favorites-btn" type="button" onClick={exportFavoriteContests} disabled={favorites.length === 0}>↓ Exportar CSV</button>}
              </div>
            </div>
            <div className="catalog-view-toolbar">
              <label className="catalog-sort">Ordenar por
                <select aria-label="Ordenar concursos" value={sortMode} onChange={(event) => updateSortMode(event.target.value)}>
                  <option value="catalog">Ordem do catálogo</option>
                  <option value="salary">Maior remuneração</option>
                  <option value="vacancies">Maior número de vagas</option>
                  <option value="status">Situação da inscrição</option>
                  <option value="name">Nome do cargo (A–Z)</option>
                </select>
              </label>
              <div className="catalog-view-switch" role="group" aria-label="Modo de visualização">
                <button type="button" aria-label="Visualização em grade" aria-pressed={catalogView === "grid"} className={catalogView === "grid" ? "active" : ""} onClick={() => updateCatalogView("grid")}>▦ <span>Grade</span></button>
                <button type="button" aria-label="Visualização em lista" aria-pressed={catalogView === "list"} className={catalogView === "list" ? "active" : ""} onClick={() => updateCatalogView("list")}>☷ <span>Lista</span></button>
              </div>
            </div>
            {exportMessage && page === "favoritos" && <p className="export-feedback" role="status">{exportMessage}</p>}
            <div className="catalog-filter-panel" aria-label="Filtros do catálogo">
              <div className="catalog-filter-heading">
                <div>
                  <strong>Encontre sua próxima oportunidade</strong>
                  <p>Combine os filtros ou use os atalhos para localizar editais com mais rapidez.</p>
                </div>
                {activeFilterCount > 0 && <button className="clear-filters-btn" type="button" onClick={clearCatalogFilters}>Limpar filtros ({activeFilterCount})</button>}
              </div>
              <div className="filter-shortcuts" role="group" aria-label="Atalhos de situação">
                <button type="button" className={situacao === "Todas as situações" ? "filter-shortcut active" : "filter-shortcut"} aria-pressed={situacao === "Todas as situações"} onClick={() => setSituacao("Todas as situações")}>Todas</button>
                <button type="button" className={situacao === "Inscrições abertas" ? "filter-shortcut active" : "filter-shortcut"} aria-pressed={situacao === "Inscrições abertas"} onClick={() => setSituacao("Inscrições abertas")}>Inscrições abertas</button>
                <button type="button" className={situacao === "Pré-edital / anunciado" ? "filter-shortcut active" : "filter-shortcut"} aria-pressed={situacao === "Pré-edital / anunciado"} onClick={() => setSituacao("Pré-edital / anunciado")}>Pré-edital e anunciados</button>
              </div>
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
            {comparisonItems.length > 0 && (
              <section className="compare-toolbar" aria-label="Concursos selecionados para comparação">
                <div><strong>{comparisonItems.length} de 3 concursos selecionados</strong><span>{comparisonItems.map(item => item.sigla || item.orgao).join(" · ")}</span></div>
                <div className="compare-toolbar-actions">
                  <button className="primary-btn" type="button" onClick={() => setPage("comparar")} disabled={comparisonItems.length < 2}>Comparar agora</button>
                  <button className="alert-remove" type="button" onClick={clearComparison}>Limpar</button>
                </div>
              </section>
            )}
            <div className={"cards " + (catalogView === "list" ? "cards-list" : "cards-grid")} data-view={catalogView}>
              {visibleCatalog.map((item) => {
                const isComparing = comparisonItems.some((entry) => String(entry.id) === String(item.id));
                const compareLimitReached = comparisonItems.length >= 3 && !isComparing;
                return <article className="contest-card" key={item.id}>
                <div className="card-top"><div className="org-icon">{item.sigla}</div><div className="card-top-actions"><button className={isComparing ? "compare-card-btn selected" : "compare-card-btn"} type="button" onClick={() => toggleComparison(item)} aria-pressed={isComparing} aria-label={isComparing ? `Remover ${item.cargo} da comparação` : `Adicionar ${item.cargo} à comparação`} disabled={compareLimitReached}>{isComparing ? "✓ Comparando" : compareLimitReached ? "Limite 3" : "⇄ Comparar"}</button><button className={favorites.includes(item.id) ? "heart saved" : "heart"} onClick={() => toggleFavorite(item.id)} aria-label="Salvar favorito" disabled={Boolean(authUser && syncStatus === "loading")}>{favorites.includes(item.id) ? "♥" : "♡"}</button></div></div>
                <div className="card-status-row">
                  <span className={`status ${getStatusTone(item.status)} ${isPreliminary(item) ? "preliminary" : ""}`}><i />{item.status}</span>
                  <span className="card-area-tag">{item.area || "Federal"} · {item.estado || "Brasil"}</span>
                </div>
                <h3>{item.cargo}</h3><p className="org-name">{item.orgao}</p>
                <div className="card-meta card-facts">
                  <span><small>VAGAS</small><strong>{item.vagas == null ? "A divulgar" : new Intl.NumberFormat("pt-BR").format(item.vagas)}</strong></span>
                  <span><small>REMUNERAÇÃO</small><strong>{getContestSalary(item)}</strong></span>
                  <span><small>ESCOLARIDADE</small><strong>{item.nivel || "Não informada"}</strong></span>
                  <span><small>LOCALIDADE</small><strong>{item.localidade || "Brasil"}</strong></span>
                </div>
                <div className="card-bottom"><div><small>{isPreliminary(item) ? "Listagem de referência" : officialSourceLabel(item.sourceUrl)}</small><strong>{item.atoOficial || "Não informado"}</strong></div><button className="detail-btn" onClick={() => openContestDetails(item)}>Ver detalhes ↗</button></div>
              </article>;
              })}
              {visibleCatalog.length === 0 && <div className="empty">
                <strong>{page === "favoritos" ? "Sua lista está pronta para começar." : "Nenhum concurso encontrado."}</strong>
                <p>{page === "favoritos" ? "Salve oportunidades pelo ícone de coração para montar sua lista de acompanhamento." : "Experimente retirar algum filtro ou buscar por outro cargo ou órgão."}</p>
                {page === "favoritos"
                  ? <button className="primary-btn" type="button" onClick={() => setPage("concursos")}>Explorar concursos</button>
                  : activeFilterCount > 0 && <button className="detail-btn" type="button" onClick={clearCatalogFilters}>Mostrar todos os concursos</button>}
              </div>}
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

    </div>
  );
}
