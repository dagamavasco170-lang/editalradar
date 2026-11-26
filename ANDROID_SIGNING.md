# Assinatura permanente do EditalRadar para Android

A assinatura permanente garante que as próximas versões sejam reconhecidas pelo Android como atualizações do mesmo aplicativo. A chave privada fica sob seu controle e nunca deve ser enviada por conversa, commitada no Git ou publicada em releases.

## 1. Criar a chave no seu computador Windows

Instale um JDK (Java 17 ou superior) ou use o JDK já instalado com o Android Studio. Abra o PowerShell em uma pasta particular, fora da pasta do repositório, e execute:

```powershell
keytool -genkeypair -v -keystore editalradar-release.jks -storetype JKS -alias editalradar -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=EditalRadar, OU=Android, O=EditalRadar, C=BR"
```

O programa pedirá uma senha para o arquivo e uma senha para a chave. Escolha senhas longas e exclusivas, guarde-as em um gerenciador de senhas e não as compartilhe. O alias deve ser exatamente `editalradar`.

Não coloque o arquivo `editalradar-release.jks` no repositório, em e-mail ou em serviços públicos.

## 2. Guardar duas cópias de segurança

Faça pelo menos duas cópias da chave em locais seguros e independentes, preferencialmente criptografados e sob seu controle. Guarde também as duas senhas e o alias. **Se a chave privada for perdida, não será possível assinar atualizações compatíveis com os aplicativos que já tenham sido instalados com essa chave.** Não gere uma nova chave para substituir esta.

## 3. Converter a chave para cadastrar no GitHub

No PowerShell, ainda na pasta em que criou o arquivo, execute:

```powershell
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\editalradar-release.jks"))
Set-Clipboard -Value $base64
```

Isso copia o conteúdo codificado para a área de transferência. Não salve nem compartilhe esse texto em arquivos públicos.

## 4. Cadastrar os quatro segredos no GitHub

Abra o repositório EditalRadar e entre em **Settings → Secrets and variables → Actions → New repository secret**. Cadastre os quatro itens abaixo, um por vez:

| Nome do segredo | Valor |
|---|---|
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Conteúdo copiado no passo 3 |
| `ANDROID_RELEASE_STORE_PASSWORD` | Senha do arquivo JKS |
| `ANDROID_RELEASE_KEY_ALIAS` | `editalradar` |
| `ANDROID_RELEASE_KEY_PASSWORD` | Senha da chave |

Não crie variáveis públicas para esses dados; use exclusivamente **Repository secrets**. Não envie nenhum desses valores nesta conversa.

## 5. Validar e publicar

Depois de cadastrar os quatro segredos, abra **Actions → Build and publish EditalRadar Android release → Run workflow** e execute na branch `main`. O processo valida se a chave e o alias correspondem, compila o APK/AAB de versão e só publica a versão quando ela estiver assinada corretamente.

Enquanto a chave não estiver configurada, o GitHub Actions fará apenas uma compilação de verificação e não publicará APK de atualização. Os arquivos de verificação não devem ser instalados nem distribuídos.

## Observação sobre a versão já instalada

As versões antigas distribuídas pelo fluxo de compilação de depuração foram assinadas com uma chave temporária do ambiente de compilação. A nova chave permanente não corresponde a essa assinatura. Por isso, o Android pode exigir uma instalação inicial limpa ao migrar para a primeira versão assinada permanentemente. Antes dessa migração, confirme que seus dados estão sincronizados na sua conta EditalRadar; informações mantidas somente no aparelho podem ser perdidas ao desinstalar. Depois dessa primeira instalação permanente, as próximas atualizações poderão ser instaladas sobre a versão existente sem desinstalar o aplicativo.
