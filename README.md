# atendo.

Atendimento ao cliente para lojas Shopify que se responde sozinho. Lê cada e-mail da caixa de atendimento, classifica por tipo de solicitação, puxa o pedido real da Shopify e escreve a resposta com IA no idioma do cliente — você só entra quando um humano precisa decidir.

## Arquitetura

- **Frontend**: React + TypeScript + Vite (pasta `src/`)
- **Backend**: Node + Express (pasta `server/`) — lê IMAP, envia SMTP, consulta a Shopify Admin API e gera respostas com o Claude
- **Estado**: arquivo JSON em `data/` (no Railway, use um volume)

Toda integração é opcional e configurada por variável de ambiente. O que não estiver configurado roda em **modo demonstração** (e-mails de exemplo, pedidos de exemplo, respostas por regras).

## Rodando localmente

```bash
npm install
npm run build          # gera dist/
npm start              # backend + frontend em http://localhost:8787
```

Para desenvolvimento com hot-reload: `npm run dev:server` em um terminal e `npm run dev` em outro (o Vite faz proxy de `/api` para a porta 8787).

## Variáveis de ambiente

No Railway: serviço → aba **Variables**. Todas são opcionais.

### IA (Claude) — gera as respostas de verdade

| Variável | Exemplo |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (crie em console.anthropic.com) |
| `ATENDO_MODEL` | opcional, padrão `claude-opus-4-8` |

Sem a chave, as respostas são geradas por regras simples baseadas nas políticas cadastradas.

### E-mail de atendimento — leitura (IMAP) e envio (SMTP)

| Variável | Exemplo |
|---|---|
| `EMAIL_PROVIDER` | `hostinger`, `gmail`, `outlook`, `yahoo`, `icloud`, `titan` ou `zoho` |
| `EMAIL_USER` | `suporte@sualoja.com` |
| `EMAIL_PASS` | senha da caixa de e-mail |
| `EMAIL_DIAS` | opcional, padrão `3` — janela de dias que o app considera ao ler a caixa |

**Hostinger** (e domínio próprio em geral): crie a caixa em hPanel → E-mails → Contas de e-mail e use a senha da própria caixa — não a senha do painel da Hostinger. Não precisa de senha de app.

**Gmail**: exige verificação em duas etapas e uma *senha de app* de 16 letras gerada em myaccount.google.com/apppasswords. A senha normal da conta é sempre recusada.

Outro servidor qualquer: em vez de `EMAIL_PROVIDER`, use `EMAIL_IMAP_HOST`, `EMAIL_SMTP_HOST` e, se necessário, `EMAIL_IMAP_PORT` (padrão 993) e `EMAIL_SMTP_PORT` (padrão 465).

Com o e-mail configurado, o servidor lê a caixa a cada 60 segundos, transforma cada e-mail não lido em ticket com resposta pronta, e envia as respostas aprovadas de verdade.

### Quando a hospedagem bloqueia o envio por SMTP

Railway, Vercel e a maioria das PaaS bloqueiam as portas de saída SMTP (25, 465 e 587) para conter spam. O sintoma é inconfundível: a **leitura funciona** (IMAP na porta 993 passa) e o **envio falha por tempo esgotado** em qualquer porta. Nesse caso, envie por API HTTP:

| Variável | Exemplo |
|---|---|
| `RESEND_API_KEY` | `re_...` (crie em resend.com → API Keys) |
| `EMAIL_FROM` | `suporte@seudominio.com` — de um domínio verificado na Resend |

Com `RESEND_API_KEY` definida, o envio usa a API da Resend (HTTPS, nunca bloqueada) e o SMTP é ignorado. A leitura continua pelo IMAP, e o *reply-to* aponta para `EMAIL_USER` — então as respostas dos clientes voltam para a sua caixa normalmente.

### Shopify — pedidos e rastreio reais

Há dois caminhos, dependendo da sua loja.

**OAuth (lojas migradas para o Dev Dashboard — o caso da maioria hoje):**

| Variável | Exemplo |
|---|---|
| `SHOPIFY_CLIENT_ID` | Client ID do app no Dev Dashboard |
| `SHOPIFY_CLIENT_SECRET` | Client secret do mesmo app |
| `APP_URL` | opcional — a URL pública do app, se a detecção automática falhar |
| `SHOPIFY_SCOPES` | opcional, padrão `read_orders,read_all_orders,read_customers,read_fulfillments` |
| `SHOPIFY_API_VERSION` | opcional, padrão `2026-07` |

No app do Dev Dashboard, cadastre em **Redirect URLs**: `https://<sua-url>/api/shopify/callback`. Depois, em **Configurações → Shopify** no atendo, digite o endereço da loja e clique em *Conectar Shopify* — a autorização acontece na Shopify e o token volta pronto. Ele é guardado apenas no servidor e nunca é enviado ao navegador.

**Token fixo (apps personalizados antigos, quando a loja ainda oferece):**

| Variável | Exemplo |
|---|---|
| `SHOPIFY_STORE` | `sualoja.myshopify.com` (aceita também só `sualoja` ou a URL completa) |
| `SHOPIFY_ADMIN_TOKEN` | `shpat_...` |

A Shopify aposenta cada versão da API depois de cerca de 12 meses. Quando a padrão expirar, defina `SHOPIFY_API_VERSION` com uma mais recente — a tela de Configurações avisa quando isso acontece.

### Persistência

| Variável | Exemplo |
|---|---|
| `DATA_DIR` | `/data` |

No Railway, crie um **Volume** montado em `/data` e defina `DATA_DIR=/data` — sem isso, tickets e configurações são zerados a cada deploy.

## Como funciona o fluxo

1. E-mail novo chega (IMAP real ou demonstração) → classificado como spam ou solicitação de cliente
2. O Claude lê o e-mail + o pedido do cliente na Shopify + suas políticas/FAQs e escreve a resposta no idioma do cliente
3. Reembolsos, casos sensíveis e baixa confiança vão para **Atendimento humano**; o resto vai para **Aprovações**
4. Com a automação ligada, respostas confiáveis são enviadas sozinhas após o atraso configurado (contador ao vivo)
5. A **Base de Conhecimento** é a fonte de verdade: o que não está lá nunca é prometido ao cliente

## Deploy no Railway

O `railway.json` já configura build (`npm run build`) e start (`npm start`). Conecte o repositório, adicione as variáveis desejadas e o volume, e faça deploy.
