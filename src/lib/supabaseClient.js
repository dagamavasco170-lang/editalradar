import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

// A chave publishable/anon pode estar no frontend, desde que todas as tabelas
// privadas usem Row Level Security (RLS). Nunca coloque service_role aqui.
// PKCE é necessário no retorno OAuth por deep link: o Android encaminha o
// parâmetro "code" de volta à mesma WebView que armazenou o code_verifier.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    })
  : null;
