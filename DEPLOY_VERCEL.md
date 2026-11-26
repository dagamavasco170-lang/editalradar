# Vercel como hospedagem alternativa do EditalRadar

O repositório continua sendo o GitHub (`dagamavasco170-lang/editalradar`). **A produção principal definida pelo workflow atual é o GitHub Pages**: `.github/workflows/build.yml` compila, publica e testa `https://dagamavasco170-lang.github.io/editalradar/`. A Vercel é uma hospedagem secundária opcional; o workflow verifica o endereço Vercel configurado, mas não depende dele para considerar a publicação principal válida.

Não altere o `Site URL` do Supabase nem os retornos OAuth para a Vercel enquanto o GitHub Pages continuar sendo o endereço canônico. Para migrar a produção para a Vercel, faça uma mudança coordenada e valide autenticação, links de retorno, Service Worker e versão publicada antes de trocar o endereço principal.

## 1. Importar o repositório

1. Entre em https://vercel.com/signup e crie/acesse uma conta.
2. Escolha continuar com GitHub e autorize a Vercel a acessar o repositório `dagamavasco170-lang/editalradar`.
3. No painel, clique em **Add New → Project** (ou **New Project**).
4. Encontre `editalradar` na lista e clique em **Import**.
5. Configure:
   - Project Name: `editalradar` (se estiver disponível; caso contrário, escolha `editalradar-app` ou outro nome livre).
   - Framework Preset: **Vite**.
   - Root Directory: `./`.
   - Build Command: `npm run build`.
   - Output Directory: `dist`.
6. Em **Environment Variables**, cadastre os mesmos valores já usados no GitHub:
   - `VITE_SUPABASE_URL`: Project URL do seu projeto Supabase.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Publishable key do Supabase.
   Selecione Production, Preview e Development para as duas variáveis.
7. Clique em **Deploy**.

A Vercel atribui um endereço gratuito terminado em `.vercel.app`. O endereço exato depende da disponibilidade do nome escolhido na sua conta; não considere `editalradar.vercel.app` garantido até a Vercel aceitá-lo.

## 2. Configurar a autenticação no Supabase

A configuração abaixo só deve ser aplicada durante uma migração intencional da origem canônica para a Vercel. Enquanto o GitHub Pages for a produção principal, mantenha o `Site URL` atual no domínio canônico e adicione a Vercel apenas como URL de retorno permitida, caso precise testar o login.

Depois que a Vercel mostrar o domínio de produção (por exemplo, `https://editalradar.vercel.app`):

1. No Supabase, abra **Authentication → URL Configuration**.
2. Defina **Site URL** como o domínio principal da Vercel, com barra final.
3. Em **Redirect URLs**, adicione o domínio da Vercel, por exemplo `https://editalradar.vercel.app/`.
4. Mantenha também o endereço antigo do GitHub Pages na lista se quiser continuar aceitando retornos pelo site antigo.

## 3. Atualizar o login Google

No Google Cloud Console → Google Auth Platform → Clients → seu cliente Web:

- Em **Authorized JavaScript origins**, adicione a origem da Vercel, por exemplo `https://editalradar.vercel.app`.
- Mantenha a origem do GitHub Pages se o site antigo continuará em uso.
- **Authorized redirect URI não muda**: continua sendo o callback do Supabase, `https://xrdtqbatynoofkjtjgeq.supabase.co/auth/v1/callback`.

O Client Secret continua apenas no Supabase, nunca na Vercel como variável pública, no GitHub ou no código.

## 4. Como ficam os endereços

- GitHub Pages: endereço canônico de produção, com o caminho `/editalradar/`.
- Vercel: endereço secundário opcional, na raiz do domínio.
- GitHub: continua sendo o repositório e o histórico de código.

O projeto detecta o ambiente de build: mantém `/editalradar/` no GitHub Pages e usa `/` na Vercel. O arquivo `vercel.json` encaminha rotas do aplicativo para o React.

## 5. Plano gratuito

A Vercel Hobby é gratuita para projetos pessoais e não comerciais e tem limites mensais de uso. Confira as condições atuais antes de usar o serviço para uma atividade comercial: https://vercel.com/docs/plans/hobby

## 6. Teste após a publicação

1. Abra o novo endereço `.vercel.app`.
2. Confirme se a página inicial carrega e se os arquivos de estilo funcionam.
3. Faça login com Google.
4. Salve um favorito e uma tarefa de estudo.
5. Abra a mesma conta em outro navegador/aparelho e confirme se os dados aparecem.

Documentação oficial:
- https://vercel.com/docs/git
- https://vercel.com/docs/frameworks/frontend/vite
- https://vercel.com/docs/plans/hobby
