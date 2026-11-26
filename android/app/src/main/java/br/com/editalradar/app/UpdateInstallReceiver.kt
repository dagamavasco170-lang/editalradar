package br.com.editalradar.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import android.widget.Toast

class UpdateInstallReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_INSTALL_STATUS = "br.com.editalradar.app.ACTION_INSTALL_STATUS"
        const val UPDATE_PREFERENCES = "editalradar_app_updates"
        const val PENDING_FAILURE_STATUS_KEY = "pending_install_failure_status"
        const val PENDING_FAILURE_MESSAGE_KEY = "pending_install_failure_message"
        const val PENDING_FAILURE_OTHER_PACKAGE_KEY = "pending_install_failure_other_package"

        fun userMessageForStatus(status: Int): String = when (status) {
            PackageInstaller.STATUS_FAILURE_ABORTED ->
                "A instalação foi cancelada antes de terminar. Tente novamente e confirme todas as etapas."
            PackageInstaller.STATUS_FAILURE_BLOCKED ->
                "O Android bloqueou a instalação. Confira as permissões de instalação e as opções de segurança do aparelho."
            PackageInstaller.STATUS_FAILURE_CONFLICT ->
                "O Android encontrou um conflito com a versão instalada. Não desinstale o aplicativo; copie os detalhes para identificarmos a causa."
            PackageInstaller.STATUS_FAILURE_INVALID ->
                "O Android não reconheceu o arquivo de atualização. Baixe novamente pelo EditalRadar e tente mais uma vez."
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                "Esta atualização não parece ser compatível com o aparelho. Sua versão atual continua disponível."
            PackageInstaller.STATUS_FAILURE_STORAGE ->
                "Não há espaço suficiente para concluir a atualização. Libere espaço e tente novamente."
            PackageInstaller.STATUS_FAILURE_TIMEOUT ->
                "O Android demorou demais para concluir a atualização. Tente novamente."
            else ->
                "O Android não conseguiu concluir a atualização. Sua versão atual continua instalada."
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_INSTALL_STATUS) return

        val installStatus = intent.getIntExtra(
            PackageInstaller.EXTRA_STATUS,
            PackageInstaller.STATUS_FAILURE
        )
        when (installStatus) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirmationIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }

                if (confirmationIntent != null) {
                    confirmationIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        context.startActivity(confirmationIntent)
                    } catch (_: Exception) {
                        Toast.makeText(
                            context,
                            "Abra o EditalRadar para concluir a atualização.",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }

            PackageInstaller.STATUS_SUCCESS -> {
                context.getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
                    .edit()
                    .remove(PENDING_FAILURE_STATUS_KEY)
                    .remove(PENDING_FAILURE_MESSAGE_KEY)
                    .remove(PENDING_FAILURE_OTHER_PACKAGE_KEY)
                    .apply()
                Toast.makeText(
                    context,
                    "EditalRadar atualizado com sucesso.",
                    Toast.LENGTH_LONG
                ).show()
            }

            else -> {
                val statusMessage = intent
                    .getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                    .orEmpty()
                    .replace(Regex("[\\r\\n\\t]+"), " ")
                    .trim()
                    .take(500)
                val otherPackage = intent
                    .getStringExtra(PackageInstaller.EXTRA_OTHER_PACKAGE_NAME)
                    .orEmpty()
                    .take(200)

                context.getSharedPreferences(UPDATE_PREFERENCES, Context.MODE_PRIVATE)
                    .edit()
                    .putInt(PENDING_FAILURE_STATUS_KEY, installStatus)
                    .putString(PENDING_FAILURE_MESSAGE_KEY, statusMessage)
                    .putString(PENDING_FAILURE_OTHER_PACKAGE_KEY, otherPackage)
                    .apply()

                Log.w(
                    "EditalRadarInstaller",
                    "Install failed: status=$installStatus; statusMessage=$statusMessage; otherPackage=$otherPackage"
                )
                Toast.makeText(
                    context,
                    userMessageForStatus(installStatus),
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }
}
