package br.com.editalradar.app

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.SslErrorHandler
import android.net.http.SslError
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : Activity() {
    companion object {
        private const val HOME_URL = "https://dagamavasco170-lang.github.io/editalradar/"
        private const val HOME_HOST = "dagamavasco170-lang.github.io"
        private const val HOME_PATH = "/editalradar/"
        private const val NOTIFICATION_CHANNEL_ID = "editalradar_updates"
        private const val NOTIFICATION_PERMISSION_REQUEST = 8102
        const val EXTRA_PUSH_URL = "br.com.editalradar.app.EXTRA_PUSH_URL"
    }

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var statusText: TextView
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        buildScreen()
        configureNotifications()
        configureWebView()

        val restoredWebState = savedInstanceState != null &&
            webView.restoreState(savedInstanceState) != null

        if (!handleAuthIntent(intent)) {
            val pushUrl = intent?.getStringExtra(EXTRA_PUSH_URL)
            if (!pushUrl.isNullOrBlank()) {
                webView.loadUrl(resolvePushUrl(pushUrl))
            } else if (!restoredWebState) {
                // Não deixa a tela em branco quando o estado anterior não puder ser restaurado.
                webView.loadUrl(HOME_URL)
            }
        }
        refreshConnectivity()
    }

    private fun buildScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }

        statusText = TextView(this).apply {
            text = "EditalRadar • verificando conexão"
            textSize = 13f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(24, 105, 87))
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(8))
            minHeight = dp(38)
            setOnClickListener { webView.reload() }
            contentDescription = "Estado da conexão. Toque para atualizar."
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
        }
        root.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val safeInsets = insets.getInsets(
                    WindowInsets.Type.systemBars() or
                        WindowInsets.Type.displayCutout() or
                        WindowInsets.Type.ime()
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
        root.addView(statusText, LinearLayout.LayoutParams(-1, dp(40)))
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(3)))
        root.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
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

        webView.addJavascriptInterface(NativeBridge(), "EditalRadarNative")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
            }
        }

        webView.webViewClient = object : WebViewClient() {
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
                    statusText.text = "Link bloqueado por segurança. Use links HTTPS."
                }
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: android.webkit.WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true && !isInternetAvailable()) {
                    statusText.text = "Sem internet • tentando abrir dados salvos. Toque para tentar novamente."
                    webView.settings.cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK
                }
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // Nunca permite ignorar certificado inválido ou conexão TLS adulterada.
                handler?.cancel()
                statusText.text = "Conexão segura inválida. O acesso foi bloqueado."
            }
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

    private inner class NativeBridge {
        @JavascriptInterface
        fun isAndroidApp(): Boolean = true

        @JavascriptInterface
        fun requestNotificationPermission(): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                return true
            }
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    requestPermissions(
                        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                        NOTIFICATION_PERMISSION_REQUEST
                    )
                }
            }
            return false
        }

        @JavascriptInterface
        fun showNotification(title: String?, message: String?, tag: String?) {
            runOnUiThread {
                postNativeNotification(
                    title?.take(90)?.ifBlank { "EditalRadar" } ?: "EditalRadar",
                    message?.take(350)?.ifBlank { "Há uma atualização no seu acompanhamento." }
                        ?: "Há uma atualização no seu acompanhamento.",
                    tag ?: System.currentTimeMillis().toString()
                )
            }
        }

        @JavascriptInterface
        fun requestFcmToken() {
            runOnUiThread {
                if (FirebaseApp.getApps(this@MainActivity).isEmpty()) {
                    dispatchFcmStatus(configured = false)
                    return@runOnUiThread
                }
                val cachedToken = getSharedPreferences("editalradar_push", Context.MODE_PRIVATE)
                    .getString("fcm_token", null)
                if (!cachedToken.isNullOrBlank()) dispatchFcmToken(cachedToken)
                try {
                    FirebaseMessaging.getInstance().token
                        .addOnCompleteListener { task ->
                            if (!task.isSuccessful) {
                                dispatchFcmStatus(configured = true)
                                return@addOnCompleteListener
                            }
                            val token = task.result ?: return@addOnCompleteListener
                            getSharedPreferences("editalradar_push", Context.MODE_PRIVATE)
                                .edit().putString("fcm_token", token).apply()
                            dispatchFcmToken(token)
                        }
                } catch (_: Exception) {
                    dispatchFcmStatus(configured = false)
                }
            }
        }
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
        if (::webView.isInitialized) webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun dispatchFcmStatus(configured: Boolean) {
        val script = "window.dispatchEvent(new CustomEvent('editalradar:fcm-status',{detail:{configured:$configured}}));"
        if (::webView.isInitialized) webView.post { webView.evaluateJavascript(script, null) }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
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
        statusText.text = if (online) {
            "EditalRadar • conectado"
        } else {
            "Sem internet • conteúdo em cache quando disponível • toque para tentar novamente"
        }
        statusText.setBackgroundColor(
            if (online) Color.rgb(24, 105, 87) else Color.rgb(154, 91, 29)
        )
        if (::webView.isInitialized) {
            webView.settings.cacheMode = if (online) {
                WebSettings.LOAD_DEFAULT
            } else {
                WebSettings.LOAD_CACHE_ELSE_NETWORK
            }
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            val js = "window.dispatchEvent(new CustomEvent('editalradar:native-notification-permission'," +
                " {detail:{granted:$granted}}));"
            if (::webView.isInitialized) webView.post { webView.evaluateJavascript(js, null) }
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        unregisterNetworkMonitor()
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.removeJavascriptInterface("EditalRadarNative")
            webView.destroy()
        }
        super.onDestroy()
    }
}
