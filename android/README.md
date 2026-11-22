# EditalRadar Android

Aplicativo Android com interface do EditalRadar e recursos nativos em Kotlin.

## O que esta versão oferece

- Interface do produto existente, com favoritos, conta, histórico e catálogo sincronizado pelo Supabase.
- Cache do app para acesso ao conteúdo já carregado quando estiver sem internet.
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

Quando um administrador cadastrar ou atualizar um concurso, a função protegida `push-notifications` enviará o aviso aos aparelhos Android que autorizaram notificações. Tokens inválidos são removidos automaticamente. O limite atual de envio por chamada é de 1.000 dispositivos.

**Importante:** sem os dois secrets acima, o app continua compilando e funcionando normalmente, mas o push remoto fica desativado. O JSON da conta de serviço deve permanecer apenas no Supabase; nunca o envie ao GitHub nem ao aplicativo.

## Limite das notificações locais

Os avisos locais existentes continuam funcionando quando o aplicativo está aberto e sincroniza novidades. Para notificações com o app fechado, é necessário concluir a configuração do Firebase descrita acima.

## Pacotes publicados

- APK debug assinado para instalação direta em aparelhos Android.
- AAB debug para testes e distribuição interna. O AAB ainda não é uma versão de produção assinada com chave de upload da Play Store.

## Compilação

Com JDK 17, Android SDK e Gradle 8.10.2:

```sh
cd android
gradle assembleDebug bundleDebug --no-daemon
```

Saídas:
- `app/build/outputs/apk/debug/app-debug.apk`
- `app/build/outputs/bundle/debug/app-debug.aab`

Para cada versão Android, incremente `versionCode` e `versionName` em `app/build.gradle`. O workflow publica automaticamente uma GitHub Release com o tag `android-v<versionName>`.
