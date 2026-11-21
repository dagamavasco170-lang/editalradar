# Configurar o administrador do EditalRadar

O painel usa o campo protegido `app_metadata.role` do Supabase. Não use `user_metadata`: o próprio usuário pode editar esse campo.

## 1. Criar a tabela e proteger as operações

No SQL Editor do Supabase, execute integralmente `supabase/migrations/202611220002_admin_catalog.sql`.

A leitura é pública. Inserção, edição e exclusão são permitidas somente para tokens autenticados com `app_metadata.role = admin`, fiscalizado pelas políticas RLS do banco.

## 2. Conceder acesso à sua conta

Substitua o endereço pelo e-mail exato usado no login Google e execute:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'admin')
where lower(email) = lower('SEU_EMAIL_GOOGLE');
```

Confirme que uma linha foi atualizada. Depois, saia e entre novamente no EditalRadar para receber um token atualizado.

## 3. Revogar o acesso

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'role'
where lower(email) = lower('SEU_EMAIL_GOOGLE');
```

A pessoa deve entrar novamente para que o token reflita a mudança.

## Cuidados

- Conceda o papel somente a pessoas de confiança.
- Nunca coloque `service_role` no frontend, em variáveis `VITE_`, no código ou em arquivos do repositório. Para o monitor automático, use-a somente como **GitHub Actions secret** `SUPABASE_SERVICE_ROLE_KEY`.
- O formulário exige link oficial HTTPS.
- O catálogo original do repositório é mantido; edições e remoções são sobreposições no banco.

## 4. Ativar a fila automática de revisão

1. No SQL Editor do Supabase, execute integralmente `supabase/migrations/202611220003_contest_discoveries.sql`, depois da migração `202611220002_admin_catalog.sql`.
2. Em seguida, execute `supabase/migrations/202611220004_auto_publish.sql` para conceder ao robô do GitHub Actions permissão de inserir fichas no catálogo.
3. No GitHub, abra o repositório → **Settings → Secrets and variables → Actions → New repository secret**.
4. Crie o secret `SUPABASE_URL` com a URL do projeto Supabase.
5. Crie o secret `SUPABASE_SERVICE_ROLE_KEY` com a chave **service_role/secret** do projeto (Project Settings → API Keys). Não a compartilhe nem a coloque no frontend.
6. No repositório, abra **Actions → Monitorar fontes de concursos → Run workflow** para executar a verificação manual.

O monitor acompanha páginas oficiais cadastradas no catálogo, identifica novos links e verifica automaticamente o conteúdo das páginas. Quando encontra evidências suficientes de edital de concurso/processo seletivo, órgão, cargo e esfera/estado, cria a ficha no catálogo e encerra a descoberta como publicada. Links claramente alheios a concursos são descartados automaticamente. Páginas ambíguas, PDFs digitalizados como imagem e documentos cujos dados não possam ser extraídos com segurança permanecem na fila do painel Administração para revisão. PDFs pesquisáveis são lidos automaticamente pelo monitor. O robô não inventa vagas, escolaridade ou datas: campos ausentes ficam marcados como a confirmar ou o item aguarda revisão.

Se houver descobertas e os dois secrets ainda não estiverem configurados, a etapa de envio falha intencionalmente e o workflow não salva a nova linha de base. Assim, as descobertas são detectadas novamente quando você cadastrar as credenciais e executar o workflow outra vez.
