export function getSupabaseCredentialRole(value = "") {
  const key = String(value || "");
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  const parts = key.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : "unknown";
  } catch {
    return "unknown";
  }
}

export function assertSupabaseServiceCredential(value, label = "SUPABASE_SERVICE_ROLE_KEY") {
  const role = getSupabaseCredentialRole(value);
  if (role === "service_role" || role === "secret") return role;

  const classification = role === "anon" || role === "publishable"
    ? "credencial pública"
    : "credencial desconhecida ou sem papel de serviço";
  throw new Error(
    label + " está configurada como " + classification + " (" + role + "). " +
    "Use uma chave secreta sb_secret_* ou uma JWT legada com papel service_role. " +
    "Não conceda permissões anon/authenticated às tabelas administrativas."
  );
}
