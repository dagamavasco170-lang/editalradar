# EditalRadar Android

Aplicativo Android com interface do EditalRadar e recursos nativos em Kotlin.

## O que esta versão oferece

- Barra superior nativa com altura adaptável à escala de fonte do sistema, sem cortar textos longos; controles mantêm alvos de toque confortáveis.
- Progresso do atualizador limitado a mudanças reais de percentual, deixando downloads grandes mais suaves e evitando sobrecarregar a fila da interface.

- Interface do produto existente, com favoritos, conta, histórico e catálogo sincronizado pelo Supabase.
- Modo claro/escuro com alternância na barra superior; a escolha é salva no navegador e no armazenamento nativo, aplica as cores às barras do sistema e mantém diálogos Android coerentes com o tema.
- Cache do app configurado antes da primeira navegação, para favorecer a abertura com conteúdo já carregado mesmo quando o Android reinicia o processo sem conexão.
- Controles nativos com alvos de toque de pelo menos 48 dp, facilitando o uso em celulares e com recursos de acessibilidade.
- Recuperação automática da tela quando o Android encerra o processo interno da WebView; a aplicação recria a visualização e retorna à página inicial sem apagar a sessão salva.
- Gesto de voltar integrado ao AndroidX: volta pelo histórico da WebView e deixa o Android fechar o app quando não há página anterior.
- Compatibilidade preparada para Android 16 (API 36), incluindo áreas seguras de tela e navegação preditiva.
- O frontend é transpilado para Chrome 70, evitando sintaxe JavaScript que WebViews antigas do Android 10 não conseguem interpretar; o teste em emulador confirma que o catálogo React aparece antes de aprovar uma atualização.
- Indicador nativo de conexão; toque nele para tentar atualizar a página.
- Canal de notificações Android. Quando o app detectar novos concursos ou mudanças em favoritos durante uma sincronização, poderá exibir avisos do sistema.
- Retorno OAuth via esquema `editalradar://auth-callback`, mantendo a verificação PKCE no WebView.

## Configuração obrigatória para login com Google no Android

No Supabase, abra **Authentication → URL Configuration → Redirect URLs** e adicione exatamente:

`editalradar://auth-callback`

O provedor Google deve continuar configurado para usar a URL de callback do Supabase:

`https://xrdtqbatynoofkjtjgeq.supabase.co/auth/v1/callback`

Sem a inclusão da URL personalizada na lista de redirecionamentos do Supabase, o login Google no APK não será concluído. Login por e-mail e senha continua usando o fluxo web.

## Firebase Cloud Messaging (push em segundo plano)

O aplicativo já inclui o serviço Android para receber mensagens FCM mesmo quando a interface está em segundo plano ou fechada. A ativação depende de credenciais do projeto Firebase e é feita sem colocar chaves privadas no APK ou no navegador.

1. No Firebase Console, crie ou selecione um projeto e adicione um app Android com o identificador exato `br.com.editalradar.app`.
2. Baixe o arquivo `google-services.json` desse app.
3. Converta o arquivo para Base64 e cadastre o resultado no GitHub, em **Settings → Secrets and variables → Actions**, com o nome `GOOGLE_SERVICES_JSON_BASE64`. O workflow valida o identificador antes de compilar.
4. No Google Cloud associado ao Firebase, habilite a Firebase Cloud Messaging API e crie uma chave de conta de serviço com permissão para enviar mensagens FCM.
5. Cadastre o JSON completo da conta de serviço no Supabase, em **Edge Functions → Secrets**, com o nome `FCM_SERVICE_ACCOUNT_JSON`.
6. Faça login no app Android, entre na área de notificações e toque em **Ativar notificações**. O token será vinculado à conta autenticada.

Quando o aplicativo volta ao primeiro plano, ele consulta novamente o token FCM e o envia à página somente depois que a WebView oficial terminou de carregar. Isso ajuda a manter o dispositivo registrado quando o Firebase renova o token enquanto o app está em segundo plano. Os retornos assíncronos do Android também são descartados quando a página muda ou deixa de ser a origem oficial; se a entrega do token for interrompida durante o carregamento, o aplicativo tenta novamente quando a página confiável termina de abrir.

Quando um administrador cadastrar ou atualizar um concurso, a função protegida `push-notifications` enviará o aviso aos aparelhos Android que autorizaram notificações. Tokens inválidos são removidos automaticamente. O limite atual de envio por chamada é de 1.000 dispositivos.

**Importante:** sem os dois secrets acima, o app continua compilando e funcionando normalmente, mas o push remoto fica desativado. O JSON da conta de serviço deve permanecer apenas no Supabase; nunca o envie ao GitHub nem ao aplicativo.

## Limite das notificações locais

Os avisos locais existentes continuam funcionando quando o aplicativo está aberto e sincroniza novidades. Para notificações com o app fechado, é necessário concluir a configuração do Firebase descrita acima.

## Pacotes publicados

- **Versão em validação: 1.3.13 (versionCode 26).** O tag da próxima versão será `android-v1.3.13`. A publicação depende da aprovação do build assinado, da atualização sobre a versão anterior e da abertura do catálogo no emulador Android 10. Esta versão encaminha falhas nativas da WebView para o sistema de diagnóstico centralizado, para que erros de renderização, TLS, HTTP e carregamento possam ser analisados.
- O APK é o pacote para instalação direta. O AAB fica disponível para uma eventual distribuição pela Play Store; a publicação na loja não é automática.
- Builds debug são usados somente para verificação de CI quando a assinatura de produção não está disponível e não substituem a versão estável.

## Integridade das atualizações e distribuição

- O atualizador consulta somente a release estável oficial do GitHub e limita o tamanho da resposta de metadados.
- O APK precisa corresponder ao identificador do aplicativo, à versão e ao tamanho publicados pela release; o download também é conferido pelo SHA-256 de `SHA256SUMS.txt`.
- A instalação definitiva é entregue ao `PackageInstaller` do Android, que valida a compatibilidade da assinatura com o aplicativo instalado.
- Antes de publicar uma versão, o CI verifica APK e AAB, confere o certificado permanente do EditalRadar e valida o identificador do pacote, `versionCode`, `versionName`, `minSdk` e `targetSdk` do APK.
- A chave privada de distribuição permanece nos secrets do GitHub Actions; o fingerprint público do certificado é fixado nos testes de publicação para impedir uma troca acidental da identidade de assinatura.

## Compatibilidade com Android 16

- O app compila com `compileSdk 36` e `targetSdk 36`, mantendo `minSdk 24` para continuar atendendo aparelhos a partir do Android 7.
- As APIs Activity Result usam AndroidX Activity 1.13.0 e Fragment 1.9.1 para manter compatibilidade verificada pelo Lint.
- A navegação usa o `OnBackPressedDispatcher` do AndroidX e habilita o callback de retorno do sistema. O histórico da WebView só intercepta o gesto enquanto há uma página anterior; na página inicial, o Android executa a ação normal de voltar.
- A tela aplica os insets das barras do sistema e do recorte da tela para evitar que controles fiquem escondidos sob a barra de status ou navegação.

## Compilação

Com JDK 17, Android SDK 36, Android Gradle Plugin 8.9.1 e Gradle 8.11.1:

```sh
cd android
gradle assembleDebug bundleDebug --no-daemon
```

Saídas:
- `app/build/outputs/apk/debug/app-debug.apk`
- `app/build/outputs/bundle/debug/app-debug.aab`

Para cada versão Android, incremente `versionCode` e `versionName` em `app/build.gradle`. O workflow publica automaticamente uma GitHub Release com o tag `android-v<versionName>`.
