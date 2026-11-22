import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readProjectFile = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [android, serviceWorker, styles, androidGradle, androidWorkflow] = await Promise.all([
  readProjectFile("../android/app/src/main/java/br/com/editalradar/app/MainActivity.kt"),
  readProjectFile("../public/sw.js"),
  readProjectFile("../src/styles.css"),
  readProjectFile("../android/app/build.gradle"),
  readProjectFile("../.github/workflows/android-release.yml")
]);

test("WebView mantém navegação interna restrita à origem e ao caminho do app", () => {
  assert.match(android, /private fun isInternalAppUrl\(uri: Uri\)/);
  assert.match(android, /HOME_PATH = "\/editalradar\/"/);
  assert.match(android, /uri\.encodedUserInfo != null/);
  assert.match(android, /uri\.port != -1 && uri\.port != 443/);
  assert.match(android, /path\.split\('\/'\)\.none \{ it == "\." \|\| it == "\.\." \}/);
});

test("WebView bloqueia frames externos, conteúdo misto e certificados inválidos", () => {
  assert.match(android, /if \(!request\.isForMainFrame\) return !isInternalAppUrl\(uri\)/);
  assert.match(android, /WebSettings\.MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(android, /setAcceptThirdPartyCookies\(webView, false\)/);
  assert.match(android, /handler\?\.cancel\(\)/);
  assert.match(android, /safeBrowsingEnabled = true/);
});

test("destinos vindos de notificações são validados antes de abrir no aplicativo", () => {
  assert.match(android, /private fun resolvePushUrl\(value: String\): String/);
  assert.match(android, /if \(isInternalAppUrl\(uri\)\) uri\.toString\(\) else HOME_URL/);
  assert.match(android, /target\.startsWith\("\/\/"\) -> return HOME_URL/);
});

test("WebView respeita o ciclo de vida e recupera a página inicial", () => {
  assert.match(android, /val restoredWebState = savedInstanceState != null/);
  assert.match(android, /else if \(!restoredWebState\)/);
  assert.match(android, /webView\.onPause\(\)/);
  assert.match(android, /webView\.onResume\(\)/);
});

test("Android tenta novamente automaticamente quando a conectividade validada retorna", () => {
  assert.match(android, /lastKnownOnlineState: Boolean\? = null/);
  assert.match(android, /connectionRestored = online && lastKnownOnlineState == false/);
  assert.match(android, /if \(connectionRestored\)/);
  assert.match(android, /private fun retryCurrentPage\(\)/);
  assert.match(android, /onReceivedHttpError/);
  assert.match(android, /errorResponse != null\s+&&\s+errorResponse\.statusCode >= 500/);
});

test("PWA limita a espera de navegação e volta ao cache em redes instáveis", () => {
  assert.match(serviceWorker, /editalradar-app-v4/);
  assert.match(serviceWorker, /new AbortController\(\)/);
  assert.match(serviceWorker, /controller\.abort\(\), 4500/);
  assert.match(serviceWorker, /self\.clearTimeout\(timeoutId\)/);
  assert.match(serviceWorker, /exactPage \|\| appShell \|\| Response\.error\(\)/);
});

test("PWA usa cache local em erros temporários do servidor", () => {
  assert.match(serviceWorker, /response\.status >= 500/);
  assert.match(serviceWorker, /response\.status === 408/);
  assert.match(serviceWorker, /response\.status === 429/);
  assert.match(serviceWorker, /exactPage \|\| appShell \|\| response/);
});

test("Android apresenta mensagens claras sem expor detalhes internos", () => {
  assert.ok(android.includes("Sem conexão. Algumas informações já carregadas ainda podem estar disponíveis"));
  assert.ok(android.includes("Não foi possível estabelecer uma conexão segura"));
  assert.doesNotMatch(android, /conteúdo em cache|Servidor temporariamente indisponível|Use links HTTPS/);
});

test("assinatura de distribuição usa apenas a chave permanente recebida pelo ambiente seguro", () => {
  assert.match(androidGradle, /ANDROID_RELEASE_KEYSTORE_FILE/);
  assert.match(androidGradle, /ANDROID_RELEASE_STORE_PASSWORD/);
  assert.match(androidGradle, /ANDROID_RELEASE_KEY_ALIAS/);
  assert.match(androidGradle, /ANDROID_RELEASE_KEY_PASSWORD/);
  assert.match(androidGradle, /signingConfig signingConfigs\.getByName\('release'\)/);
  assert.match(androidGradle, /versionCode 8/);
  assert.match(androidGradle, /versionName '1\.2\.5'/);
  assert.doesNotMatch(androidGradle, /storePassword\s*['"][^'"]+['"]/);
});

test("GitHub Actions nunca publica APK de depuração como atualização pública", () => {
  assert.match(androidWorkflow, /Configure permanent Android signing key/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_KEYSTORE_BASE64/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_STORE_PASSWORD/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_KEY_ALIAS/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_KEY_PASSWORD/);
  assert.match(androidWorkflow, /gradle assembleRelease bundleRelease/);
  assert.match(androidWorkflow, /steps\.signing\.outputs\.ready == 'true'/);
  assert.match(androidWorkflow, /verification-only/);
  const publishStep = androidWorkflow
    .split("      - name: Publish permanently signed GitHub Release\\n")[1]
    ?.split("\\n      - name:")[0] ?? "";
  assert.match(publishStep, /if:.*steps\\.signing\\.outputs\\.ready == 'true'/);
  assert.doesNotMatch(publishStep, /if:.*steps\\.signing\\.outputs\\.ready != 'true'/);
});

test("site mantém recursos de acessibilidade e safe areas móveis", () => {
  assert.match(styles, /\.skip-link/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /forced-colors:\s*active/);
  assert.match(styles, /safe-area-inset-left/);
  assert.match(styles, /safe-area-inset-bottom/);
});
