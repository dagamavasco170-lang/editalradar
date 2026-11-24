import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readProjectFile = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [android, serviceWorker, styles, androidGradle, androidWorkflow, appUpdate, updateReceiver, androidManifest, nativeBridge, app] = await Promise.all([
  readProjectFile("../android/app/src/main/java/br/com/editalradar/app/MainActivity.kt"),
  readProjectFile("../public/sw.js"),
  readProjectFile("../src/styles.css"),
  readProjectFile("../android/app/build.gradle"),
  readProjectFile("../.github/workflows/android-release.yml"),
  readProjectFile("../android/app/src/main/java/br/com/editalradar/app/AppUpdateManager.kt"),
  readProjectFile("../android/app/src/main/java/br/com/editalradar/app/UpdateInstallReceiver.kt"),
  readProjectFile("../android/app/src/main/AndroidManifest.xml"),
  readProjectFile("../src/lib/android-bridge.js"),
  readProjectFile("../src/App.jsx")
]);
const [androidProjectGradle, androidApkWorkflow, androidReadme, androidSmokeScript, viteConfig, androidSmokeWorkflow, automationRecovery, automationHealth, clientTelemetry, diagnosticsFunction, diagnosticsMigration, failureReporter, clientDiagnosticsSummary, questionAutomationScript, questionFactory] = await Promise.all([
  readProjectFile("../android/build.gradle"),
  readProjectFile("../.github/workflows/android-apk.yml"),
  readProjectFile("../android/README.md"),
  readProjectFile("../scripts/android-emulator-smoke.sh"),
  readProjectFile("../vite.config.js"),
  readProjectFile("../.github/workflows/android-emulator-smoke.yml"),
  readProjectFile("../.github/workflows/automation-recovery.yml"),
  readProjectFile("../.github/workflows/automation-health.yml"),
  readProjectFile("../src/lib/telemetry.js"),
  readProjectFile("../supabase/functions/diagnostics-ingest/index.ts"),
  readProjectFile("../supabase/migrations/20261123170000_app_diagnostics_log_sink.sql"),
  readProjectFile("../.github/workflows/ci-failure-report.yml"),
  readProjectFile("../.github/workflows/client-diagnostics-summary.yml"),
  readProjectFile("../.github/scripts/question-automation.mjs"),
  readProjectFile("../supabase/functions/question-factory/index.ts")
]);

test("monitor de saúde considera somente execuções schedule/manual e fecha alertas recuperados", () => {
  assert.match(automationHealth, /run\.event === "schedule" \|\| run\.event === "workflow_dispatch"/);
  assert.match(automationHealth, /maxAgeHours: 12/);
  assert.match(automationHealth, /maxAgeHours: 36/);
  assert.match(automationHealth, /maxAgeHours: 192/);
  assert.ok(automationHealth.includes('latest.conclusion !== "success"'));
  assert.ok(automationHealth.includes('issues.update({ owner: context.repo.owner, repo: context.repo.repo, issue_number: existing.number, state: "closed", state_reason: "completed" })'));
});

test("recuperação automática seleciona somente falhas recentes elegíveis da main", () => {
  assert.match(automationRecovery, /item\.head_branch === "main"/);
  assert.match(automationRecovery, /\["schedule", "workflow_dispatch", "push"\]\.includes\(item\.event\)/);
  assert.match(automationRecovery, /item\.status === "completed"/);
  assert.match(automationRecovery, /item\.conclusion !== "success"/);
  assert.match(automationRecovery, /item\.run_attempt < 2/);
  assert.match(automationRecovery, /sort\(\(a, b\) => new Date\(b\.created_at\) - new Date\(a\.created_at\)\)/);
  assert.match(automationRecovery, /catch \(error\)/);
});

test("recuperação automática usa endpoint REST válido para reexecutar falhas", () => {
  assert.match(automationRecovery, /POST \/repos\/\{owner\}\/\{repo\}\/actions\/runs\/\{run_id\}\/rerun-failed-jobs/);
  assert.doesNotMatch(automationRecovery, /github\.rest\.actions\.reRunFailedJobs/);
});

test("fila administrativa limita renderização inicial e permite carregar mais registros", () => {
  assert.match(app, /discoveryVisibleLimit, setDiscoveryVisibleLimit\] = useState\(15\)/);
  assert.match(app, /filteredDiscoveryItems\.slice\(0, discoveryVisibleLimit\)/);
  assert.match(app, /visibleDiscoveryItems\.length < filteredDiscoveryItems\.length/);
  assert.match(app, /Carregar mais 15/);
});

test("automação de questões agendada exige credencial service_role", () => {
  assert.match(questionAutomationScript, /credentialRole !== "service_role" && !isModernSecretKey/);
  assert.match(questionAutomationScript, /sb_secret_/);
  assert.match(questionAutomationScript, /if \(!SERVICE_KEY\.startsWith\("sb_secret_"\)\) \{/);
  assert.match(questionFactory, /async function verifyLegacyServiceRoleToken/);
  assert.match(questionFactory, /payload\?\.role !== "service_role"/);
  assert.match(questionFactory, /study_question_automation_topics\?select=id&limit=0/);
  assert.match(questionFactory, /const maxAttempts = 2/);
  assert.match(questionFactory, /transientStatuses = new Set\(\[429, 500, 502, 503, 504\]\)/);
  assert.match(questionFactory, /Gemini HTTP .* repetindo uma única vez após espera curta/);
  assert.match(questionFactory, /Nenhum provedor alternativo será acionado/);
});

test("resumo de diagnósticos identifica chave anon sem abrir permissões públicas", () => {
  assert.match(clientDiagnosticsSummary, /credentialRole === "anon"/);
  assert.match(clientDiagnosticsSummary, /não libere acesso público à tabela de diagnósticos/);
});

test("Android bloqueia regressões e divergências entre versionName, versionCode e release", () => {
  assert.ok(androidWorkflow.includes("Validate Android version against latest published release"));
  assert.ok(androidWorkflow.includes("git fetch --tags --force"));
  assert.ok(androidWorkflow.includes('tag != "android-v" + previous_name'));
  assert.ok(androidWorkflow.includes("current_code < previous_code"));
  assert.ok(androidWorkflow.includes("current_code <= previous_code"));
  assert.ok(androidWorkflow.includes("versionCode changed without a versionName change"));
  assert.ok(androidWorkflow.includes("New versionName must also increase versionCode."));
  const releasePathFilters = [...androidWorkflow.matchAll(/^ {4}paths:\s*\n((?:^ {6}- .*\n)+)/gm)]
    .map(match => match[1]).join("\n");
  assert.match(releasePathFilters, /android\/app\/src/);
  assert.match(releasePathFilters, /android\/app\/build\.gradle/);
  assert.match(releasePathFilters, /android\/gradle\.properties/);
  assert.doesNotMatch(releasePathFilters, /platform-resilience|android-emulator-smoke|android\/README/);
});

test("mudanças compartilhadas do site e testes web não disparam publicação Android assinada", () => {
  const releasePathFilters = [...androidWorkflow.matchAll(/^ {4}paths:\s*\n((?:^ {6}- .*\n)+)/gm)]
    .map(match => match[1]).join("\n");
  assert.doesNotMatch(releasePathFilters, /^\s+- "src\/\*\*"/m);
  assert.doesNotMatch(releasePathFilters, /scripts\/platform-resilience\.node-test\.mjs/);
  assert.match(androidSmokeWorkflow, /src\/\*\*/);
});

test("workflow Android extrai versão do Gradle de forma consistente e docs apontam para versão estável", () => {
  assert.match(androidWorkflow, /lines = Path\("android\/app\/build\.gradle"\)\.read_text\(\)\.splitlines\(\)/);
  assert.match(androidWorkflow, /name_line = next\(\(line\.strip\(\) for line in lines/);
  assert.match(androidWorkflow, /code_line = next\(\(line\.strip\(\) for line in lines/);
  assert.doesNotMatch(androidWorkflow, /line = Path\("android\/app\/build\.gradle"\)/);
  const versionName = androidGradle.match(/versionName ['"]([^'"]+)['"]/);
  const versionCode = androidGradle.match(/versionCode (\d+)/);
  assert.ok(versionName && versionCode);
  const versionDescription = versionName[1] + " (versionCode " + versionCode[1] + ")";
  assert.ok(
    androidReadme.includes("Versão estável publicada: " + versionDescription) ||
    androidReadme.includes("Versão em validação: " + versionDescription)
  );
  assert.ok(androidReadme.includes("android-v" + versionName[1]));
});

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
  assert.match(android, /WebViewFeature\.WEB_MESSAGE_LISTENER/);
  assert.match(android, /WebViewCompat\.addWebMessageListener/);
  assert.match(android, /setOf\("https:\/\/\$HOME_HOST"\)/);
  assert.match(android, /!isMainFrame \|\| !isTrustedNativeBridgeOrigin\(sourceOrigin\)/);
  assert.doesNotMatch(android, /addJavascriptInterface|JavascriptInterface/);
  assert.match(android, /setAcceptThirdPartyCookies\(webView, false\)/);
  assert.match(android, /handler\?\.cancel\(\)/);
  assert.match(android, /safeBrowsingEnabled = true/);
});

test("destinos vindos de notificações são validados antes de abrir no aplicativo", () => {
  assert.match(android, /private fun resolvePushUrl\(value: String\): String/);
  assert.match(android, /if \(isInternalAppUrl\(uri\)\) uri\.toString\(\) else HOME_URL/);
  assert.match(android, /target\.startsWith\("\/\/"\) -> return HOME_URL/);
});

test("ponte Android limita ações ao WebMessageListener de origem confiável", () => {
  assert.match(nativeBridge, /typeof window\[BRIDGE_NAME\]\?\.postMessage === "function"/);
  assert.match(nativeBridge, /JSON\.stringify\(\{ \.\.\.payload, action \}\)/);
  assert.match(android, /MAX_NATIVE_MESSAGE_CHARS = 2_048/);
  assert.match(android, /"request_notification_permission"/);
  assert.match(android, /"request_fcm_token"/);
  assert.match(android, /"show_notification"/);
  assert.match(android, /abandonSession\(sessionId\)/);
  assert.ok(app.includes('sendNativeMessage("request_fcm_token")'));
  assert.ok(app.includes('sendNativeMessage("request_notification_permission")'));
  assert.doesNotMatch(app, /window\.EditalRadarNative/);
});

test("WebView recria uma instância nova quando o renderizador Android é encerrado", () => {
  assert.match(android, /private lateinit var contentRoot: LinearLayout/);
  assert.ok(android.includes("override fun onRenderProcessGone("));
  const rendererCallbackStart = android.indexOf("override fun onRenderProcessGone(");
  assert.ok(android.slice(rendererCallbackStart - 100, rendererCallbackStart).includes("@android.annotation.TargetApi(Build.VERSION_CODES.O)"));
  assert.ok(android.includes("private fun recoverFromRendererTermination("));
  assert.ok(android.includes("container?.removeView(goneView)"));
  assert.ok(android.includes("goneView.destroy()"));
  assert.ok(android.includes("webView = replacement"));
  assert.ok(android.includes("configureWebView()"));
  assert.ok(android.includes("replacement.loadUrl(HOME_URL)"));
  assert.ok(android.includes("EditalRadarWebView"));
  assert.ok(android.includes("Feche e abra o aplicativo novamente."));
});

test("Android registra falhas da WebView com detalhes sanitizados apenas em builds de teste", () => {
  assert.ok(android.includes("onConsoleMessage(consoleMessage: ConsoleMessage)"));
  assert.ok(android.includes("val debugBuild = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0"));
  assert.ok(android.includes("val safeDetails = if (debugBuild)"));
  assert.ok(android.includes("consoleMessage.message()"));
  assert.ok(android.includes("access_token|refresh_token|api[_-]?key|authorization"));
  assert.ok(android.includes("[redacted-token]"));
  assert.ok(android.includes('"JavaScript error"'));
  assert.ok(android.includes("Resource load error"));
  assert.ok(android.includes('Log.w("EditalRadarWebView", "HTTP'));
  assert.ok(androidSmokeScript.includes("EditalRadarWebView:W"));
});

test("Android desanexa a WebView e encerra callbacks antes de destruir a Activity", () => {
  const destroyStart = android.indexOf("override fun onDestroy()");
  const destroyEnd = android.indexOf("\n    }", destroyStart);
  const destroyBlock = android.slice(destroyStart, destroyEnd);
  const detachIndex = destroyBlock.indexOf("(retiringWebView.parent as? ViewGroup)?.removeView(retiringWebView)");
  const stopIndex = destroyBlock.indexOf("retiringWebView.stopLoading()");
  const historyIndex = destroyBlock.indexOf("retiringWebView.clearHistory()");
  const destroyIndex = destroyBlock.indexOf("retiringWebView.destroy()");
  assert.ok(detachIndex >= 0 && stopIndex > detachIndex);
  assert.ok(historyIndex > stopIndex && destroyIndex > historyIndex);
  assert.ok(destroyBlock.includes("webPageReady = false"));
  assert.ok(destroyBlock.includes("pendingFcmTokenDelivery = false"));
  assert.ok(destroyBlock.includes("appUpdateManager.close()"));
});

test("gerenciador de atualizações cancela callbacks ao ser encerrado", () => {
  assert.ok(appUpdate.includes("private val closed = AtomicBoolean(false)"));
  assert.ok(appUpdate.includes("if (closed.get()) return"));
  assert.ok(appUpdate.includes("if (!closed.get()) onComplete(result)"));
  assert.ok(appUpdate.includes("if (!closed.get()) onProgress(percentage)"));
  assert.ok(appUpdate.includes("if (!closed.compareAndSet(false, true)) return"));
  assert.ok(appUpdate.includes("worker.shutdownNow()"));
  assert.ok(appUpdate.includes("mainHandler.removeCallbacksAndMessages(null)"));

  const downloadStart = appUpdate.indexOf("fun downloadAndVerify(");
  const downloadEnd = appUpdate.indexOf("private fun findAvailableRelease()", downloadStart);
  const downloadBlock = appUpdate.slice(downloadStart, downloadEnd);
  assert.ok(downloadBlock.includes("if (!closed.get()) mainHandler.post"));
  assert.ok(downloadBlock.includes("if (!closed.get()) onComplete(result)"));
  assert.ok(downloadBlock.includes("if (!closed.get()) onComplete(Result.failure(error))"));

  const archiveStart = appUpdate.indexOf("private fun downloadReleaseApk(");
  const archiveEnd = appUpdate.indexOf("private fun openReleaseAssetConnection(", archiveStart);
  const archiveBlock = appUpdate.slice(archiveStart, archiveEnd);
  assert.ok(archiveBlock.includes("if (!closed.get()) onProgress(percentage)"));
  assert.ok(archiveBlock.includes("if (!closed.get()) onProgress(100)"));
});

test("download de atualização ignora callback tardio após Activity ser encerrada", () => {
  const callbackStart = android.indexOf("onComplete = { result ->");
  const callbackEnd = android.indexOf("\n            }\n        )", callbackStart);
  const callback = android.slice(callbackStart, callbackEnd);
  const guardIndex = callback.indexOf("if (isFinishing || isDestroyed) return@downloadAndVerify");
  const dialogIndex = callback.indexOf("downloadDialog?.dismiss()");
  const buttonIndex = callback.indexOf("updateButton.isEnabled = true");
  assert.ok(guardIndex >= 0 && dialogIndex > guardIndex && buttonIndex > guardIndex);
});

test("WebView só fica pronta após a interface React montar", () => {
  assert.ok(android.includes("private fun verifyAppMounted(targetView: WebView, attempt: Int = 0)"));
  assert.ok(android.includes("Boolean(document.querySelector('.app-shell'))"));
  assert.ok(android.includes('if (result == "true")'));
  assert.ok(android.includes("React app shell was not mounted after 10 checks"));
  assert.ok(android.includes("O aplicativo não conseguiu iniciar. Toque aqui para tentar novamente."));
  assert.ok(android.includes("if (pendingFcmTokenDelivery) requestFcmToken()"));
  assert.ok(android.includes('statusText.text = if (online) "EditalRadar • pronto" else "EditalRadar • disponível offline"'));
});

test("Android atualiza o token FCM ao retomar a página confiável", () => {
  assert.ok(android.includes("private var webPageReady = false"));
  assert.ok(android.includes("private var fcmTokenRequestInFlight = false"));
  assert.ok(android.includes("override fun onPageStarted("));
  assert.ok(android.includes("override fun onPageFinished("));
  assert.ok(android.includes("webPageReady = false"));
  assert.ok(android.includes("runCatching { isInternalAppUrl(Uri.parse(url)) }.getOrDefault(false)"));
  assert.ok(android.includes("if (isTrustedPage) verifyAppMounted(view)"));
  const resumeStart = android.indexOf("override fun onResume()");
  const resumeEnd = android.indexOf("private fun showPendingInstallFailureIfAny()", resumeStart);
  const resumeBlock = android.slice(resumeStart, resumeEnd);
  assert.ok(resumeBlock.includes("if (webPageReady) requestFcmToken()"));
  assert.ok(android.includes("if (isFinishing || isDestroyed) return"));
  assert.ok(android.includes("if (fcmTokenRequestInFlight) return"));
  assert.ok(android.includes("fcmTokenRequestInFlight = true"));
  assert.ok(android.includes("fcmTokenRequestInFlight = false"));
  assert.ok(android.includes("if (isFinishing || isDestroyed) return@addOnCompleteListener"));
  assert.ok(android.includes('getSharedPreferences("editalradar_push", Context.MODE_PRIVATE)'));
});

test("callbacks nativos assíncronos só chegam à WebView oficial e pronta", () => {
  assert.ok(android.includes("private fun isTrustedWebPageReady(): Boolean"));
  assert.ok(android.includes("!::webView.isInitialized || !webPageReady || isFinishing || isDestroyed"));
  assert.ok(android.includes("return isInternalAppUrl(currentUri)"));
  assert.ok(android.includes("private fun postToTrustedWebPage("));
  assert.ok(android.includes("targetWebView !== webView || !isTrustedWebPageReady()"));
  assert.ok(android.includes("retryFcmTokenDelivery: Boolean = false"));
  assert.ok(android.includes("pendingFcmTokenDelivery = true"));
  assert.ok(android.includes("if (pendingFcmTokenDelivery) requestFcmToken()"));
  const permissionStart = android.indexOf("private fun dispatchNativeNotificationPermission(");
  const permissionEnd = android.indexOf("private fun configureNotifications()", permissionStart);
  assert.ok(permissionStart >= 0 && permissionEnd > permissionStart);
  assert.ok(android.slice(permissionStart, permissionEnd).includes("postToTrustedWebPage(script)"));

  const tokenDispatchStart = android.indexOf("private fun dispatchFcmToken(");
  const tokenDispatchEnd = android.indexOf("private fun dispatchFcmStatus(", tokenDispatchStart);
  assert.ok(tokenDispatchStart >= 0 && tokenDispatchEnd > tokenDispatchStart);
  assert.ok(android.slice(tokenDispatchStart, tokenDispatchEnd).includes(
    "postToTrustedWebPage(script, retryFcmTokenDelivery = true)"
  ));

  const statusDispatchStart = android.indexOf("private fun dispatchFcmStatus(");
  const statusDispatchEnd = android.indexOf("override fun onResume()", statusDispatchStart);
  assert.ok(statusDispatchStart >= 0 && statusDispatchEnd > statusDispatchStart);
  assert.ok(android.slice(statusDispatchStart, statusDispatchEnd).includes("postToTrustedWebPage(script)"));
});

test("telas principais removem fundos e gradientes claros no modo escuro", () => {
  for (const selector of [
    'html[data-theme="dark"] .candidate-dashboard',
    'html[data-theme="dark"] .source-notice',
    'html[data-theme="dark"] .alerts-panel',
    'html[data-theme="dark"] .pci-catalog-notice',
    'html[data-theme="dark"] .contest-card',
    'html[data-theme="dark"] .org-icon',
    'html[data-theme="dark"] .help-card',
    'html[data-theme="dark"] .mini-avatar',
    'html[data-theme="dark"] .dashboard-focus',
    'html[data-theme="dark"] .study-target-card',
    'html[data-theme="dark"] .focus-timer-panel',
    'html[data-theme="dark"] .focus-timer-dial'
  ]) {
    assert.ok(styles.includes(selector), `regra escura ausente: ${selector}`);
  }
});

test("modo escuro é persistido no navegador e sincronizado com o tema nativo Android", () => {
  assert.ok(app.includes('safeSetItem("er-theme", JSON.stringify(nextTheme))'));
  assert.ok(app.includes('aria-pressed={theme === "dark"}'));
  assert.ok(styles.includes('html[data-theme="dark"]'));
  assert.ok(styles.includes("color-scheme: dark"));
  assert.ok(android.includes('private const val NATIVE_UI_PREFERENCES = "editalradar_ui"'));
  assert.ok(android.includes('private const val DARK_THEME_KEY = "dark_mode"'));
  assert.ok(android.includes(".getBoolean(DARK_THEME_KEY, false)"));
  assert.ok(android.includes(".putBoolean(DARK_THEME_KEY, dark)"));
  assert.ok(android.includes('"set_theme" -> applyNativeTheme(message.optString("theme") == "dark")'));
  assert.ok(android.includes("themedAlertDialogBuilder()"));
  assert.ok(android.includes("Theme_Material_Dialog_Alert"));
  assert.ok(android.includes("window.navigationBarColor = background"));
  assert.ok(android.includes("if (online) Color.rgb(27, 60, 55)"));
  assert.ok(
    (android.match(/setBackgroundColor\(if \(isDarkThemeEnabled\) Color\.rgb\(13, 22, 36\) else Color\.WHITE\)/g) || []).length >= 2,
    "a WebView inicial e a recriada após falha precisam respeitar o tema escuro"
  );
  assert.doesNotMatch(android, /AlertDialog\.Builder\(this\)/);
});

test("mudanças no frontend também executam o teste de WebView Android", () => {
  for (const path of [
    '      - "vite.config.js"',
    '      - "index.html"',
    '      - "src/**"',
    '      - "public/**"',
    '      - "package.json"',
    '      - "package-lock.json"'
  ]) {
    assert.ok(androidSmokeWorkflow.includes(path), `gatilho Android ausente: ${path}`);
  }
});

test("build web transpila sintaxe para WebView antiga do Android 10", () => {
  assert.ok(viteConfig.includes('target: "chrome70"'));
  assert.ok(viteConfig.includes("optional chaining/nullish coalescing"));
  assert.ok(androidReadme.includes("Chrome 70"));
});

test("Android 16 usa uma cadeia de ferramentas compatível e target API 36", () => {
  assert.match(androidGradle, /compileSdk 36/);
  assert.match(androidGradle, /targetSdk 36/);
  assert.match(androidProjectGradle, /com\.android\.application' version '8\.9\.1'/);
  assert.ok(androidWorkflow.includes("gradle-version: 8.11.1"));
  assert.ok(androidApkWorkflow.includes("gradle-version: 8.11.1"));
  assert.ok(androidWorkflow.includes('target_sdk.group(1) != "36"'));
  assert.ok(androidReadme.includes("targetSdk 36"));
});

test("permissão de instalação usa Activity Result API sem callback legado", () => {
  assert.ok(android.includes("ActivityResultContracts.StartActivityForResult()"));
  assert.ok(android.includes("updateInstallPermissionLauncher = registerForActivityResult("));
  assert.ok(android.includes("updateInstallPermissionLauncher.launch(settingsIntent)"));
  assert.ok(android.includes("private fun resumePendingUpdateAfterPermission()"));
  assert.ok(android.includes("PENDING_UPDATE_APK_KEY"));
  assert.doesNotMatch(android, /startActivityForResult\(/);
  assert.doesNotMatch(android, /override fun onActivityResult\(/);
  assert.doesNotMatch(android, /APP_UPDATE_PERMISSION_REQUEST/);
});

test("release Android só publica depois de instalação e atualização real em Android 10", () => {
  assert.ok(androidWorkflow.includes("  android-smoke:"));
  assert.ok(androidWorkflow.includes("needs: [android-build, android-smoke]"));
  assert.ok(androidWorkflow.includes("needs.android-smoke.result == 'success'"));
  assert.ok(androidWorkflow.includes("api-level: 29"));
  assert.ok(androidWorkflow.includes("ANDROID_I_WANT_MY_TCG=yes"));
  assert.ok(androidWorkflow.includes('script: bash "$GITHUB_WORKSPACE/scripts/android-emulator-smoke.sh"'));
  assert.ok(androidSmokeScript.includes('RELEASES_FILE="$RUNNER_TEMP/android-releases.json"'));
  assert.ok(androidSmokeScript.includes('printf \'%s\' "$RELEASES_JSON" > "$RELEASES_FILE"'));
  assert.ok(androidSmokeScript.includes('json.load(releases_file)'));
  assert.ok(!androidSmokeScript.includes('python3 - "$APP_VERSION" "$RELEASES_JSON"'));
  assert.ok(androidSmokeScript.includes("/releases?per_page=50"));
  assert.ok(androidSmokeScript.includes('release.get("draft")'));
  assert.ok(androidSmokeScript.includes('release.get("prerelease")'));
  assert.ok(androidSmokeScript.split("\n").some((line) =>
    line.includes("re.fullmatch") && line.includes("android-v(") && line.includes("\d+")
  ));
  assert.ok(androidSmokeScript.includes("max(previous_candidates"));
  assert.ok(androidSmokeScript.includes('adb install "$PREVIOUS_APK"'));
  assert.ok(androidSmokeScript.includes('adb install -r "$CURRENT_APK"'));
  assert.ok(androidSmokeScript.includes("versionName=$APP_VERSION"));
  assert.ok(androidSmokeScript.includes("versionCode=$VERSION_CODE"));
  assert.ok(androidSmokeScript.includes('adb shell am start -W -n "$APP_ID/.MainActivity"'));
});

test("navegação de retorno WebView usa o dispatcher AndroidX", () => {
  assert.ok(android.includes("import androidx.activity.ComponentActivity"));
  assert.ok(android.includes("import androidx.activity.OnBackPressedCallback"));
  assert.ok(android.includes("class MainActivity : ComponentActivity()"));
  assert.ok(android.includes("onBackPressedDispatcher.addCallback(this, webViewBackCallback)"));
  assert.ok(android.includes("webViewBackCallback.isEnabled = canGoBack"));
  assert.ok(android.includes("override fun doUpdateVisitedHistory("));
  assert.ok(android.includes("updateWebViewBackNavigation(view.canGoBack())"));
  assert.doesNotMatch(android, /override fun onBackPressed\(/);
  assert.ok(android.includes("ActivityResultContracts.RequestPermission()"));
  assert.ok(android.includes("registerForActivityResult("));
  assert.ok(android.includes("notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)"));
  assert.ok(android.includes("notificationPermissionRequestPending = false"));
  assert.doesNotMatch(android, /override fun onRequestPermissionsResult\(/);
  assert.ok(androidManifest.includes('android:enableOnBackInvokedCallback="true"'));
});

test("layout Android preserva áreas seguras ao usar edge-to-edge", () => {
  assert.ok(android.includes("setOnApplyWindowInsetsListener"));
  assert.ok(android.includes("WindowInsets.Type.systemBars()"));
  assert.ok(android.includes("WindowInsets.Type.displayCutout()"));
});

test("WebView respeita o ciclo de vida e recupera a página inicial", () => {
  assert.match(android, /val restoredWebState = savedInstanceState != null/);
  assert.match(android, /else if \(!restoredWebState\)/);
  assert.match(android, /webView\.onPause\(\)/);
  assert.match(android, /webView\.onResume\(\)/);
});

test("Android escolhe o cache offline antes da primeira navegação da WebView", () => {
  const createStart = android.indexOf("override fun onCreate(");
  const buildScreenStart = android.indexOf("private fun buildScreen()", createStart);
  const createBlock = android.slice(createStart, buildScreenStart);
  const configureIndex = createBlock.indexOf("configureWebView()");
  const connectivityIndex = createBlock.indexOf("refreshConnectivity()");
  const navigationIndices = [
    createBlock.indexOf("webView.loadUrl(HOME_URL)"),
    createBlock.indexOf("webView.loadUrl(resolvePushUrl(pushUrl))")
  ].filter((index) => index >= 0);
  assert.ok(configureIndex >= 0 && connectivityIndex > configureIndex);
  assert.ok(navigationIndices.length > 0);
  assert.ok(navigationIndices.every((index) => index > connectivityIndex));
});

test("controles nativos Android respeitam alvos de toque de 48 dp", () => {
  assert.ok(android.includes("minHeight = dp(48)"));
  assert.ok(android.includes("LinearLayout.LayoutParams(0, -2, 1f)"));
  assert.ok(android.includes("LinearLayout.LayoutParams(-2, -2)"));
  assert.ok(android.includes("LinearLayout.LayoutParams(-1, -2)"));
});

test("smoke test Android inicializa ADB com tentativas limitadas e reinício do daemon", () => {
  assert.ok(androidSmokeScript.includes("ensure_adb_ready()"));
  assert.ok(androidSmokeScript.includes("for attempt in $(seq 1 5)"));
  assert.ok(androidSmokeScript.includes("timeout 15 adb start-server"));
  assert.ok(androidSmokeScript.includes('state="$(timeout 15 adb get-state 2>/dev/null || true)"'));
  assert.ok(androidSmokeScript.includes('[[ "$state" == "device" ]]'));
  assert.ok(androidSmokeScript.includes("adb kill-server"));
  assert.ok(androidSmokeScript.includes("ADB não conseguiu confirmar o emulador"));
});

test("smoke test Android confirma o conteúdo principal, não apenas a Activity", () => {
  assert.ok(androidSmokeScript.includes("uiautomator dump"));
  assert.ok(androidSmokeScript.includes('grep -Eiq "Encontre concursos"'));
  assert.ok(androidSmokeScript.includes("CONTENT_READY"));
  assert.ok(androidSmokeScript.includes("Conteúdo principal do catálogo confirmado na WebView."));
});

test("smoke test Android tolera falhas transitórias do UIAutomator sem aceitar XML antigo", () => {
  assert.ok(androidSmokeScript.includes("capture_window_xml()"));
  assert.ok(androidSmokeScript.includes('adb shell rm -f "$WINDOW_XML_PATH"'));
  assert.ok(androidSmokeScript.includes('if ! adb shell uiautomator dump "$WINDOW_XML_PATH"'));
  assert.ok(androidSmokeScript.includes('adb shell cat "$WINDOW_XML_PATH" 2>/dev/null || true'));
  assert.ok(androidSmokeScript.includes("NATIVE_UI_READY"));
  assert.ok(androidSmokeScript.includes("for attempt in $(seq 1 24)"));
  assert.ok(androidSmokeScript.includes('grep -Eiq "Encontre concursos"'));
});

test("workflow de release Android depende de alterações nativas, não do teste do emulador", () => {
  const releasePathFilters = [...androidWorkflow.matchAll(/^ {4}paths:\s*\n((?:^ {6}- .*\n)+)/gm)]
    .map(match => match[1]).join("\n");
  assert.ok(releasePathFilters.includes('"android/app/src/**"'));
  assert.ok(releasePathFilters.includes('".github/workflows/android-release.yml"'));
  assert.ok(androidWorkflow.includes('      - "scripts/android-emulator-smoke.sh"') === false);
  assert.match(androidWorkflow, /run: node --test scripts\/platform-resilience\.node-test\.mjs/);
  assert.match(androidSmokeWorkflow, /scripts\/android-emulator-smoke\.sh/);
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
  assert.match(serviceWorker, /editalradar-app-v6/);
  assert.match(serviceWorker, /new AbortController\(\)/);
  assert.match(serviceWorker, /controller\.abort\(\), 4500/);
  assert.match(serviceWorker, /self\.clearTimeout\(timeoutId\)/);
  assert.match(serviceWorker, /exactPage \|\| appShell \|\| Response\.error\(\)/);
});

test("falha de um recurso opcional não impede a atualização do service worker", () => {
  assert.ok(serviceWorker.includes("requiredShellUrls"));
  assert.ok(serviceWorker.includes("optionalShellUrls"));
  assert.ok(serviceWorker.includes("Promise.allSettled(optionalShellUrls.map"));
  assert.ok(serviceWorker.includes("await cache.addAll([...new Set(assetPaths)])"));
  assert.ok(serviceWorker.includes("Keep the current worker"));
});

test("falha de cache não transforma uma resposta online válida em erro de navegação", () => {
  assert.match(serviceWorker, /cache\.put\(request, response\.clone\(\)\)\.catch\(\(\) => \{\}\)/);
  assert.match(serviceWorker, /caches\.open\(CACHE_NAME\)\.then\(async \(cache\) =>/);
});

test("PWA usa cache local em erros temporários do servidor", () => {
  assert.match(serviceWorker, /response\.status >= 500/);
  assert.match(serviceWorker, /response\.status === 408/);
  assert.match(serviceWorker, /response\.status === 429/);
  assert.match(serviceWorker, /exactPage \|\| appShell \|\| response/);
});

test("recursos estáticos pré-armazenados funcionam com cabeçalhos Origin diferentes", () => {
  assert.ok(serviceWorker.includes('cache.match(request, { ignoreVary: true })'));
  assert.ok(serviceWorker.includes("CACHE_NAME = \"editalradar-app-v6\""));
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
  const versionCode = androidGradle.match(/^\s*versionCode (\d+)$/m);
  const versionName = androidGradle.match(/^\s*versionName ['"]([^'"]+)['"]$/m);
  assert.ok(versionCode && Number(versionCode[1]) > 0, "versionCode deve ser um inteiro positivo");
  assert.ok(versionName && /^\d+\.\d+\.\d+$/.test(versionName[1]), "versionName deve seguir semver simples");
  assert.ok(androidGradle.includes("androidx.activity:activity-ktx:1.13.0"));
  assert.ok(androidGradle.includes("androidx.fragment:fragment-ktx:1.9.1"));
  assert.ok(androidGradle.includes("androidx.webkit:webkit:1.18.0"));
  assert.doesNotMatch(androidGradle, /storePassword\s*['"][^'"]+['"]/);
});

test("GitHub Actions nunca publica APK de depuração como atualização pública", () => {
  assert.match(androidWorkflow, /Configure permanent Android signing key/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_KEYSTORE_BASE64/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_STORE_PASSWORD/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_KEY_ALIAS/);
  assert.match(androidWorkflow, /ANDROID_RELEASE_KEY_PASSWORD/);
  assert.match(androidWorkflow, /gradle assembleRelease bundleRelease/);
  assert.ok(androidWorkflow.includes("Validate Android release lint on pull requests"));
  assert.ok(androidWorkflow.includes("run: gradle lintRelease --no-daemon --max-workers=2"));
  assert.match(androidWorkflow, /steps\.signing\.outputs\.ready == 'true'/);
  assert.match(androidWorkflow, /verification-only/);
  const lineBreak = String.fromCharCode(10);
  assert.ok(androidWorkflow.includes(
    "      - name: Configure permanent Android signing key" + lineBreak +
    "        if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"
  ));
  assert.ok(androidWorkflow.includes(
    "      - name: Validate Firebase Android configuration" + lineBreak +
    "        if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"
  ));
  assert.ok(androidWorkflow.includes("permissions:" + lineBreak + "  contents: read"));
  assert.ok(androidWorkflow.includes("publish-release:"));
  assert.ok(androidWorkflow.includes("permissions:" + lineBreak + "      contents: write"));
  assert.ok(!androidWorkflow.includes('      - "android/**"'));
  assert.ok(androidWorkflow.includes("Verify signed APK and AAB before publishing"));
  assert.ok(androidWorkflow.includes("-name apksigner"));
  assert.ok(androidWorkflow.includes("jarsigner -verify"));
  assert.ok(androidWorkflow.includes("EXPECTED_ANDROID_SIGNER_SHA256"));
  assert.ok(androidWorkflow.includes("6192a29e44539f63b525a9288f95fc98d6deb2f936cef50d624a228ca358595b"));
  assert.ok(androidWorkflow.includes("keytool -printcert -jarfile"));
  assert.ok(androidWorkflow.includes("AAB_SIGNER_SHA256"));
  assert.ok(androidWorkflow.includes("-name aapt"));
  assert.ok(androidWorkflow.includes('"$AAPT" dump badging "$APK_PATH"'));
  assert.ok(androidWorkflow.includes("targetSdkVersion"));
  assert.ok(androidWorkflow.includes("minSdk"));
  assert.ok(androidWorkflow.includes("needs.android-build.outputs.release_ready == 'true'"));
  assert.ok(androidWorkflow.includes("uses: softprops/action-gh-release@v3"));
  assert.ok(androidWorkflow.includes("sha256sum --check SHA256SUMS.txt"));
  assert.ok(androidWorkflow.includes("actions/download-artifact@v8"));
});


test("falha temporária ao consultar atualização não bloqueia novas tentativas", () => {
  const maybeCheckBlock = android.slice(
    android.indexOf("    private fun maybeCheckForUpdates()"),
    android.indexOf("    private fun checkForUpdates(manual: Boolean)")
  );
  assert.ok(!maybeCheckBlock.includes("putLong(LAST_UPDATE_CHECK_KEY"));
  const successStart = android.indexOf("result.onSuccess { release ->");
  const failureStart = android.indexOf("}.onFailure", successStart);
  const successBlock = android.slice(successStart, failureStart);
  assert.ok(successBlock.includes("if (!manual)"));
  assert.ok(successBlock.includes("putLong(LAST_UPDATE_CHECK_KEY, System.currentTimeMillis())"));
  assert.ok(android.includes("lastCheck > 0L && now >= lastCheck && now - lastCheck < AUTO_UPDATE_CHECK_INTERVAL_MS"));
});

test("atualizador nativo consulta apenas releases oficiais e evita downgrade", () => {
  assert.ok(appUpdate.includes("https://api.github.com/repos/dagamavasco170-lang/editalradar/releases/latest"));
  assert.ok(appUpdate.includes('Regex("^android-v'));
  assert.ok(appUpdate.includes("versionCode <= installedVersionCode()"));
  assert.ok(appUpdate.includes('optBoolean("draft", true)'));
  assert.ok(appUpdate.includes('optBoolean("prerelease", true)'));
  assert.ok(appUpdate.includes("EditalRadar-Android-v"));
  assert.ok(appUpdate.includes("MAX_RELEASE_METADATA_BYTES = 512L * 1024L"));
  assert.ok(appUpdate.includes("readBoundedText(connection, MAX_RELEASE_METADATA_BYTES)"));
  assert.ok(!appUpdate.includes("it.readText()"));
  assert.ok(appUpdate.includes("RejectedExecutionException"));
});

test("atualizador exige ativos publicados e confere o tamanho anunciado pela release", () => {
  assert.ok(appUpdate.includes('asset.optString("state") == "uploaded"'));
  assert.ok(appUpdate.includes("apkSizeBytes = asset.optLong(\"size\", -1L)"));
  assert.ok(appUpdate.includes("apkSizeBytes !in 1L..MAX_APK_BYTES"));
  assert.ok(appUpdate.includes("downloaded != release.apkSizeBytes"));
  assert.ok(appUpdate.includes("declaredLength != release.apkSizeBytes"));
});

test("download do atualizador valida origem, redirects, tamanho e SHA-256", () => {
  assert.ok(appUpdate.includes("RELEASE_ASSET_PREFIX"));
  assert.ok(appUpdate.includes("release-assets.githubusercontent.com"));
  assert.ok(appUpdate.includes("objects.githubusercontent.com"));
  assert.ok(appUpdate.includes("MAX_APK_BYTES"));
  assert.ok(appUpdate.includes('MessageDigest.getInstance("SHA-256")'));
  assert.ok(appUpdate.includes("MessageDigest.isEqual"));
  assert.ok(appUpdate.includes("SHA256SUMS.txt"));
  assert.ok(appUpdate.includes("output.fd.sync()"));
});

test("atualizador valida pacote e versão antes de delegar assinatura ao Android", () => {
  assert.ok(appUpdate.includes("getPackageArchiveInfo"));
  assert.ok(appUpdate.includes("candidateInfo.packageName != appContext.packageName"));
  assert.ok(appUpdate.includes("candidateVersionCode <= installedVersionCode()"));
  assert.ok(appUpdate.includes("expectedRelease.versionCode"));
  assert.ok(appUpdate.includes("expectedRelease.versionName"));
  assert.ok(!appUpdate.includes("hasSameInstalledSignature"));
  assert.ok(android.includes("appUpdateManager.isValidUpdatePackage(apkFile, release)"));
  assert.ok(android.includes("appUpdateManager.isValidUpdatePackage(apkFile)"));
  assert.ok(!android.includes("hasSameInstalledSignature"));
  assert.ok(android.includes("PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)"));
  assert.ok(android.includes("session.commit(statusPendingIntent.intentSender)")); 
  const installCallbackBlock = android.slice(
    android.indexOf("val callbackIntent = Intent(this, UpdateInstallReceiver::class.java)"),
    android.indexOf("session.commit(statusPendingIntent.intentSender)")
  );
  assert.match(installCallbackBlock, /val mutabilityFlag = PendingIntent\.FLAG_MUTABLE/);
  assert.doesNotMatch(installCallbackBlock, /PendingIntent\.FLAG_IMMUTABLE/);
  assert.ok(android.includes(String.raw`append("\nCódigo do instalador:`));
  assert.ok(android.includes(String.raw`"\n\nSua versão atual e seus dados foram mantidos. "`));
  assert.ok(android.includes("val installer = packageManager.packageInstaller"));
  assert.ok(android.includes("Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES"));
  assert.ok(androidManifest.includes("android.permission.REQUEST_INSTALL_PACKAGES"));
  assert.ok(androidManifest.includes('android:name=".UpdateInstallReceiver"'));
  assert.ok(updateReceiver.includes("STATUS_PENDING_USER_ACTION"));
  assert.ok(updateReceiver.includes("STATUS_FAILURE_CONFLICT"));
  assert.ok(updateReceiver.includes("EXTRA_STATUS_MESSAGE"));
  assert.ok(updateReceiver.includes("PENDING_FAILURE_STATUS_KEY"));
  assert.ok(updateReceiver.includes("userMessageForStatus"));
  assert.ok(updateReceiver.includes("Log.w("));
  assert.ok(android.includes("showPendingInstallFailureIfAny"));
  assert.ok(android.includes("Copiar detalhes"));
  assert.ok(android.includes("Mensagem do Android"));
  assert.ok(updateReceiver.includes("context.startActivity(confirmationIntent)"));
});

test("tela do aplicativo permite verificar e acompanhar atualizações", () => {
  assert.ok(android.includes('text = "Atualizações"'));
  assert.ok(android.includes("setOnClickListener { checkForUpdates(manual = true) }"));
  assert.ok(android.includes("AUTO_UPDATE_CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L"));
  assert.ok(android.includes("Baixar e instalar"));
  assert.ok(android.includes("downloadProgressBar"));
  assert.ok(android.includes("Confirme a atualização na tela do Android"));
});

test("site mantém recursos de acessibilidade e safe areas móveis", () => {
  assert.match(styles, /\.skip-link/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /forced-colors:\s*active/);
  assert.match(styles, /safe-area-inset-left/);
  assert.match(styles, /safe-area-inset-bottom/);
});


test("barra superior Android adapta altura a fontes ampliadas e mantém textos legíveis", () => {
  const statusStart = android.indexOf("statusText = TextView(this)");
  const statusEnd = android.indexOf("progress = ProgressBar", statusStart);
  const statusBlock = android.slice(statusStart, statusEnd);
  assert.match(statusBlock, /maxLines = 2/);
  assert.match(statusBlock, /ellipsize = android\.text\.TextUtils\.TruncateAt\.END/);

  const updateStart = android.indexOf("updateButton = TextView(this)");
  const updateEnd = android.indexOf("val header = LinearLayout", updateStart);
  const updateBlock = android.slice(updateStart, updateEnd);
  assert.match(updateBlock, /maxLines = 2/);
  assert.match(updateBlock, /minimumWidth = dp\(112\)/);
  assert.match(updateBlock, /minHeight = dp\(48\)/);
  assert.match(android, /LinearLayout\.LayoutParams\(0, -2, 1f\)/);
  assert.match(android, /root\.addView\(header, LinearLayout\.LayoutParams\(-1, -2\)\)/);
});

test("atualizador Android limita notificações de progresso a mudanças de percentual", () => {
  const start = appUpdate.indexOf("private fun downloadReleaseApk(");
  const end = appUpdate.indexOf("private fun openReleaseAssetConnection(", start);
  const block = appUpdate.slice(start, end);
  assert.ok(block.includes("var lastReportedPercentage = Int.MIN_VALUE"));
  assert.ok(block.includes("if (percentage != lastReportedPercentage)"));
  assert.ok(block.includes("lastReportedPercentage = percentage"));
  assert.ok(block.includes("onProgress(100)"));
});


test("busca do destaque usa campo e botão em linhas próprias em celulares estreitos", () => {
  assert.match(styles, /grid-template-columns:22px minmax\(0,1fr\)/);
  assert.match(styles, /\.hero-search input\{[\s\S]*?height:44px;min-height:44px/);
  assert.match(styles, /\.hero-search button\{[\s\S]*?min-height:46px/);
  assert.match(styles, /\.hero\{padding-bottom:22px\}/);
});

test("conteúdo móvel reserva espaço para a navegação inferior fixa", () => {
  assert.match(styles, /\.main\{padding-bottom:calc\(92px \+ env\(safe-area-inset-bottom, 0px\)\)\}/);
});

test("diagnósticos do site e Android enviam erros com limites e filtros", () => {
  assert.match(clientTelemetry, /unhandledrejection/);
  assert.match(clientTelemetry, /resource_load_error/);
  assert.match(clientTelemetry, /console_error/);
  assert.match(clientTelemetry, /editalradar-native-diagnostic/);
  assert.match(clientTelemetry, /BATCH_SIZE = 5/);
  assert.match(clientTelemetry, /MAX_QUEUE = 30/);
  assert.match(diagnosticsFunction, /Rate limit reached/);
  assert.match(diagnosticsFunction, /Bearer\\s\+/);
  assert.match(diagnosticsFunction, /private_key/);
  assert.match(diagnosticsMigration, /char_length/);
  assert.match(diagnosticsMigration, /enable row level security/);
  assert.match(diagnosticsMigration, /revoke all on public\.app_diagnostics from anon, authenticated/);
});

test("falhas de workflow monitorado criam issues sem duplicar", () => {
  assert.match(failureReporter, /workflow_run/);
  assert.match(failureReporter, /conclusion == 'failure'/);
  assert.match(failureReporter, /issues\.create/);
  assert.match(failureReporter, /\[CI falhou\]/);
  assert.match(failureReporter, /evitando duplicação/);
});

test("relatório Supabase suporta secret keys novas e JWT service_role legado", () => {
  assert.match(clientDiagnosticsSummary, /apikey: supabaseKey/);
  assert.match(clientDiagnosticsSummary, /startsWith\("sb_secret_"\)/);
  assert.match(clientDiagnosticsSummary, /headers\.Authorization = "Bearer " \+ supabaseKey/);
  assert.match(clientDiagnosticsSummary, /legacy service_role JWTs/);
  assert.match(clientDiagnosticsSummary, /new URL\(process\.env\.SUPABASE_URL\)\.hostname\.split\("\."\)/);
  assert.doesNotMatch(clientDiagnosticsSummary, /match\(\/https:\/\/\(\[\.\^\]\+\)/);
});

test("GitHub recebe apenas métricas agregadas dos logs de cliente", () => {
  assert.match(clientDiagnosticsSummary, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(clientDiagnosticsSummary, /schedule/);
  assert.match(clientDiagnosticsSummary, /Eventos por plataforma/);
  assert.match(clientDiagnosticsSummary, /github\.rest\.issues\.create/);
  assert.match(clientDiagnosticsSummary, /sem mensagens, stack traces, IDs de usuário ou IP/);
});
