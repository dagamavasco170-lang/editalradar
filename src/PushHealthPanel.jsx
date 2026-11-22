import React, { useCallback, useEffect, useRef, useState } from "react";

const number = (value) => new Intl.NumberFormat("pt-BR").format(Number(value) || 0);

const formatDate = (value) => {
  if (!value) return "Ainda não executado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : date.toLocaleString("pt-BR");
};

const ageLabel = (value) => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return "Sem registro";
  if (seconds < 60) return `${Math.round(seconds)} s atrás`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min atrás`;
  return `${Math.floor(seconds / 3600)} h atrás`;
};

export default function PushHealthPanel({ authClient }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const refresh = useCallback(async (background = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      if (!authClient || typeof authClient.rpc !== "function") {
        throw new Error("Serviço indisponível");
      }
      const { data, error: rpcError } = await authClient.rpc("get_push_notification_health");
      if (rpcError) throw rpcError;
      if (!data || typeof data !== "object") throw new Error("Resposta inválida");
      setHealth(data);
    } catch {
      setError("Não foi possível consultar a saúde das notificações. Confirme se esta conta possui acesso de administrador e tente novamente.");
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [authClient]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const queue = health?.queue || {};
  const scheduler = health?.scheduler || {};
  const worker = health?.worker_http || {};
  const workerResult = worker?.result_counts || {};
  const workerHistory = health?.worker_history || {};
  const devices = health?.devices || {};
  const failures = health?.failures || {};
  const recentErrors = Array.isArray(health?.recent_errors) ? health.recent_errors : [];
  const schedulerAge = Number(scheduler.last_run_age_seconds);
  const workerAge = worker.created_at ? (Date.now() - new Date(worker.created_at).getTime()) / 1000 : Infinity;
  const schedulerOk = scheduler.active === true
    && scheduler.last_run_status === "succeeded"
    && Number.isFinite(schedulerAge)
    && schedulerAge <= 180;
  const workerOk = Number(worker.status_code) >= 200
    && Number(worker.status_code) < 300
    && worker.timed_out !== true
    && Number.isFinite(workerAge)
    && workerAge <= 180;
  const staleQueue = Number(queue.oldest_message_age_seconds) > 600;
  const warning = Number(failures.last_24h) > 0
    || staleQueue
    || Number(workerResult.dead_letter) > 0
    || Number(workerResult.pending_redelivery) > 0
    || Number(workerHistory.dead_letter_24h) > 0
    || Number(workerHistory.pending_redelivery_24h) > 0;
  const healthy = schedulerOk && workerOk && !warning;
  const status = !schedulerOk || !workerOk ? "error" : warning ? "warning" : "success";
  const statusText = status === "success" ? "Operação normal" : status === "warning" ? "Atenção necessária" : "Verificar serviço";

  return (
    <section className="panel admin-panel push-health-panel" aria-labelledby="push-health-title">
      <div className="admin-panel-heading push-health-heading">
        <div>
          <strong id="push-health-title">Saúde das notificações push</strong>
          <small>Fila persistente, agendador, worker e dispositivos registrados</small>
        </div>
        <button className="detail-btn" type="button" onClick={() => refresh(false)} disabled={loading || refreshing}>
          {refreshing || loading ? "Atualizando…" : "↻ Atualizar"}
        </button>
      </div>

      {error && <p className="auth-message error" role="alert">{error}</p>}
      {!health && loading ? (
        <p className="muted" role="status">Consultando métricas protegidas do Supabase…</p>
      ) : health ? (
        <>
          <div className={`push-health-overview push-health-${status}`}>
            <span className="push-health-indicator" aria-hidden="true" />
            <div><strong>{statusText}</strong><small>
              {healthy
                ? "O agendador e a última chamada do worker estão respondendo."
                : "Confira os indicadores abaixo para identificar o ponto que precisa de atenção."}
            </small></div>
            <span className="push-health-updated">Atualizado {formatDate(health.generated_at)}</span>
          </div>

          <div className="push-health-grid">
            <article className="push-health-card">
              <small>Mensagens na fila</small>
              <strong>{number(queue.queue_length)}</strong>
              <span>{number(queue.visible_length)} prontas para processamento</span>
            </article>
            <article className="push-health-card">
              <small>Agendador</small>
              <strong>{scheduler.active ? "Ativo" : "Inativo"}</strong>
              <span>{scheduler.schedule || "Sem agenda configurada"}</span>
            </article>
            <article className="push-health-card">
              <small>Última execução</small>
              <strong>{scheduler.last_run_status === "succeeded" ? "Sucesso" : scheduler.last_run_status || "Sem dados"}</strong>
              <span>{ageLabel(scheduler.last_run_age_seconds)} · {formatDate(scheduler.last_run_at)}</span>
            </article>
            <article className="push-health-card">
              <small>Resposta HTTP do worker</small>
              <strong>{worker.status_code ? `HTTP ${worker.status_code}` : "Sem resposta"}</strong>
              <span>{worker.error || (worker.timed_out ? "A chamada expirou" : ageLabel(workerAge))}</span>
            </article>
            <article className="push-health-card">
              <small>Dispositivos push</small>
              <strong>{number(devices.enabled)} {Number(devices.enabled) === 1 ? "ativo" : "ativos"}</strong>
              <span>{number(devices.total)} registrados · {number(devices.disabled)} desativados</span>
            </article>
            <article className="push-health-card">
              <small>Falhas terminais (24h)</small>
              <strong>{number(failures.last_24h)}</strong>
              <span>{number(failures.total)} no histórico total</span>
            </article>
          </div>

          {workerResult.available === true && (
            <div className="push-health-batch" aria-label="Resultado do último lote processado">
              <div className="push-health-batch-heading">
                <strong>Resultado do último lote</strong>
                <small>{formatDate(workerHistory.last_run_at || worker.created_at)} · {number(workerHistory.last_duration_ms)} ms · dados agregados</small>
              </div>
              <div className="push-health-batch-grid">
                {[
                  ["Processadas", workerResult.processed],
                  ["Enviadas", workerResult.sent],
                  ["Reagendadas", workerResult.rescheduled],
                  ["Vencidas", Number(workerResult.expired) + Number(workerResult.expired_before_retry)],
                  ["Tokens desativados", workerResult.disabled_invalid],
                  ["Falhas definitivas", workerResult.dead_letter],
                  ["Aguardando recuperação", workerResult.pending_redelivery],
                  ["Mensagens inválidas", workerResult.invalid_message]
                ].map(([label, value]) => (
                  <div key={label}>
                    <strong>{number(value)}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {workerHistory.available === true ? (
            <div className="push-health-history" aria-label="Histórico de notificações nas últimas 24 horas">
              <div className="push-health-history-heading">
                <strong>Histórico das últimas 24 horas</strong>
                <small>{number(workerHistory.runs_24h)} execuções · última em {formatDate(workerHistory.last_run_at)}</small>
              </div>
              <div className="push-health-history-grid">
                {[
                  ["Processadas", workerHistory.processed_24h],
                  ["Enviadas", workerHistory.sent_24h],
                  ["Reagendadas", workerHistory.rescheduled_24h],
                  ["Vencidas", workerHistory.expired_24h],
                  ["Tokens desativados", workerHistory.disabled_invalid_24h],
                  ["Falhas definitivas", workerHistory.dead_letter_24h],
                  ["Aguardando recuperação", workerHistory.pending_redelivery_24h]
                ].map(([label, value]) => (
                  <div key={label}>
                    <strong>{number(value)}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="push-health-history-empty">O histórico persistente será preenchido após a próxima execução do worker.</p>
          )}
          {batchAnchor}
            <span>Última falha terminal: {formatDate(failures.latest_at)}</span>
          </div>

          {recentErrors.length > 0 && (
            <div className="push-health-errors">
              <strong>Códigos de falha recentes (7 dias)</strong>
              <ul>{recentErrors.map((item) => (
                <li key={item.error_code || "unknown"}>
                  <span>{item.error_code || "Erro não classificado"}</span>
                  <b>{number(item.count)}</b>
                  <small>{formatDate(item.latest_at)}</small>
                </li>
              ))}</ul>
            </div>
          )}
          <p className="push-health-privacy">Por segurança, este painel não exibe tokens, mensagens privadas nem identificadores de usuários. Atualização automática a cada minuto.</p>
        </>
      ) : !error ? (
        <p className="muted">As métricas ainda não estão disponíveis.</p>
      ) : null}
    </section>
  );
}
