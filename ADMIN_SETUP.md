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
- Não coloque `service_role` no site, no GitHub ou em variáveis `VITE_`.
- O formulário exige link oficial HTTPS.
- O catálogo original do repositório é mantido; edições e remoções são sobreposições no banco.
