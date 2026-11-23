package br.com.editalradar.app

import android.Manifest
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import android.app.AlertDialog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.graphics.Color
import android.util.Log
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.SslErrorHandler
import android.net.http.SslError
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.io.FileInputStream
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : ComponentActivity() {
    companion object {
        private const val HOME_URL = "https://dagamavasco170-lang.github.io/editalradar/"
        private const val HOME_HOST = "dagamavasco170-lang.github.io"
        private const val HOME_PATH = "/editalradar/"
        private const val NOTIFICATION_CHANNEL_ID = "editalradar_updates"
        private const val MAX_NATIVE_MESSAGE_CHARS = 2_048
        private const val AUTO_UPDATE_CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L
        private const val UPDATE_PREFERENCES = "editalradar_app_updates"
        private const val LAST_UPDATE_CHECK_KEY = "last_update_check"
        private const val PENDING_UPDATE_APK_KEY = "pending_update_apk"
        private const val NATIVE_UI_PREFERENCES = "editalradar_ui"
        private const val DARK_THEME_KEY = "dark_mode"
        const val EXTRA_PUSH_URL = "br.com.editalradar.app.EXTRA_PUSH_URL"
    }

    private lateinit var webView: WebView
    private lateinit var webViewBackCallback: OnBackPressedCallback
    private lateinit var contentRoot: LinearLayout
    private lateinit var progress: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var updateButton: TextView
    private lateinit var appUpdateManager: AppUpdateManager
    private var availableUpdate: AppUpdateRelease? = null
    private var downloadDialog: AlertDialog? = null
    private var downloadProgressBar: ProgressBar? = null
    private var downloadProgressText: TextView? = null
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lastKnownOnlineState: Boolean? = null
    private var notificationPermissionRequestPending = false
    private lateinit var notificationPermissionLauncher: ActivityResultLauncher<String>
    private lateinit var updateInstallPermissionLauncher: ActivityResultLauncher<Intent>
    private var webPageReady = false
    private var fcmTokenRequestInFlight = false
    private var pendingFcmTokenDelivery = false
    private var isDarkThemeEnabled = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        isDarkThemeEnabled = getSharedPreferences(NATIVE_UI_PREFERENCES, Context.MODE_PRIVATE)
            .getBoolean(DARK_THEME_KEY, false)
        setTheme(
            if (isDarkThemeEnabled) android.R.style.Theme_Material_NoActionBar
            else android.R.style.Theme_Material_Light_NoActionBar
        )
        // Release lint requires Fragment 1.3+ with Activity Result; module pins 1.9.1.
        notificationPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { granted ->
            notificationPermissionRequestPending = false
            dispatchNativeNotificationPermission(granted)
        }
        updateInstallPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) {
            resumePendingUpdateAfterPermission()
        }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        buildScreen()
        applyNativeTheme(isDarkThemeEnabled)
        configureBackNavigation()
        appUpdateManager = AppUpdateManager(this)
        configureNotifications()
        configureWebView()
        // Define o modo de cache antes da primeira navegação, inclusive em uma
        // abertura sem internet após o Android encerrar o processo do aplicativo.
        refreshConnectivity()

        val restoredWebState = savedInstanceState != null &&
            webView.restoreState(savedInstanceState) != null
        updateWebViewBackNavigation(webView.canGoBack())

        if (!handleAuthIntent(intent)) {
            val pushUrl = intent?.getStringExtra(EXTRA_PUSH_URL)
            if (!pushUrl.isNullOrBlank()) {
                webView.loadUrl(resolvePushUrl(pushUrl))
            } else if (!restoredWebState) {
                // Não deixa a tela em branco quando o estado anterior não puder ser restaurado.
                webView.loadUrl(HOME_URL)
            }
        }
        maybeCheckForUpdates()
    }

    private fun buildScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        contentRoot = root

        statusText = TextView(this).apply {
            text = "Preparando seu EditalRadar…"
            textSize = 13f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(24, 105, 87))
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(8))
            minHeight = dp(48)
            setOnClickListener { retryCurrentPage() }
            contentDescription = "Estado da conexão. Toque para tentar novamente."
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
            contentDescription = "Carregando EditalRadar"
            isFocusable = false
        }

        webView = WebView(this).apply {
            contentDescription = "Conteúdo do EditalRadar"
            setBackgroundColor(if (isDarkThemeEnabled) Color.rgb(13, 22, 36) else Color.WHITE)
        }
        root.setOnApplyWindowInsetsListener { view, insets ->
            // O teclado usa SOFT_INPUT_ADJUST_RESIZE; não somar IME ao padding de barras.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val safeInsets = insets.getInsets(
                    WindowInsets.Type.systemBars() or
                        WindowInsets.Type.displayCutout()
                )
                view.setPadding(safeInsets.left, safeInsets.top, safeInsets.right, safeInsets.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    insets.systemWindowInsetBottom
                )
            }
            insets
        }
        updateButton = TextView(this).apply {
            text = "Atualizações"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(32, 75, 116))
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(8), dp(12), dp(8))
            minHeight = dp(48)
            minimumWidth = dp(112)
            isFocusable = true
            contentDescription = "Verificar atualizações do EditalRadar"
            setOnClickListener { checkForUpdates(manual = true) }
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(statusText, LinearLayout.LayoutParams(0, dp(48), 1f))
            addView(updateButton, LinearLayout.LayoutParams(-2, dp(48)))
        }

        root.addView(header, LinearLayout.LayoutParams(-1, dp(48)))
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(3)))
        root.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    private fun maybeCheckForUpdates() {
        if (!isInternetAvailable()) return
        val preferences = getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
        val lastCheck = preferences.getLong(LAST_UPDATE_CHECK_KEY, 0L)
        val now = System.currentTimeMillis()
        // A mudança manual do relógio não pode bloquear novas verificações.
        if (lastCheck > 0L && now >= lastCheck && now - lastCheck < AUTO_UPDATE_CHECK_INTERVAL_MS) return

        checkForUpdates(manual = false)
    }

    private fun checkForUpdates(manual: Boolean) {
        if (!isInternetAvailable()) {
            if (manual) {
                Toast.makeText(this, "Conecte-se à internet para verificar atualizações.", Toast.LENGTH_LONG).show()
            }
            return
        }

        updateButton.isEnabled = false
        if (availableUpdate == null) updateButton.text = "Verificando…"

        appUpdateManager.checkForUpdate { result ->
            if (isFinishing || isDestroyed) return@checkForUpdate
            updateButton.isEnabled = true

            result.onSuccess { release ->
                if (!manual) {
                    getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
                        .edit()
                        .putLong(LAST_UPDATE_CHECK_KEY, System.currentTimeMillis())
                        .apply()
                }
                availableUpdate = release
                updateButton.text = if (release != null) "Atualizar" else "Atualizações"
                updateButton.contentDescription = if (release != null) {
                    "Atualização ${release.versionName} disponível. Toque para baixar."
                } else {
                    "Verificar atualizações do EditalRadar"
                }

                if (release != null) {
                    if (manual) showUpdatePrompt(release)
                } else if (manual) {
                    Toast.makeText(this, "Você já está usando a versão mais recente.", Toast.LENGTH_SHORT).show()
                }
            }.onFailure {
                updateButton.text = if (availableUpdate != null) "Atualizar" else "Atualizações"
                if (manual) {
                    Toast.makeText(this, "Não foi possível verificar agora. Tente novamente mais tarde.", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun showUpdatePrompt(release: AppUpdateRelease) {
        val notes = release.releaseNotes.ifBlank { "Melhorias de estabilidade e segurança." }
        themedAlertDialogBuilder()
            .setTitle("Nova versão disponível")
            .setMessage("EditalRadar ${release.versionName}\n\n$notes")
            .setPositiveButton("Baixar e instalar") { _, _ -> downloadAndInstall(release) }
            .setNegativeButton("Mais tarde", null)
            .show()
    }

    private fun showDownloadProgress() {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(8), dp(24), dp(16))
        }
        downloadProgressText = TextView(this).apply {
            text = "Preparando o download…"
            textSize = 14f
        }
        downloadProgressBar = ProgressBar(
            this,
            null,
            android.R.attr.progressBarStyleHorizontal
        ).apply {
            max = 100
            isIndeterminate = true
        }
        content.addView(downloadProgressText, LinearLayout.LayoutParams(-1, -2))
        content.addView(
            downloadProgressBar,
            LinearLayout.LayoutParams(-1, dp(18)).apply { topMargin = dp(16) }
        )

        downloadDialog = themedAlertDialogBuilder()
            .setTitle("Baixando atualização")
            .setView(content)
            .setCancelable(false)
            .create()
        downloadDialog?.show()
    }

    private fun downloadAndInstall(release: AppUpdateRelease) {
        updateButton.isEnabled = false
        updateButton.text = "Baixando…"
        showDownloadProgress()

        appUpdateManager.downloadAndVerify(
            release = release,
            onProgress = { percentage ->
                if (isFinishing || isDestroyed) return@downloadAndVerify
                val bar = downloadProgressBar ?: return@downloadAndVerify
                if (percentage < 0) {
                    bar.isIndeterminate = true
                    downloadProgressText?.text = "Baixando atualização…"
                } else {
                    bar.isIndeterminate = false
                    bar.progress = percentage
                    downloadProgressText?.text = "Baixando atualização: $percentage%"
                }
            },
            onComplete = { result ->
                downloadDialog?.dismiss()
                downloadDialog = null
                downloadProgressBar = null
                downloadProgressText = null
                updateButton.isEnabled = true
                updateButton.text = if (availableUpdate != null) "Atualizar" else "Atualizações"

                if (isFinishing || isDestroyed) return@downloadAndVerify
                result.onSuccess { apkFile ->
                    if (!appUpdateManager.isValidUpdatePackage(apkFile, release)) {
                        apkFile.delete()
                        themedAlertDialogBuilder()
                            .setTitle("Atualização inválida")
                            .setMessage("O arquivo recebido não corresponde à versão oficial esperada. Nenhuma alteração foi feita no aplicativo.")
                            .setPositiveButton("Entendi", null)
                            .show()
                        return@onSuccess
                    }
                    installDownloadedUpdate(apkFile)
                }.onFailure {
                    Toast.makeText(this, "Não foi possível baixar a atualização. Tente novamente.", Toast.LENGTH_LONG).show()
                }
            }
        )
    }

    private fun installDownloadedUpdate(apkFile: File) {
        if (!apkFile.isFile || apkFile.length() <= 0L) {
            Toast.makeText(this, "O arquivo de atualização não está disponível. Tente baixar novamente.", Toast.LENGTH_LONG).show()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(PENDING_UPDATE_APK_KEY, apkFile.absolutePath)
                .apply()

            themedAlertDialogBuilder()
                .setTitle("Permitir instalação")
                .setMessage("Para concluir a atualização, permita que o EditalRadar instale sua própria atualização. O Android mostrará essa autorização uma única vez.")
                .setPositiveButton("Abrir configurações") { _, _ ->
                    try {
                        val settingsIntent = Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:$packageName")
                        )
                        @Suppress("DEPRECATION")
                        updateInstallPermissionLauncher.launch(settingsIntent)
                    } catch (_: Exception) {
                        Toast.makeText(this, "Não foi possível abrir essa configuração.", Toast.LENGTH_LONG).show()
                    }
                }
                .setNegativeButton("Agora não", null)
                .show()
            return
        }

        commitApkInstall(apkFile)
    }

    private fun commitApkInstall(apkFile: File) {
        if (!appUpdateManager.isValidUpdatePackage(apkFile)) {
            Toast.makeText(this, "O arquivo de atualização não corresponde a uma versão válida. Baixe novamente.", Toast.LENGTH_LONG).show()
            return
        }

        var createdSessionId: Int? = null
        try {
            val parameters = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(packageName)
                setSize(apkFile.length())
            }
            // O PackageInstaller do Android valida a assinatura/cadeia de certificados
            // ao confirmar a sessão. Não duplicar essa validação com metadados do arquivo.
            val installer = packageManager.packageInstaller
            val sessionId = installer.createSession(parameters)
            createdSessionId = sessionId

            installer.openSession(sessionId).use { session ->
                FileInputStream(apkFile).use { input ->
                    session.openWrite("base.apk", 0L, apkFile.length()).use { output ->
                        input.copyTo(output, 64 * 1024)
                        session.fsync(output)
                    }
                }

                val callbackIntent = Intent(this, UpdateInstallReceiver::class.java).apply {
                    action = UpdateInstallReceiver.ACTION_INSTALL_STATUS
                }
                // PackageInstaller precisa acrescentar EXTRA_STATUS ao retorno.
                // Com targetSdk 36, o IntentSender de commit não pode ser imutável,
                // inclusive em aparelhos anteriores ao Android 12.
                val mutabilityFlag = PendingIntent.FLAG_MUTABLE
                val statusPendingIntent = PendingIntent.getBroadcast(
                    this,
                    sessionId,
                    callbackIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or mutabilityFlag
                )
                session.commit(statusPendingIntent.intentSender)
            }

            statusText.text = "Confirme a atualização na tela do Android."
        } catch (_: Exception) {
            createdSessionId?.let { sessionId ->
                runCatching { packageManager.packageInstaller.abandonSession(sessionId) }
            }
            Toast.makeText(this, "Não foi possível iniciar a instalação. Tente novamente.", Toast.LENGTH_LONG).show()
        }
    }

    private fun resumePendingUpdateAfterPermission() {
        val preferences = getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
        val pendingPath = preferences.getString(PENDING_UPDATE_APK_KEY, null)
        preferences.edit().remove(PENDING_UPDATE_APK_KEY).apply()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            packageManager.canRequestPackageInstalls() &&
            !pendingPath.isNullOrBlank()
        ) {
            val pendingFile = File(pendingPath)
            if (pendingFile.isFile && appUpdateManager.isValidUpdatePackage(pendingFile)) {
                commitApkInstall(pendingFile)
            } else {
                Toast.makeText(this, "O arquivo de atualização precisa ser baixado novamente.", Toast.LENGTH_LONG).show()
            }
        } else {
            Toast.makeText(this, "A autorização de instalação não foi concedida.", Toast.LENGTH_LONG).show()
        }
    }

    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        // O login Google abre no navegador do sistema; a WebView só precisa de cookies próprios.
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        WebView.setWebContentsDebuggingEnabled(
            applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        )

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = false
            cacheMode = WebSettings.LOAD_DEFAULT
            loadsImagesAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }
        }

        configureNativeBridge()

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                if (consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    val source = consoleMessage.sourceId().substringAfterLast('/').take(100)
                    Log.w("EditalRadarWebView", "JavaScript error in $source:${consoleMessage.lineNumber()}")
                }
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (view === webView) webPageReady = false
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                if (view === webView) {
                    webPageReady = !url.isNullOrBlank() &&
                        runCatching { isInternalAppUrl(Uri.parse(url)) }.getOrDefault(false)
                    updateWebViewBackNavigation(view.canGoBack())
                    if (webPageReady && pendingFcmTokenDelivery) requestFcmToken()
                }
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                if (view === webView) updateWebViewBackNavigation(view.canGoBack())
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val scheme = uri.scheme?.lowercase()

                if (scheme == "editalradar") {
                    if (request.isForMainFrame && uri.host == "auth-callback") {
                        handleAuthIntent(Intent(Intent.ACTION_VIEW, uri))
                    }
                    return true
                }

                // A ponte JavaScript nativa nunca fica disponível dentro de frames externos.
                if (!request.isForMainFrame) return !isInternalAppUrl(uri)

                if (isInternalAppUrl(uri)) return false

                val safeExternalLink = scheme == "https" &&
                    uri.host != null &&
                    uri.encodedUserInfo == null &&
                    (uri.port == -1 || uri.port == 443)
                val supportedAppLink = scheme == "tel" || scheme == "mailto"

                if (safeExternalLink || supportedAppLink) {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) {
                        statusText.text = "Não foi possível abrir o link externo."
                    }
                } else {
                    statusText.text = "Este link não pode ser aberto dentro do EditalRadar."
                }
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: android.webkit.WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.url?.host == HOME_HOST) {
                    val failedPath = request.url.path?.take(120).orEmpty()
                    Log.w(
                        "EditalRadarWebView",
                        "Resource load error ${error?.errorCode} at $failedPath; mainFrame=${request.isForMainFrame}"
                    )
                }
                if (request?.isForMainFrame == true) {
                    if (!isInternetAvailable()) {
                        statusText.text = "Sem conexão. Algumas informações já carregadas ainda podem estar disponíveis. Toque para tentar novamente."
                        statusText.setBackgroundColor(Color.rgb(154, 91, 29))
                        webView.settings.cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
                    } else {
                        setStatusWarning("Não foi possível abrir esta página agora. Toque para tentar novamente.")
                    }
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: android.webkit.WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.url?.host == HOME_HOST &&
                    errorResponse != null &&
                    errorResponse.statusCode >= 400
                ) {
                    val failedPath = request.url.path?.take(120).orEmpty()
                    Log.w("EditalRadarWebView", "HTTP ${errorResponse.statusCode} at $failedPath")
                }
                if (request?.isForMainFrame == true &&
                    errorResponse != null &&
                    errorResponse.statusCode >= 500
                ) {
                    setStatusWarning("Não foi possível atualizar agora. Toque para tentar novamente.")
                }
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // Nunca permite ignorar certificado inválido ou conexão TLS adulterada.
                handler?.cancel()
                setStatusWarning("Não foi possível estabelecer uma conexão segura. Tente novamente mais tarde.", severe = true)
            }

            @android.annotation.TargetApi(Build.VERSION_CODES.O)
            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail
            ): Boolean {
                return recoverFromRendererTermination(view, detail.didCrash())
            }
        }
    }

    /**
     * A WebView whose renderer has exited cannot be reused. Replace only the
     * affected instance and reopen the trusted app home, avoiding an immediate
     * retry of the page that may have caused a renderer crash.
     */
    private fun recoverFromRendererTermination(goneView: WebView, didCrash: Boolean): Boolean {
        val parent = goneView.parent as? ViewGroup
        val container = parent ?: if (::contentRoot.isInitialized) contentRoot else null
        val oldIndex = container?.indexOfChild(goneView) ?: -1
        val oldLayoutParams = goneView.layoutParams

        if (oldIndex >= 0) {
            container?.removeView(goneView)
        }

        runCatching { goneView.destroy() }

        if (goneView !== webView || isFinishing || isDestroyed || container == null) {
            Log.w("EditalRadarWebView", "Discarded terminated WebView; crashed=$didCrash")
            return true
        }

        val replacement = runCatching {
            WebView(this).apply {
                contentDescription = "Conteúdo do EditalRadar"
                setBackgroundColor(if (isDarkThemeEnabled) Color.rgb(13, 22, 36) else Color.WHITE)
            }
        }.getOrNull()

        if (replacement == null) {
            setStatusWarning("A página foi reiniciada, mas não pôde ser reaberta agora. Feche e abra o aplicativo novamente.")
            Log.w("EditalRadarWebView", "Could not recreate WebView after renderer termination")
            return true
        }

        webView = replacement
        webPageReady = false
        updateWebViewBackNavigation(canGoBack = false)
        val layoutParams = oldLayoutParams ?: LinearLayout.LayoutParams(-1, 0, 1f)
        val insertionIndex = if (oldIndex >= 0) {
            oldIndex.coerceIn(0, container.childCount)
        } else {
            container.childCount
        }
        container.addView(replacement, insertionIndex, layoutParams)

        progress.progress = 0
        progress.visibility = View.VISIBLE
        setStatusWarning("O EditalRadar precisou reiniciar uma página e já está se recuperando…")

        return try {
            configureWebView()
            replacement.loadUrl(HOME_URL)
            Log.w("EditalRadarWebView", "Recreated WebView renderer; crashed=$didCrash")
            true
        } catch (error: Exception) {
            progress.visibility = View.GONE
            statusText.text = "Não foi possível reabrir o EditalRadar agora. Feche e abra o aplicativo novamente."
            Log.w("EditalRadarWebView", "WebView recovery initialization failed", error)
            true
        }
    }

    private fun isInternalAppUrl(uri: Uri): Boolean {
        if (uri.scheme?.lowercase() != "https" ||
            !uri.host.equals(HOME_HOST, ignoreCase = true) ||
            (uri.port != -1 && uri.port != 443) ||
            uri.encodedUserInfo != null
        ) return false

        val path = uri.path ?: return false
        if (path != HOME_PATH.trimEnd('/') && !path.startsWith(HOME_PATH)) return false

        // Bloqueia segmentos de travessia, inclusive quando chegam codificados na URL.
        return path.split('/').none { it == "." || it == ".." }
    }

    /**
     * Exposes native capabilities only to the official HTTPS origin. The callback
     * also rejects same-origin iframes because only the top-level app page may
     * request permissions, notifications, or an FCM token.
     */
    private fun configureNativeBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return

        try {
            WebViewCompat.addWebMessageListener(
                webView,
                "EditalRadarNative",
                setOf("https://$HOME_HOST"),
                object : WebViewCompat.WebMessageListener {
                    override fun onPostMessage(
                        view: WebView,
                        message: WebMessageCompat,
                        sourceOrigin: Uri,
                        isMainFrame: Boolean,
                        replyProxy: JavaScriptReplyProxy
                    ) {
                        if (view !== webView || !isMainFrame || !isTrustedNativeBridgeOrigin(sourceOrigin)) return
                        val payload = message.data
                        if (payload.length > MAX_NATIVE_MESSAGE_CHARS) return
                        handleNativeBridgeMessage(payload)
                    }
                }
            )
        } catch (_: Exception) {
            // Fail closed: never fall back to the legacy all-frames JavaScript interface.
        }
    }

    private fun isTrustedNativeBridgeOrigin(uri: Uri): Boolean {
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host?.equals(HOME_HOST, ignoreCase = true) == true &&
            (uri.port == -1 || uri.port == 443) &&
            uri.encodedUserInfo == null
    }

    private fun handleNativeBridgeMessage(rawMessage: String) {
        val message = try {
            JSONObject(rawMessage)
        } catch (_: Exception) {
            return
        }

        when (message.optString("action")) {
            "set_theme" -> applyNativeTheme(message.optString("theme") == "dark")
            "request_notification_permission" -> requestNativeNotificationPermission()
            "show_notification" -> {
                val title = message.optString("title", "EditalRadar")
                    .take(90).ifBlank { "EditalRadar" }
                val body = message.optString("message", "Há uma atualização no seu acompanhamento.")
                    .take(350).ifBlank { "Há uma atualização no seu acompanhamento." }
                val tag = message.optString("tag").take(96)
                    .ifBlank { System.currentTimeMillis().toString() }
                postNativeNotification(title, body, tag)
            }
            "request_fcm_token" -> requestFcmToken()
        }
    }

    private fun applyNativeTheme(dark: Boolean) {
        isDarkThemeEnabled = dark
        getSharedPreferences(NATIVE_UI_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(DARK_THEME_KEY, dark)
            .apply()

        val background = if (dark) Color.rgb(13, 22, 36) else Color.WHITE
        val foreground = if (dark) Color.rgb(229, 237, 248) else Color.WHITE
        val statusBackground = if (dark) Color.rgb(27, 60, 55) else Color.rgb(24, 105, 87)
        val updateBackground = if (dark) Color.rgb(39, 65, 91) else Color.rgb(32, 75, 116)

        window.decorView.setBackgroundColor(background)
        if (::contentRoot.isInitialized) contentRoot.setBackgroundColor(background)
        if (::webView.isInitialized) webView.setBackgroundColor(background)
        if (::statusText.isInitialized) {
            statusText.setTextColor(foreground)
            statusText.setBackgroundColor(statusBackground)
        }
        if (::updateButton.isInitialized) {
            updateButton.setTextColor(foreground)
            updateButton.setBackgroundColor(updateBackground)
        }
        if (::progress.isInitialized) {
            progress.progressTintList = android.content.res.ColorStateList.valueOf(
                if (dark) Color.rgb(100, 190, 255) else Color.rgb(33, 151, 115)
            )
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.statusBarColor = background
            var visibility = window.decorView.systemUiVisibility
            visibility = if (dark) {
                visibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
            } else {
                visibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                visibility = if (dark) {
                    visibility and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
                } else {
                    visibility or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                }
                window.navigationBarColor = background
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.isNavigationBarContrastEnforced = false
            }
            window.decorView.systemUiVisibility = visibility
        }
    }

    private fun themedAlertDialogBuilder(): AlertDialog.Builder {
        val dialogTheme = if (isDarkThemeEnabled) {
            android.R.style.Theme_Material_Dialog_Alert
        } else {
            android.R.style.Theme_Material_Light_Dialog_Alert
        }
        return AlertDialog.Builder(ContextThemeWrapper(this, dialogTheme))
    }

    private fun setStatusWarning(message: String, severe: Boolean = false) {
        statusText.text = message
        statusText.setTextColor(
            if (isDarkThemeEnabled) Color.rgb(229, 237, 248) else Color.WHITE
        )
        statusText.setBackgroundColor(
            when {
                isDarkThemeEnabled && severe -> Color.rgb(78, 43, 49)
                isDarkThemeEnabled -> Color.rgb(66, 49, 29)
                severe -> Color.rgb(154, 65, 45)
                else -> Color.rgb(154, 91, 29)
            }
        )
    }

    private fun requestNativeNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            dispatchNativeNotificationPermission(granted = true)
            return
        }

        if (notificationPermissionRequestPending) return
        notificationPermissionRequestPending = true
        try {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } catch (_: Exception) {
            notificationPermissionRequestPending = false
            dispatchNativeNotificationPermission(granted = false)
        }
    }

    private fun requestFcmToken() {
        if (isFinishing || isDestroyed) return
        if (!isTrustedWebPageReady()) {
            pendingFcmTokenDelivery = true
            return
        }
        if (fcmTokenRequestInFlight) return
        if (FirebaseApp.getApps(this@MainActivity).isEmpty()) {
            dispatchFcmStatus(configured = false)
            return
        }

        pendingFcmTokenDelivery = false
        val cachedToken = getSharedPreferences("editalradar_push", Context.MODE_PRIVATE)
            .getString("fcm_token", null)
        if (!cachedToken.isNullOrBlank()) dispatchFcmToken(cachedToken)

        fcmTokenRequestInFlight = true
        try {
            FirebaseMessaging.getInstance().token
                .addOnCompleteListener { task ->
                    fcmTokenRequestInFlight = false
                    if (isFinishing || isDestroyed) return@addOnCompleteListener
                    if (!task.isSuccessful) {
                        dispatchFcmStatus(configured = true)
                        return@addOnCompleteListener
                    }
                    val token = task.result
                    if (token.isNullOrBlank()) {
                        dispatchFcmStatus(configured = true)
                        return@addOnCompleteListener
                    }
                    getSharedPreferences("editalradar_push", Context.MODE_PRIVATE)
                        .edit().putString("fcm_token", token).apply()
                    dispatchFcmToken(token)
                }
        } catch (_: Exception) {
            fcmTokenRequestInFlight = false
            dispatchFcmStatus(configured = false)
        }
    }

    private fun isTrustedWebPageReady(): Boolean {
        if (!::webView.isInitialized || !webPageReady || isFinishing || isDestroyed) return false
        val currentUri = webView.url?.let(Uri::parse) ?: return false
        return isInternalAppUrl(currentUri)
    }

    /**
     * Async native callbacks may outlive the page that requested them. Deliver only
     * while the current top-level WebView is still on the official, loaded app URL.
     */
    private fun postToTrustedWebPage(
        script: String,
        retryFcmTokenDelivery: Boolean = false
    ) {
        if (!isTrustedWebPageReady()) {
            if (retryFcmTokenDelivery) pendingFcmTokenDelivery = true
            return
        }

        val targetWebView = webView
        targetWebView.post {
            if (targetWebView !== webView || !isTrustedWebPageReady()) {
                if (retryFcmTokenDelivery) pendingFcmTokenDelivery = true
                return@post
            }
            targetWebView.evaluateJavascript(script, null)
            if (retryFcmTokenDelivery) pendingFcmTokenDelivery = false
        }
    }

    private fun dispatchNativeNotificationPermission(granted: Boolean) {
        val script = "window.dispatchEvent(new CustomEvent('editalradar:native-notification-permission'," +
            " {detail:{granted:$granted}}));"
        postToTrustedWebPage(script)
    }

    private fun configureNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Atualizações do EditalRadar",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Avisos sobre concursos novos e atualizações dos favoritos"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun postNativeNotification(title: String, message: String, tag: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }

        val notification = builder
            .setSmallIcon(R.drawable.ic_stat_editalradar)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(Notification.BigTextStyle().bigText(message))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val notificationId = tag.hashCode()
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(notificationId, notification)
    }

    private fun handleAuthIntent(source: Intent?): Boolean {
        val uri = source?.data ?: return false
        if (uri.scheme != "editalradar" || uri.host != "auth-callback") return false

        val code = uri.getQueryParameter("code")
        if (!code.isNullOrBlank()) {
            val callbackUrl = Uri.parse(HOME_URL)
                .buildUpon()
                .appendQueryParameter("code", code)
                .build()
            webView.loadUrl(callbackUrl.toString())
        } else {
            val errorMessage = uri.getQueryParameter("error_description")
                ?: uri.getQueryParameter("error")
                ?: "Não foi possível concluir o acesso com Google."
            val safeMessage = org.json.JSONObject.quote(errorMessage)
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('editalradar:oauth-error',{detail:{message:$safeMessage}}));",
                null
            )
        }
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!handleAuthIntent(intent)) {
            val pushUrl = intent.getStringExtra(EXTRA_PUSH_URL)
            if (!pushUrl.isNullOrBlank() && ::webView.isInitialized) {
                webView.loadUrl(resolvePushUrl(pushUrl))
            }
        }
    }

    private fun resolvePushUrl(value: String): String {
        val target = value.trim()
        if (target.isBlank() || target == "/") return HOME_URL

        val resolved = when {
            target.startsWith("//") -> return HOME_URL
            target == HOME_PATH.trimEnd('/') || target.startsWith(HOME_PATH) ->
                "https://$HOME_HOST$target"
            target.startsWith("/") -> HOME_URL.trimEnd('/') + target
            else -> target
        }

        return try {
            val uri = Uri.parse(resolved)
            if (isInternalAppUrl(uri)) uri.toString() else HOME_URL
        } catch (_: Exception) {
            HOME_URL
        }
    }

    private fun dispatchFcmToken(token: String) {
        val safeToken = org.json.JSONObject.quote(token)
        val script = "window.dispatchEvent(new CustomEvent('editalradar:fcm-token',{detail:{token:$safeToken}}));"
        postToTrustedWebPage(script, retryFcmTokenDelivery = true)
    }

    private fun dispatchFcmStatus(configured: Boolean) {
        val script = "window.dispatchEvent(new CustomEvent('editalradar:fcm-status',{detail:{configured:$configured}}));"
        postToTrustedWebPage(script)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            // FCM may rotate its registration token while the app is backgrounded.
            // Re-dispatch it only after the trusted app page is ready to receive it.
            if (webPageReady) requestFcmToken()
        }
        showPendingInstallFailureIfAny()
    }

    private fun showPendingInstallFailureIfAny() {
        if (isFinishing || isDestroyed) return

        val preferences = getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
        if (!preferences.contains(UpdateInstallReceiver.PENDING_FAILURE_STATUS_KEY)) return

        val status = preferences.getInt(
            UpdateInstallReceiver.PENDING_FAILURE_STATUS_KEY,
            PackageInstaller.STATUS_FAILURE
        )
        val statusMessage = preferences.getString(
            UpdateInstallReceiver.PENDING_FAILURE_MESSAGE_KEY,
            ""
        ).orEmpty()
        val otherPackage = preferences.getString(
            UpdateInstallReceiver.PENDING_FAILURE_OTHER_PACKAGE_KEY,
            ""
        ).orEmpty()

        preferences.edit()
            .remove(UpdateInstallReceiver.PENDING_FAILURE_STATUS_KEY)
            .remove(UpdateInstallReceiver.PENDING_FAILURE_MESSAGE_KEY)
            .remove(UpdateInstallReceiver.PENDING_FAILURE_OTHER_PACKAGE_KEY)
            .apply()

        val versionName = runCatching {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull().orEmpty()
        val statusLabel = when (status) {
            PackageInstaller.STATUS_FAILURE_ABORTED -> "cancelada"
            PackageInstaller.STATUS_FAILURE_BLOCKED -> "bloqueada pelo Android"
            PackageInstaller.STATUS_FAILURE_CONFLICT -> "conflito com a instalação existente"
            PackageInstaller.STATUS_FAILURE_INVALID -> "arquivo rejeitado"
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "incompatibilidade com o aparelho"
            PackageInstaller.STATUS_FAILURE_STORAGE -> "armazenamento insuficiente"
            PackageInstaller.STATUS_FAILURE_TIMEOUT -> "tempo limite excedido"
            else -> "falha não especificada"
        }
        val diagnostic = buildString {
            append("EditalRadar Android ").append(versionName.ifBlank { "versão desconhecida" })
            append("\nCódigo do instalador: ").append(status)
            append("\nMotivo: ").append(statusLabel)
            if (statusMessage.isNotBlank()) append("\nMensagem do Android: ").append(statusMessage)
            if (otherPackage.isNotBlank()) append("\nPacote relacionado: ").append(otherPackage)
        }

        themedAlertDialogBuilder()
            .setTitle("A atualização não foi concluída")
            .setMessage(
                UpdateInstallReceiver.userMessageForStatus(status) +
                    "\n\nSua versão atual e seus dados foram mantidos. " +
                    "Você pode copiar os detalhes para nos ajudar a identificar a causa."
            )
            .setNeutralButton("Copiar detalhes") { _, _ ->
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Diagnóstico da atualização", diagnostic))
                Toast.makeText(this, "Detalhes copiados. Cole-os aqui na conversa.", Toast.LENGTH_LONG).show()
            }
            .setPositiveButton("Fechar", null)
            .show()
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onStart() {
        super.onStart()
        registerNetworkMonitor()
    }

    override fun onStop() {
        unregisterNetworkMonitor()
        super.onStop()
    }

    private fun registerNetworkMonitor() {
        if (networkCallback != null) return
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = runOnUiThread { refreshConnectivity() }
            override fun onLost(network: Network) = runOnUiThread { refreshConnectivity() }
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
                runOnUiThread { refreshConnectivity() }
        }
        try {
            connectivityManager?.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (_: Exception) {
            networkCallback = null
        }
        refreshConnectivity()
    }

    private fun unregisterNetworkMonitor() {
        val callback = networkCallback ?: return
        try {
            connectivityManager?.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
            // O sistema pode já ter removido o callback.
        }
        networkCallback = null
    }

    private fun isInternetAvailable(): Boolean {
        val manager = connectivityManager
            ?: getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun refreshConnectivity() {
        val online = isInternetAvailable()
        val connectionRestored = online && lastKnownOnlineState == false
        lastKnownOnlineState = online

        statusText.text = if (online) {
            if (connectionRestored) "Conexão restabelecida • atualizando…" else "EditalRadar • conectado"
        } else {
            "Sem conexão. Algumas informações já carregadas ainda podem estar disponíveis. Toque para tentar novamente."
        }
        statusText.setTextColor(if (isDarkThemeEnabled) Color.rgb(229, 237, 248) else Color.WHITE)
        statusText.setBackgroundColor(
            if (isDarkThemeEnabled) {
                if (online) Color.rgb(27, 60, 55) else Color.rgb(66, 49, 29)
            } else {
                if (online) Color.rgb(24, 105, 87) else Color.rgb(154, 91, 29)
            }
        )

        if (::webView.isInitialized) {
            webView.settings.cacheMode = if (online) {
                WebSettings.LOAD_DEFAULT
            } else {
                WebSettings.LOAD_CACHE_ELSE_NETWORK
            }

            // Recupera automaticamente a tela que falhou durante uma queda de rede.
            if (connectionRestored) {
                maybeCheckForUpdates()
                webView.post {
                    if (isFinishing || isDestroyed || !isInternetAvailable()) return@post
                    val currentUri = webView.url?.let(Uri::parse)
                    if (currentUri != null && isInternalAppUrl(currentUri)) {
                        webView.reload()
                    } else {
                        webView.loadUrl(HOME_URL)
                    }
                }
            }
        }
    }

    private fun retryCurrentPage() {
        if (!::webView.isInitialized) return
        webView.settings.cacheMode = if (isInternetAvailable()) {
            WebSettings.LOAD_DEFAULT
        } else {
            WebSettings.LOAD_CACHE_ELSE_NETWORK
        }
        val currentUri = webView.url?.let(Uri::parse)
        if (currentUri != null && isInternalAppUrl(currentUri)) {
            webView.reload()
        } else {
            webView.loadUrl(HOME_URL)
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    private fun configureBackNavigation() {
        webViewBackCallback = object : OnBackPressedCallback(false) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    // The callback is enabled only while WebView history exists.
                    // If history changes before dispatch, return control to Android.
                    isEnabled = false
                    finish()
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, webViewBackCallback)
    }

    private fun updateWebViewBackNavigation(canGoBack: Boolean) {
        if (::webViewBackCallback.isInitialized) {
            webViewBackCallback.isEnabled = canGoBack
        }
    }

    override fun onDestroy() {
        if (::appUpdateManager.isInitialized) appUpdateManager.close()
        downloadDialog?.dismiss()
        unregisterNetworkMonitor()
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }
}
