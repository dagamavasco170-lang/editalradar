# Configurar alertas por e-mail no EditalRadar

O recurso envia um resumo quando fichas do catálogo são adicionadas ou alteradas. O envio é opt-in: a preferência começa desligada e só contas com e-mail confirmado e consentimento explícito recebem mensagens.

## 1. Criar e verificar o remetente no Resend

1. Crie uma conta em https://resend.com/.
2. Cadastre e verifique um domínio seu em https://resend.com/domains/.
3. Crie uma API key em https://resend.com/api-keys/.
4. Escolha um remetente no domínio verificado, por exemplo EditalRadar <alertas@SEU-DOMINIO>. Não use esse exemplo literalmente.

O Resend requer API key e domínio verificado para o envio de produção. Consulte também: https://supabase.com/docs/guides/functions/examples/send-emails.

## 2. Configurar secrets na Supabase

Abra o projeto xrdtqbatynoofkjtjgeq no Dashboard da Supabase e acesse Edge Functions → Secrets:
https://supabase.com/dashboard/project/xrdtqbatynoofkjtjgeq/functions

Cadastre estes secrets (não coloque seus valores no GitHub nem no código):
- RESEND_API_KEY: API key criada no Resend.
- EMAIL_FROM: remetente no domínio verificado.
- MONITOR_API_TOKEN: token aleatório e exclusivo compartilhado com o GitHub Actions.
- APP_URL: https://editalradar-gamma.vercel.app/ (opcional).

Para criar um token forte no seu computador, execute:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Use o mesmo valor no secret MONITOR_API_TOKEN da Supabase e no GitHub. Nunca publique ou envie esse token em mensagens.

## 3. Configurar o GitHub Actions

Abra:
https://github.com/dagamavasco170-lang/editalradar/settings/secrets/actions

Crie um Repository secret chamado MONITOR_API_TOKEN, com o mesmo token gerado no passo anterior.

O workflow Enviar alertas de novos concursos roda quando src/data/concursos.js muda. Ele calcula as fichas novas/alteradas e chama a Edge Function. Se o secret do GitHub estiver ausente, o workflow registra que o envio foi ignorado.

## 4. Publicar a Edge Function

No seu computador, com a CLI Supabase instalada e autenticada:
supabase login
supabase link --project-ref xrdtqbatynoofkjtjgeq
supabase functions deploy send-contest-email-alerts

O arquivo supabase/config.toml desativa a validação JWT do gateway para essa função; o handler exige o token privado MONITOR_API_TOKEN em todas as chamadas. A função usa a chave secreta do projeto apenas no ambiente Supabase para consultar usuários e registrar idempotência. Nunca exponha a chave secreta do Supabase no navegador.

## 5. Ativar no perfil

Depois de publicar a função e configurar os secrets, cada usuário deve entrar no EditalRadar, abrir Editar perfil, marcar Receber alertas por e-mail e salvar. A preferência vem desligada por padrão e pode ser desativada no mesmo local.

Somente usuários com e-mail confirmado, consentimento ativo e concurso com compatibilidade mínima recebem a mensagem. A função envia no máximo 100 e-mails por execução e evita repetir o mesmo digest para a mesma conta.

## 6. Teste

1. Faça primeiro um commit de teste alterando uma ficha em src/data/concursos.js (por exemplo, atualize uma observação/status apenas após conferir a fonte).
2. Abra a execução em https://github.com/dagamavasco170-lang/editalradar/actions/workflows/notify-email-alerts.yml.
3. Confira o resultado e os logs da função no Dashboard Supabase.
4. Use uma conta de teste com e-mail confirmado, perfil preenchido e consentimento ativo.

O monitor não inventa nem atualiza automaticamente vagas, datas ou etapas. As notificações só refletem mudanças já registradas no catálogo e revisadas antes do commit.
