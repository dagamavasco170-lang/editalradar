package br.com.editalradar.app

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

internal data class AppUpdateRelease(
    val versionName: String,
    val versionCode: Long,
    val releaseNotes: String,
    val apkName: String,
    val apkUrl: String,
    val checksumUrl: String
)

internal class AppUpdateManager(context: Context) {
    companion object {
        private const val API_URL =
            "https://api.github.com/repos/dagamavasco170-lang/editalradar/releases/latest"
        private const val RELEASE_ASSET_PREFIX =
            "https://github.com/dagamavasco170-lang/editalradar/releases/download/"
        private const val MAX_APK_BYTES = 80L * 1024L * 1024L
        private const val MAX_CHECKSUM_BYTES = 32L * 1024L
        private val REDIRECT_HOSTS = setOf(
            "github.com",
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
            "github-releases.githubusercontent.com"
        )
    }

    private val appContext = context.applicationContext
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val busy = AtomicBoolean(false)

    fun checkForUpdate(onComplete: (Result<AppUpdateRelease?>) -> Unit) {
        if (!busy.compareAndSet(false, true)) {
            mainHandler.post {
                onComplete(Result.failure(IllegalStateException("Uma verificação já está em andamento.")))
            }
            return
        }

        worker.execute {
            val result = runCatching { findAvailableRelease() }
            busy.set(false)
            mainHandler.post { onComplete(result) }
        }
    }

    fun downloadAndVerify(
        release: AppUpdateRelease,
        onProgress: (Int) -> Unit,
        onComplete: (Result<File>) -> Unit
    ) {
        if (!busy.compareAndSet(false, true)) {
            mainHandler.post {
                onComplete(Result.failure(IllegalStateException("Um download já está em andamento.")))
            }
            return
        }

        worker.execute {
            val result = runCatching { downloadReleaseApk(release, onProgress) }
            busy.set(false)
            mainHandler.post { onComplete(result) }
        }
    }

    private fun findAvailableRelease(): AppUpdateRelease? {
        val connection = (URL(API_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 20_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            setRequestProperty("User-Agent", "EditalRadar-Android-Updater")
        }

        val payload = try {
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                throw IllegalStateException("Não foi possível consultar as atualizações.")
            }
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }

        val releaseJson = JSONObject(payload)
        if (releaseJson.optBoolean("draft", true) || releaseJson.optBoolean("prerelease", true)) {
            return null
        }

        val tag = releaseJson.optString("tag_name")
        val versionMatch = Regex("^android-v(\\d+\\.\\d+\\.\\d+)$").matchEntire(tag)
            ?: return null
        val versionName = versionMatch.groupValues[1]

        val body = releaseJson.optString("body")
        val versionCode = Regex("(?im)^\\s*[-*]\\s*Versão\\s+(\\d+)\\.?\\s*$")
            .find(body)?.groupValues?.get(1)?.toLongOrNull()
            ?: return null

        if (versionCode <= installedVersionCode()) return null

        val apkName = "EditalRadar-Android-v$versionName.apk"
        val assets = releaseJson.optJSONArray("assets") ?: return null
        var apkUrl: String? = null
        var checksumUrl: String? = null

        for (index in 0 until assets.length()) {
            val asset = assets.optJSONObject(index) ?: continue
            when (asset.optString("name")) {
                apkName -> apkUrl = asset.optString("browser_download_url")
                "SHA256SUMS.txt" -> checksumUrl = asset.optString("browser_download_url")
            }
        }

        val expectedPrefix = "$RELEASE_ASSET_PREFIX$tag/"
        val verifiedApkUrl = apkUrl?.takeIf {
            it == expectedPrefix + apkName && isOfficialReleaseAssetUrl(it)
        } ?: return null
        val verifiedChecksumUrl = checksumUrl?.takeIf {
            it == expectedPrefix + "SHA256SUMS.txt" && isOfficialReleaseAssetUrl(it)
        } ?: return null

        val notes = body
            .lineSequence()
            .filterNot { it.startsWith("# ") || it.trim().startsWith("- Versão ") }
            .joinToString("\n")
            .trim()
            .take(1_800)

        return AppUpdateRelease(
            versionName = versionName,
            versionCode = versionCode,
            releaseNotes = notes,
            apkName = apkName,
            apkUrl = verifiedApkUrl,
            checksumUrl = verifiedChecksumUrl
        )
    }

    private fun downloadReleaseApk(
        release: AppUpdateRelease,
        onProgress: (Int) -> Unit
    ): File {
        val checksumConnection = openReleaseAssetConnection(release.checksumUrl)
        val checksumText = try {
            readBoundedText(checksumConnection, MAX_CHECKSUM_BYTES)
        } finally {
            checksumConnection.disconnect()
        }

        val checksumPattern = Regex(
            "^([a-fA-F0-9]{64})\\s+\\*?" + Regex.escape(release.apkName) + "$"
        )
        val expectedHash = checksumText.lineSequence()
            .mapNotNull { checksumPattern.matchEntire(it.trim())?.groupValues?.get(1) }
            .firstOrNull()
            ?.lowercase()
            ?: throw IllegalStateException("Não foi possível validar a atualização.")

        val connection = openReleaseAssetConnection(release.apkUrl)
        val directory = File(appContext.filesDir, "updates")
        if (!directory.exists() && !directory.mkdirs()) {
            connection.disconnect()
            throw IllegalStateException("Não foi possível preparar o download.")
        }

        val temporaryFile = File(directory, "${release.apkName}.part")
        val completedFile = File(directory, release.apkName)
        temporaryFile.delete()

        try {
            val declaredLength = connection.contentLengthLong
            if (declaredLength > MAX_APK_BYTES) {
                throw IllegalStateException("O arquivo de atualização ultrapassa o tamanho permitido.")
            }

            val digest = MessageDigest.getInstance("SHA-256")
            var downloaded = 0L
            connection.inputStream.use { input ->
                FileOutputStream(temporaryFile).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        downloaded += count
                        if (downloaded > MAX_APK_BYTES) {
                            throw IllegalStateException("O arquivo de atualização é muito grande.")
                        }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)

                        val percentage = if (declaredLength > 0L) {
                            ((downloaded * 100L) / declaredLength).toInt().coerceIn(0, 100)
                        } else {
                            -1
                        }
                        mainHandler.post { onProgress(percentage) }
                    }
                    output.flush()
                    output.fd.sync()
                }
            }

            if (downloaded <= 0L || (declaredLength > 0L && downloaded != declaredLength)) {
                throw IllegalStateException("O download não foi concluído corretamente.")
            }

            val actualHash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
            if (!MessageDigest.isEqual(
                    actualHash.toByteArray(Charsets.US_ASCII),
                    expectedHash.toByteArray(Charsets.US_ASCII)
                )
            ) {
                throw SecurityException("A verificação de segurança da atualização falhou.")
            }

            completedFile.delete()
            if (!temporaryFile.renameTo(completedFile)) {
                temporaryFile.copyTo(completedFile, overwrite = true)
                temporaryFile.delete()
            }
            mainHandler.post { onProgress(100) }
            return completedFile
        } catch (error: Exception) {
            temporaryFile.delete()
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun openReleaseAssetConnection(assetUrl: String): HttpURLConnection {
        if (!isOfficialReleaseAssetUrl(assetUrl)) {
            throw SecurityException("Endereço de atualização não permitido.")
        }

        var currentUrl = URL(assetUrl)
        repeat(6) {
            if (currentUrl.protocol != "https" ||
                currentUrl.host.lowercase() !in REDIRECT_HOSTS ||
                (currentUrl.port != -1 && currentUrl.port != 443)
            ) {
                throw SecurityException("O endereço de download não é seguro.")
            }

            val connection = (currentUrl.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 20_000
                readTimeout = 30_000
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/octet-stream")
                setRequestProperty("User-Agent", "EditalRadar-Android-Updater")
            }

            val responseCode = connection.responseCode
            if (responseCode == HttpURLConnection.HTTP_OK) return connection

            if (responseCode in 300..399) {
                val location = connection.getHeaderField("Location")
                    ?: run {
                        connection.disconnect()
                        throw IllegalStateException("O servidor não forneceu o arquivo de atualização.")
                    }
                val redirectedUrl = URL(currentUrl, location)
                connection.disconnect()
                if (redirectedUrl.protocol != "https" ||
                    redirectedUrl.host.lowercase() !in REDIRECT_HOSTS ||
                    (redirectedUrl.port != -1 && redirectedUrl.port != 443)
                ) {
                    throw SecurityException("O download foi direcionado para um endereço não permitido.")
                }
                currentUrl = redirectedUrl
            } else {
                connection.disconnect()
                throw IllegalStateException("Não foi possível baixar a atualização.")
            }
        }

        throw IllegalStateException("O servidor demorou demais para disponibilizar a atualização.")
    }

    private fun readBoundedText(connection: HttpURLConnection, maxBytes: Long): String {
        val declaredLength = connection.contentLengthLong
        if (declaredLength > maxBytes) {
            throw IllegalStateException("A resposta de atualização é inválida.")
        }

        val output = ByteArrayOutputStream()
        connection.inputStream.use { input ->
            val buffer = ByteArray(4 * 1024)
            var total = 0L
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > maxBytes) {
                    throw IllegalStateException("A resposta de atualização é muito grande.")
                }
                output.write(buffer, 0, count)
            }
        }
        return output.toString(Charsets.UTF_8.name())
    }

    private fun isOfficialReleaseAssetUrl(value: String): Boolean {
        return value.startsWith(RELEASE_ASSET_PREFIX) &&
            runCatching {
                val parsed = URL(value)
                parsed.protocol == "https" &&
                    parsed.host.equals("github.com", ignoreCase = true) &&
                    parsed.userInfo == null &&
                    (parsed.port == -1 || parsed.port == 443)
            }.getOrDefault(false)
    }

    @Suppress("DEPRECATION")
    private fun installedVersionCode(): Long {
        val packageInfo = appContext.packageManager.getPackageInfo(appContext.packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            packageInfo.versionCode.toLong()
        }
    }

    /**
     * Verifies that the downloaded archive is the expected EditalRadar package and
     * is a genuine upgrade. The Android PackageInstaller remains the authority for
     * signing-certificate compatibility when the installation is committed.
     *
     * This deliberately does not compare PackageInfo.signingInfo from an archive
     * with the installed PackageInfo: some device/package-manager combinations
     * return incomplete archive signing metadata, which can reject a correctly
     * signed update before Android's own installer can validate it.
     */
    fun isValidUpdatePackage(
        apkFile: File,
        expectedRelease: AppUpdateRelease? = null
    ): Boolean {
        if (!apkFile.isFile || apkFile.length() <= 0L) return false

        return try {
            val candidateInfo = appContext.packageManager.getPackageArchiveInfo(
                apkFile.absolutePath,
                0
            ) ?: return false

            if (candidateInfo.packageName != appContext.packageName) return false

            val candidateVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                candidateInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                candidateInfo.versionCode.toLong()
            }

            if (candidateVersionCode <= installedVersionCode()) return false

            if (expectedRelease != null && (
                candidateVersionCode != expectedRelease.versionCode ||
                    candidateInfo.versionName != expectedRelease.versionName
                )
            ) return false

            true
        } catch (_: Exception) {
            false
        }
    }

    fun close() {
        worker.shutdownNow()
    }
}
