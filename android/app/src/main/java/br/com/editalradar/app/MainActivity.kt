package br.com.editalradar.app

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

class MainActivity : Activity() {
    companion object {
        private const val HOME_URL = "https://editalradar-gamma.vercel.app/"
        private const val HOME_HOST = "editalradar-gamma.vercel.app"
        private const val NOTIFICATION_CHANNEL_ID = "editalradar_updates"
        private const val NOTIFICATION_PERMISSION_REQUEST = 8102
    }

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var statusText: TextView
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        configureNotifications()
        configureWebView()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        }

        if (!handleAuthIntent(intent) && savedInstanceState == null) {
            webView.loadUrl(HOME_URL)
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
        }

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }

        webView = WebView(this)
        root.addView(statusText, LinearLayout.LayoutParams(-1, dp(40)))
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(3)))
        root.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            loadsImagesAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
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
                if (uri.scheme == "editalradar") {
                    handleAuthIntent(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }

                val host = uri.host?.lowercase() ?: return true
                if (uri.scheme != "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) {
                        // Não há aplicativo externo compatível com este link.
                    }
                    return true
                }

                if (host == HOME_HOST) return false

                // OAuth and external documents use the system browser, avoiding embedded Google login.
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (_: Exception) {
                    statusText.text = "Não foi possível abrir o link externo."
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
        }
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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(Notification.BigTextStyle().bigText(message))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val notificationId = tag.hashCode()
        getSystemService(Context.NOTIFICATION_SERVICE, NotificationManager::class.java)
            .notify(notificationId, notification)
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
        handleAuthIntent(intent)
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
