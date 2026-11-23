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
  assert.ok(android.includes("private fun recoverFromRendererTermination("));
  assert.ok(android.includes("container?.removeView(goneView)"));
  assert.ok(android.includes("goneView.destroy()"));
  assert.ok(android.includes("webView = replacement"));
  assert.ok(android.includes("configureWebView()"));
  assert.ok(android.includes("replacement.loadUrl(HOME_URL)"));
  assert.ok(android.includes("EditalRadarWebView"));
  assert.ok(android.includes("Feche e abra o aplicativo novamente."));
});

test("Android atualiza o token FCM ao retomar a página confiável", () => {
  assert.ok(android.includes("private var webPageReady = false"));
  assert.ok(android.includes("private var fcmTokenRequestInFlight = false"));
  assert.ok(android.includes("override fun onPageStarted("));
  assert.ok(android.includes("override fun onPageFinished("));
  assert.ok(android.includes("webPageReady = runCatching { isInternalAppUrl(Uri.parse(url)) }"));
  const resumeStart = android.indexOf("override fun onResume()");
  const resumeEnd = android.indexOf("private fun showPendingInstallFailureIfAny()", resumeStart);
  const resumeBlock = android.slice(resumeStart, resumeEnd);
  assert.ok(resumeBlock.includes("if (webPageReady) requestFcmToken()"));
  assert.ok(android.includes("if (fcmTokenRequestInFlight || isFinishing || isDestroyed) return"));
  assert.ok(android.includes("fcmTokenRequestInFlight = true"));
  assert.ok(android.includes("fcmTokenRequestInFlight = false"));
  assert.ok(android.includes("if (isFinishing || isDestroyed) return@addOnCompleteListener"));
  assert.ok(android.includes('getSharedPreferences("editalradar_push", Context.MODE_PRIVATE)'));
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
  assert.match(serviceWorker, /editalradar-app-v5/);
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
  assert.match(androidGradle, /versionCode 17/);
  assert.ok(androidGradle.includes("versionName '1.3.4'"));
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
