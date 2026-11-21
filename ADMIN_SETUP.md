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
2. No GitHub, abra o repositório → **Settings → Secrets and variables → Actions → New repository secret**.
3. Crie o secret `SUPABASE_URL` com a URL do projeto Supabase.
4. Crie o secret `SUPABASE_SERVICE_ROLE_KEY` com a chave **service_role/secret** do projeto (Project Settings → API Keys). Não a compartilhe nem a coloque no frontend.
5. No repositório, abra **Actions → Monitorar fontes de concursos → Run workflow** para executar a verificação manual.

O monitor acompanha páginas oficiais cadastradas no catálogo, identifica novos links com termos relacionados a editais/concursos e registra mudanças de conteúdo como itens pendentes. A fila aparece aqui no painel Administração. A primeira execução com o filtro novo semeia a fila com links relevantes já existentes. Quando uma página oficial não expõe links específicos que o detector consiga identificar, a própria página entra na fila como fonte para verificação inicial — isso não representa um concurso confirmado. Depois, novos links e páginas alteradas serão sinalizados. O sistema não interpreta automaticamente o conteúdo de PDFs nem publica fichas: o administrador precisa abrir o link, conferir órgão, cargo, escolaridade, vagas, situação e cronograma, preencher os dados e salvar. Ao salvar, a descoberta é marcada como publicada. O botão Descartar encerra itens irrelevantes.

Sem os dois secrets do GitHub, o monitor continua gerando relatório/issue, mas não envia novos itens à fila do Supabase.
