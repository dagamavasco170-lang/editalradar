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

## Limite das notificações nesta versão

As notificações são nativas e locais: o app as dispara quando está aberto e consegue sincronizar/detectar uma novidade. Push remoto em segundo plano, com o app fechado, exige Firebase Cloud Messaging e credenciais de um projeto Firebase; isso não está ativado nesta versão.

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
