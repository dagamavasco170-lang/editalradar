# Ativar cadastro e login do EditalRadar

O site é publicado como frontend estático no GitHub Pages. A autenticação e a sincronização entre aparelhos usam Supabase Auth + PostgreSQL.

## 1. Criar o projeto Supabase

1. Abra https://supabase.com/dashboard e crie um projeto.
2. Em Project Settings → API, copie a **Project URL** e a **Publishable key** (ou a chave legada **anon**).
3. Nunca use a chave **service_role** no navegador, no repositório ou nas variáveis VITE_.

## 2. Criar a tabela privada

1. No painel Supabase, abra SQL Editor.
2. Abra o arquivo `supabase/migrations/202611210001_user_data.sql` deste repositório.
3. Copie todo o conteúdo, execute no SQL Editor e confirme que a tabela `public.user_data` foi criada.
4. Depois, execute também todo o conteúdo de `supabase/migrations/202611220001_user_notifications.sql` para adicionar o histórico sincronizado de notificações.
5. A tabela tem Row Level Security (RLS); cada usuário autenticado só pode consultar e alterar a própria linha.

## 3. Configurar autenticação por e-mail

1. No Supabase, abra Authentication → URL Configuration.
2. Configure Site URL como `https://dagamavasco170-lang.github.io/editalradar/`.
3. Adicione esse mesmo endereço à lista de Redirect URLs.
4. Em Authentication → Sign In / Providers, habilite Email.
5. Mantenha confirmação de e-mail habilitada para que o usuário confirme o endereço antes do primeiro acesso.

## 4. Configurar o GitHub Actions

No repositório GitHub, abra Settings → Secrets and variables → Actions → Variables e crie estas **Actions variables**:

- `VITE_SUPABASE_URL`: Project URL copiada do Supabase.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Publishable key (ou anon key).

Esses dois valores são destinados ao cliente web. **Não crie nem use service_role como variável VITE_.**

Depois de salvar, execute Actions → Test, build and deploy EditalRadar → Run workflow, ou faça um novo commit em `main`.

## 5. Comportamento

- Sem as duas variáveis, o site continua funcionando como visitante e informa que a autenticação ainda precisa ser configurada.
- Com Supabase configurado, é possível criar conta, confirmar e-mail, entrar e sair.
- Favoritos, alertas, tarefas de estudo e notificações passam a ser carregados e sincronizados na conta, mantendo também uma cópia local.
- O histórico de notificações é atualizado na nuvem ao marcar avisos como lidos, abrir um aviso ou limpar o histórico; em outro aparelho, ele é carregado ao entrar ou atualizar o site.
- A tabela não armazena senhas: elas são gerenciadas pelo Supabase Auth.
- Caso a segunda migração ainda não tenha sido executada, a sincronização antiga continua funcionando e o aplicativo mostra um aviso com o nome do arquivo SQL pendente.

## Desenvolvimento local

Copie `.env.example` para `.env.local`, preencha os valores e execute `npm run dev`. Nunca faça commit do `.env.local`.

## 6. Recuperação de senha

O aplicativo envia pedidos por `resetPasswordForEmail` com retorno para o endereço público do GitHub Pages. Quando o link é aberto, o cliente detecta o evento `PASSWORD_RECOVERY` e mostra o formulário para criar uma nova senha.

No Supabase, confirme que `https://dagamavasco170-lang.github.io/editalradar/` está em Authentication → URL Configuration → Redirect URLs. Para entrega confiável, configure um provedor SMTP próprio em Authentication → SMTP Settings; o serviço de e-mail padrão pode ter limites de envio.

O sistema não informa se um e-mail existe: a mensagem de retorno é genérica por segurança. A nova senha precisa ter pelo menos 8 caracteres e ser confirmada no formulário.


## 7. Entrar com Google

O botão “Continuar com Google” usa Supabase Auth OAuth. Para ativá-lo, configure o provedor no Supabase e crie as credenciais no Google Cloud:

1. No Google Cloud Console, selecione ou crie um projeto e abra Google Auth Platform.
2. Configure a tela de consentimento (nome do aplicativo e e-mail de suporte). Para testes com o app em modo External/Testing, adicione os endereços Google que vão testar como usuários de teste.
3. Em Clients, crie um OAuth Client ID do tipo **Web application**.
4. Em **Authorized JavaScript origins**, adicione `https://dagamavasco170-lang.github.io`.
5. Em **Authorized redirect URIs**, adicione o callback do Supabase: `https://xrdtqbatynoofkjtjgeq.supabase.co/auth/v1/callback`.
6. Copie o Client ID e Client Secret gerados pelo Google.
7. No Supabase, abra Authentication → Sign In / Providers → Google, habilite o provedor e cole o Client ID e Client Secret. Salve.
8. Em Authentication → URL Configuration, mantenha `https://dagamavasco170-lang.github.io/editalradar/` na lista de Redirect URLs.

O Client Secret do Google deve ficar **somente** no painel do Supabase. Não o coloque em variáveis `VITE_`, no GitHub como variável pública, nem no código do site. O botão chama `signInWithOAuth({ provider: "google" })`; o Supabase conduz a autenticação e devolve o usuário ao GitHub Pages.

Documentação oficial: [Supabase — Sign in with Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).


## 9. Painel administrativo

1. No SQL Editor do Supabase, execute `supabase/migrations/202611220002_admin_catalog.sql`.
2. Siga [ADMIN_SETUP.md](./ADMIN_SETUP.md) para promover sua conta Google a administradora.
3. Saia e entre novamente no EditalRadar para atualizar as permissões do token.
4. A opção **Administração** aparecerá no menu lateral. As alterações serão publicadas para todos.

A migração usa RLS: leitura pública e gravação exclusiva de tokens autenticados com `app_metadata.role = admin`. Não use `user_metadata` para autorizar administradores e nunca exponha `service_role` no navegador.

## 8. Hospedagem alternativa na Vercel

Para usar um endereço gratuito mais curto, consulte o guia [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md). A hospedagem da Vercel pode coexistir com o GitHub Pages; mantenha no Supabase os dois endereços em Redirect URLs enquanto ambos forem usados.

## 10. Fila automática de revisão do EditalRadar

Depois de ativar o painel administrativo:

1. No SQL Editor, execute `supabase/migrations/202611220003_contest_discoveries.sql`.
2. No GitHub: repositório → Settings → Secrets and variables → Actions → New repository secret.
3. Cadastre `SUPABASE_URL` com a URL do projeto Supabase.
4. Cadastre `SUPABASE_SERVICE_ROLE_KEY` com a chave service_role/secret do Supabase. Essa chave fica somente nos secrets do GitHub Actions, nunca em variáveis `VITE_` ou no código do aplicativo.
5. Abra Actions → Monitorar fontes de concursos → Run workflow.

O workflow compara os links encontrados nas páginas oficiais com a execução anterior. Novos links relacionados a editais/concursos e alterações de páginas oficiais entram na fila protegida, visível apenas ao administrador. A primeira execução após a atualização semeia a fila com links relevantes e, quando não houver link específico identificável, com a própria página oficial para conferência inicial. Esse item é uma fonte a verificar, não um concurso confirmado. Depois, novos links serão comparados à linha de base e páginas alteradas gerarão itens de revisão. O monitor não faz leitura semântica de PDFs nem publica informações automaticamente. Toda ficha precisa ser conferida e salva pelo administrador. Se os secrets estiverem ausentes, o envio falha de propósito e a linha de base não avança, permitindo que a fila seja enviada depois da configuração.
