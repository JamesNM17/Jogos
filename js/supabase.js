const config = window.APP_CONFIG || {};

export function isSupabaseConfigured() {
  const url = String(config.supabaseUrl || "").trim();
  const key = String(config.supabaseKey || "").trim();
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname) && parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.username === "" && parsed.password === "";
  } catch {
    validUrl = false;
  }
  const validKey = key.length > 20 && !/SUA_CHAVE|YOUR_|COLE_AQUI|placeholder|service_role|sb_secret_/i.test(key);
  return validUrl && validKey;
}

let clientPromise;
export async function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!clientPromise) {
    const loadLibrary = () => import("https://esm.sh/@supabase/supabase-js@2")
      .catch(() => import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"));
    clientPromise = loadLibrary()
      .then(({ createClient }) => createClient(config.supabaseUrl.trim().replace(/\/$/, ""), config.supabaseKey.trim()))
      .catch((error) => {
        clientPromise = null;
        throw new Error("Não foi possível carregar a biblioteca do Supabase. Verifique a conexão e se a rede permite acessar os CDNs do projeto.", { cause: error });
      });
  }
  return clientPromise;
}
