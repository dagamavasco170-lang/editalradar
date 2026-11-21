import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://editalradar-gamma.vercel.app",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function getSupabaseSecretKey(): string | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const direct = Deno.env.get("SUPABASE_SECRET_KEY");
  if (direct) return direct;
  const keysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!keysJson) return null;
  try {
    const keys = JSON.parse(keysJson);
    return keys.default || keys.service_role || Object.values(keys)[0] || null;
  } catch {
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] || character);
}

const areaKeywords: Record<string, string[]> = {
  administrativa: ["administr", "assistente", "técnico", "tecnico", "analista"],
  policial: ["polícia", "policia", "policial", "segurança", "seguranca"],
  tribunais: ["tribunal", "judiciário", "judiciario", "justiça", "justica"],
  "fiscal e controle": ["auditor", "fiscal", "receita", "controle", "cgu"],
  bancária: ["banco", "bancário", "bancaria", "bacen", "central"],
  educação: ["professor", "educação", "educacao", "pedag"],
  saúde: ["saúde", "saude", "médico", "medico", "enferm"],
  jurídica: ["procurador", "juríd", "jurid", "adv"],
  tecnologia: ["tecnologia", "dados", "sistemas", "ti", "infraestrutura"]
};

function scoreCompatibility(item: Record<string, unknown>, profile: Record<string, unknown>): number {
  const area = String(profile.interest_area || "").toLocaleLowerCase("pt-BR");
  const text = [item.cargo, item.orgao, item.area, item.nivel, item.estado, item.localidade, item.status]
    .join(" ").toLocaleLowerCase("pt-BR");
  const areaMatches = (areaKeywords[area] || []).some((keyword) => text.includes(keyword));
  const education = String(profile.education_level || "").toLocaleLowerCase("pt-BR");
  const level = String(item.nivel || "").toLocaleLowerCase("pt-BR");
  const levelMatches = !education || !level || level === "não informado"
    || (education.includes("médio") && level.includes("médio"))
    || (education.includes("técnico") && (level.includes("médio") || level.includes("técnico")))
    || (education.includes("superior") && level.includes("superior"));
  const stateMatches = !profile.state || item.estado === profile.state || item.estado === "Brasil";
  const cityMatches = !profile.city || item.localidade === profile.city || item.localidade === "Brasil";
  const active = /(inscriç|autorizado|pré-edital|edital publicado|anunciado)/i.test(String(item.status || ""));
  return (areaMatches ? 40 : 0) + (levelMatches ? 25 : 0) + (stateMatches ? 20 : 0)
    + (cityMatches ? 5 : 0) + (active ? 10 : 0);
}

function sanitizeUpdates(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl : "";
    try {
      if (new URL(sourceUrl).protocol !== "https:") return [];
    } catch {
      return [];
    }
    if (typeof item.cargo !== "string" || typeof item.orgao !== "string") return [];
    return [{
      id: String(item.id ?? "").slice(0, 80),
      cargo: item.cargo.slice(0, 180),
      orgao: item.orgao.slice(0, 140),
      status: String(item.status || "Atualização no catálogo").slice(0, 160),
      nivel: String(item.nivel || "").slice(0, 80),
      estado: String(item.estado || "").slice(0, 80),
      localidade: String(item.localidade || "").slice(0, 120),
      sourceUrl
    }];
  });
}

function buildEmailHtml(items: Record<string, unknown>[], appUrl: string): string {
  const cards = items.map((item) => {
    const title = escapeHtml(item.cargo);
    const org = escapeHtml(item.orgao);
    const status = escapeHtml(item.status);
    const location = escapeHtml([item.localidade, item.estado].filter(Boolean).join(" · "));
    const source = escapeHtml(item.sourceUrl);
    return '<div style="padding:16px 0;border-bottom:1px solid #e7ecea"><div style="font-size:17px;font-weight:700;color:#18394b">' + title +
      '</div><div style="margin-top:5px;color:#59707d">' + org +
      '</div><div style="margin-top:7px;font-size:13px;color:#627782">' + status +
      (location ? " · " + location : "") +
      '</div><p style="margin:12px 0 0"><a href="' + source +
      '" style="color:#13785d;font-weight:700">Consultar fonte do concurso</a></p></div>';
  }).join("");
  return '<div style="margin:0;padding:28px 14px;background:#f4f7f6;font-family:Arial,sans-serif;color:#203d4c"><div style="max-width:620px;margin:0 auto;padding:28px;background:#fff;border-radius:14px">' +
    '<div style="font-size:13px;font-weight:700;letter-spacing:1px;color:#17785f">EDITALRADAR</div>' +
    '<h1 style="margin:16px 0 8px;font-size:24px">Novas oportunidades para acompanhar</h1>' +
    '<p style="font-size:14px;line-height:1.6;color:#60737d">O catálogo recebeu atualizações que combinam com as informações do seu perfil.</p>' +
    cards +
    '<p style="margin:22px 0"><a href="' + escapeHtml(appUrl) +
    '" style="display:inline-block;padding:12px 18px;background:#16795f;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Abrir EditalRadar</a></p>' +
    '<p style="font-size:12px;line-height:1.6;color:#87949b">Você recebeu esta mensagem porque autorizou alertas por e-mail no seu perfil. Para cancelar, entre no EditalRadar, abra Editar perfil e desmarque “Receber alertas por e-mail”.</p>' +
    '</div></div>';
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const monitorToken = Deno.env.get("MONITOR_API_TOKEN") || "";
  const providedToken = (request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
  if (!monitorToken || !safeEqual(providedToken, monitorToken)) return json({ error: "Não autorizado." }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getSupabaseSecretKey();
  if (!resendKey || !emailFrom || !supabaseUrl || !serviceKey) {
    return json({ error: "Configuração do envio incompleta. Verifique os secrets da Edge Function." }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const digestId = typeof payload.digest_id === "string" ? payload.digest_id.slice(0, 120) : "";
  const updates = sanitizeUpdates(payload.updates);
  if (!digestId || updates.length === 0) return json({ digest_id: digestId, emails_sent: 0, reason: "Nenhuma alteração válida para notificar." });

  const appUrl = Deno.env.get("APP_URL") || "https://editalradar-gamma.vercel.app/";
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const counters = { users_checked: 0, users_opted_in: 0, matching_users: 0, emails_sent: 0, already_sent: 0, errors: 0 };
  const MAX_EMAILS = 100;
  const MAX_PAGES = 50;

  for (let page = 1; page <= MAX_PAGES && counters.emails_sent < MAX_EMAILS; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) return json({ error: "Não foi possível consultar contas autorizadas.", details: error.message, ...counters }, 502);
    const users = data.users || [];
    counters.users_checked += users.length;

    for (const user of users) {
      const metadata = (user.user_metadata || {}) as Record<string, unknown>;
      if (metadata.email_notifications_enabled !== true || !metadata.email_notifications_consent_at) continue;
      counters.users_opted_in += 1;
      if (!user.email || !(user.email_confirmed_at || user.confirmed_at)) continue;

      const appMetadata = (user.app_metadata || {}) as Record<string, unknown>;
      const sentDigests = Array.isArray(appMetadata.email_alert_digests) ? appMetadata.email_alert_digests.map(String) : [];
      if (sentDigests.includes(digestId)) {
        counters.already_sent += 1;
        continue;
      }

      const matches = updates
        .map((item) => ({ item, score: scoreCompatibility(item, metadata) }))
        .filter((entry) => entry.score >= 55)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (matches.length === 0) continue;
      counters.matching_users += 1;
      if (counters.emails_sent >= MAX_EMAILS) break;

      const html = buildEmailHtml(matches.map((entry) => entry.item), appUrl);
      const text = [
        "O catálogo do EditalRadar recebeu oportunidades compatíveis com seu perfil:",
        ...matches.map((entry) => "- " + entry.item.cargo + " — " + entry.item.orgao + " (" + entry.item.status + "): " + entry.item.sourceUrl),
        "",
        "Para cancelar alertas, abra Editar perfil no EditalRadar e desmarque a opção de e-mail: " + appUrl
      ].join("\\n");

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + resendKey,
            "Content-Type": "application/json",
            "Idempotency-Key": digestId + "-" + user.id
          },
          body: JSON.stringify({
            from: emailFrom,
            to: [user.email],
            subject: "Novos concursos compatíveis com seu perfil | EditalRadar",
            html,
            text
          })
        });

        if (!response.ok) {
          counters.errors += 1;
          console.error("Falha Resend:", response.status, await response.text());
          continue;
        }

        const nextDigests = [...sentDigests, digestId].slice(-20);
        const { error: metadataError } = await supabase.auth.admin.updateUserById(user.id, {
          app_metadata: { ...appMetadata, email_alert_digests: nextDigests }
        });
        if (metadataError) {
          counters.errors += 1;
          console.error("E-mail enviado, mas não foi possível gravar idempotência:", metadataError.message);
        }
        counters.emails_sent += 1;
      } catch (error) {
        counters.errors += 1;
        console.error("Falha ao enviar alerta:", error);
      }
    }

    if (users.length < 100) break;
  }

  return json({ digest_id: digestId, ...counters, email_limit: MAX_EMAILS });
});
