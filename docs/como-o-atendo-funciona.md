# atendo — como o sistema funciona

Documento de contexto. Descreve o sistema como ele está hoje (15/09/2026), para
quem precisa entender o funcionamento antes de propor mudanças.

---

## 1. O que é

O **atendo** é um sistema de atendimento ao cliente por e-mail, com IA, feito para
uma operação de dropshipping de roupas com **10 lojas** (Von Alder, Voss Alden,
Eldenmark, Van Alder, Van Aldric, Von Tauern, Halvern, Aldmark, Haltform), cada
uma com sua própria caixa de e-mail, sua loja Shopify, seu idioma e sua assinatura.

A ideia central: **todo e-mail que chega é lido, classificado e respondido pela IA
automaticamente — exceto quando envolve uma decisão que só o dono pode tomar.**
Nesses casos o e-mail vai para uma fila humana, sem resposta pronta.

Escala atual: 3.866 conversas, 3.863 pedidos sincronizados, 1.141 produtos,
~59 dias de operação registrados.

Clientes escrevem em alemão, francês, italiano, holandês, inglês e espanhol. O
dono é brasileiro e trabalha em português: tudo que é "para ele" (resumos,
motivos, relatórios) sai em PT, e a resposta ao cliente sai no idioma dele.

---

## 2. Stack e infraestrutura

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite, React Router (HashRouter), PWA instalável |
| Backend | Node + Express (ESM, JavaScript puro, sem framework extra) |
| Banco | PostgreSQL (Railway) — com fallback para arquivos JSON locais em dev |
| IA | Claude Haiku 4.5 (padrão) via `@anthropic-ai/sdk`; Gemini 2.5 Flash como teste A/B por loja |
| E-mail | IMAP (`imapflow`) para ler, SMTP (`nodemailer`) para enviar; Resend opcional |
| Loja | Shopify Admin API (OAuth ou token) para pedidos e produtos |
| Deploy | Railway, deploy automático a cada push no `main` do GitHub |

Arquivos principais do servidor:

- `server/index.js` — rotas, pipeline de e-mail, agendamentos, páginas públicas (o maior)
- `server/ai.js` — prompt do sistema, schema JSON da resposta, chamadas ao Claude
- `server/atendimento.js` — modos de atendimento (clássico/novo)
- `server/logic.js` — regras locais sem IA: spam, idioma, categoria, travas de texto
- `server/mail.js` — IMAP/SMTP, extração de anexos
- `server/shopify.js` — sincronização de pedidos e produtos
- `server/traducao.js` — tradução gratuita (Google público)
- `server/db.js` — Postgres/arquivo, tabela de anexos
- `server/auth.js` — scrypt, sessões, cifra das credenciais

Variáveis de ambiente relevantes: `ANTHROPIC_API_KEY`, `ATENDO_MODEL`,
`GEMINI_API_KEY`, `DATABASE_URL`, `ATENDO_FUSO` (padrão −3), `EMAIL_DIAS`
(janela de leitura, padrão 3 dias), `EMAIL_IMPORT_MAX` (padrão 2000),
`ATENDO_ANEXOS_DIAS` (padrão 60), credenciais Shopify.

---

## 3. Conceitos e dados

**Workspace** — a conta. Todo o estado (conversas, pedidos, produtos, configurações)
vive num único documento JSONB por workspace no Postgres. Várias pessoas podem ter
login no mesmo workspace. Gravação com debounce de 1,5 s para não inflar o WAL.

**Loja** (`loja1`…`lojaN`) — cada uma tem: nome, moeda, idioma de resposta
(`auto` ou fixo), assinatura, conta de e-mail própria (IMAP/SMTP cifrados),
conexão Shopify, modelo de IA (`claude` | `gemini`) e **modo de atendimento**
(`classico` | `novo`). Toda a interface pode ser filtrada por loja ou ver tudo junto.

**Ticket** (conversa) — campos que importam:

| Campo | Significado |
|---|---|
| `status` | `inbox`, `aprovacao`, `humano`, `enviado`, `spam`, `lixeira` |
| `categoria` | `rastreio`, `reembolso`, `troca`, `produto`, `entrega`, `outro` |
| `idioma` | idioma em que o cliente escreveu |
| `rascunho` | resposta que a IA escreveu, ainda não enviada |
| `enviaEm` | timestamp do envio automático agendado |
| `confianca` | 0 a 1, qualidade da resposta segundo a própria IA |
| `motivoEscalada` | por que caiu na fila humana (em PT) |
| `resumoSituacao` | uma frase em PT do que o cliente quer |
| `resolucao` | uma frase em PT do que a resposta resolveu |
| `historico` | mensagens da conversa (`cliente` ou `atendo`), com traduções |
| `anexos` | imagens enviadas pelo cliente (bytes ficam em tabela separada) |
| `relatorioDia` / `relatorioTexto` / `relatorioLinha` | entrada no relatório manual |
| `motivoReembolso` | motivo do reembolso lido pela IA (cache) |
| `iaPausada` | a IA não age mais nesta conversa |

**Pedido** — vindo da Shopify: número, cliente, e-mail, país, **valor pago**,
status de envio, rastreio, itens com preço pago por unidade.

---

## 4. O ciclo de vida de um e-mail

Este é o coração do sistema.

### 4.1 Chegada
A cada **60 segundos** o servidor lê por IMAP a caixa de cada loja (janela de 3
dias). Cada mensagem nova vira ou uma conversa nova, ou uma mensagem anexada a
uma conversa existente.

### 4.2 Filtro de spam (antes de gastar IA)
Uma regra local decide se aquilo parece spam, analisando **apenas o texto próprio
do remetente** — linhas citadas do e-mail anterior (`>`, "em … escreveu", cabeçalhos
de encaminhamento) são removidas antes da análise. Isso existe porque respostas de
clientes a e-mails em massa da loja carregavam o rodapé promocional citado e eram
condenadas como spam.

**Exceção absoluta:** se o remetente tem pedido na loja (pelo e-mail) ou cita um
número de pedido que existe, **nunca é spam** — nem pela regra local, nem pela IA.
Há ainda um resgate automático: a cada sincronização, mensagens na caixa de spam
que sejam de clientes identificados voltam para a caixa (a menos que o dono as
tenha movido para spam à mão).

### 4.3 Fusão de conversas
Mensagens da mesma pessoa sobre o mesmo pedido são unidas numa conversa só, mesmo
quando ela escreve de e-mails diferentes — o sistema exige evidência: mesmo número
de pedido citado **e** (citação do outro e-mail **ou** nome completo idêntico).

### 4.4 A IA lê e responde
O prompt do sistema é montado por loja e inclui: regras invioláveis, fluxo de
devolução, políticas cadastradas, FAQs, comportamentos personalizados, catálogo de
produtos (enxuto — só os relevantes vão completos, para economizar tokens),
assinatura, idioma, exemplos reais de como o dono escreve (aprendizado de estilo),
e os pedidos daquele cliente na Shopify com o **valor total pago**.

A IA devolve **JSON estruturado**, sempre com estes campos:

```
situacao          resumo em PT do que o cliente quer
resolucao         frase curta em PT do que esta resposta resolve
categoria         rastreio | reembolso | troca | produto | entrega | outro
idioma            ISO do idioma do cliente
resposta          a resposta pronta (VAZIA quando escala ou é spam)
confianca         0 a 1
escalar_humano    precisa de decisão do dono
aprova_reembolso  o próximo passo é aprovar um reembolso
confirma_troca    o cliente já aceitou a troca
encerrar          mensagem sem nada a responder (agradecimento)
motivo            por que escalou (em PT)
spam              não é cliente falando da própria compra
```

### 4.5 O que acontece com a resposta
A função `aplicarResultado` decide o destino:

1. **`encerrar = true`** (cliente só agradeceu, "tudo certo") → conversa fecha
   sozinha como resolvida, sem enviar nada e sem passar pelo dono.
2. **Precisa de decisão** → status `humano`, **sem rascunho**: o dono escreve a
   resposta ou pede uma à IA na hora. Dispara quando: `escalar_humano`,
   `aprova_reembolso`, `confirma_troca`, confiança abaixo do mínimo, resposta
   vazia, resposta repetida, ou confirmação indevida detectada no texto.
3. **Resto** → status `aprovacao` com o rascunho pronto. Se a automação estiver
   ligada, agenda o envio para daqui a X minutos (configurável); enquanto não
   vence, o dono pode editar, aprovar na hora ou pausar.

### 4.6 Envio
Um laço a cada 5 segundos envia o que venceu. Falha de envio tenta 3 vezes com
espera crescente; depois disso o caso vai para a fila humana com o erro descrito.

---

## 5. As regras que a IA segue

### 5.1 Invioláveis (valem sempre)
- **A IA nunca aprova nada por conta própria**: reembolso, reenvio, desconto,
  cancelamento com devolução, indenização ou exceção a política é decisão do dono.
- Proibido escrever confirmações como fato consumado — "confirmo o reembolso",
  "o dinheiro chegará em X dias", "a troca está confirmada", "enviaremos as peças
  novas", "sua troca já está em andamento" — em qualquer idioma.
- Políticas, FAQs e catálogo são a **única** fonte de verdade: nunca inventar
  prazo, preço, produto ou promessa.
- Tamanhos: a loja trabalha com **todos os tamanhos até 7XL** (produção sob
  demanda), mesmo que o catálogo liste menos. Acima de 7XL não existe.
- Valores: qualquer conta sobre um pedido usa o **valor total pago**, nunca a
  soma de preços de catálogo.
- Campos para o dono (`situacao`, `motivo`, `resolucao`) sempre em português.

### 5.2 Fluxo de devolução (autorizado por escrito pelo dono)
Este é o único lugar onde a IA oferece concessões sozinha:

1. Cliente quer devolver mas **não disse o motivo** → perguntar o motivo. Nada é
   oferecido ainda. *(automático)*
2. Motivo é **tamanho/caimento** → oferecer **troca gratuita** pelo tamanho certo,
   e o cliente **fica com as peças atuais**. Perguntar qual tamanho/cor. *(automático)*
3. Motivo é **qualidade, material, defeito ou "não gostei"** → oferecer duas opções
   sobre o valor pago: **60% de reembolso ficando com o produto** ou **100% com
   devolução**. Apresentar como escolha, sem confirmar. *(automático)*
4. Cliente **escolheu o reembolso** → `escalar_humano` + `aprova_reembolso`,
   resposta vazia. **A aprovação é do dono.**
5. Cliente **aceitou a troca** (informou tamanho/cor) → `escalar_humano` +
   `confirma_troca`, resposta vazia. **A confirmação é do dono.** A `resolucao`
   sai no formato "Troca de 3 polos por tamanho XXL", pronta para o relatório.

Pedir **etiqueta de devolução** é pedir devolução: entra no fluxo. Nunca responder
com rastreio a quem pediu devolução, e nunca prometer etiqueta.

### 5.3 Outras regras
- **Escalar sempre**: disputas, chargeback, ameaça legal ou de exposição pública,
  cliente muito irritado, pedido de indenização. Ao escalar, resposta vazia.
- **Falta de informação**: se o que falta o próprio cliente pode dar (número do
  pedido, foto), pedir é a resposta certa e vale confiança alta — não escala. Se
  falta algo que só a loja decide, escala.
- **Nunca repetir** a resposta anterior: se o cliente insistiu, é porque não
  resolveu.
- **Spam**: só fica na caixa quem fala da própria compra ou de produtos. Primeira
  mensagem genérica ("hello", "do you speak English?") é golpe. Texto citado não
  condena. Cliente com pedido nunca é spam. Spam não recebe resposta.
- **Imagens**: a IA sabe que o cliente anexou fotos, mas não as vê. Se a decisão
  depende do conteúdo delas, escala em vez de inventar.

### 5.4 Personalização pelo dono
- **Políticas** e **FAQs** cadastradas entram no prompt.
- **Comportamentos**: pares "situação → como agir" que têm prioridade sobre o
  fluxo padrão (mas nunca sobre as invioláveis). Há 23 cadastrados.
- **Aprendizado de estilo**: as últimas 5 respostas reais do dono naquela loja vão
  no prompt como exemplo — incluindo o par "a IA escreveu X, o dono mandou Y",
  para a IA aprender com a correção.
- **Instruções de uma resposta**: o dono pode digitar "ofereça 60%" e pedir para
  gerar; instrução do lojista tem prioridade máxima e autoriza a concessão.

---

## 6. Travas no código (não dependem da IA obedecer)

Aprendizado caro: prompt sozinho não segura um modelo que erra. Estas travas são
determinísticas, rodam sobre o texto gerado e **não podem ser burladas**:

- **Confirmação indevida** (`confirmacaoIndevida` em `logic.js`): se a resposta
  contém linguagem de confirmação de reembolso/cancelamento/troca — inclusive
  promessas de execução como "enviaremos as peças novas gratuitamente" ou "faremos
  a troca imediatamente" — em pt/en/de/fr/it/nl/es, a mensagem **nunca é enviada**;
  vira caso humano. Ofertas legítimas passam: a detecção de promessa ignora frases
  interrogativas, porque oferecer termina em pergunta.
- **Resposta vazia** nunca sai no automático.
- **Resposta idêntica** à última já enviada naquela conversa nunca sai.
- **Confiança abaixo do mínimo** (padrão 0,55) vai para aprovação/humano.
- **Cliente identificado** nunca cai em spam.

---

## 7. As telas

| Rota | O que faz |
|---|---|
| `/` Início | Onboarding em 3 passos, resumo do dia |
| `/caixa` Caixa de entrada | Todos os e-mails recebidos; filtros por origem, lidos/não lidos, categoria, busca por nome/e-mail/nº do pedido |
| `/aprovacoes` | Rascunhos prontos esperando o envio automático ou sua aprovação |
| `/humano` Atendimento humano | Fila do que precisa de decisão; ordenada do mais recente ao mais antigo; filtro por categoria (Troca, Reembolso, Entrega…) |
| `/enviados` | Histórico de respostas |
| `/clientes` | Pessoas, com histórico e pedidos |
| `/resumos` Resumo diário | Resumo automático do dia + **relatório manual** + link do chefe + relatório de reembolsos |
| `/conhecimento` | Políticas, FAQs e comportamentos da IA |
| `/spam`, `/lixeira` | Triagem, com restaurar |
| `/pedidos` | Pedidos da Shopify, busca por nome/e-mail/nº/rastreio, ficha do cliente, botão 17TRACK, e-mail direto ao cliente |
| `/prazos`, `/produtos` | Prazos de entrega e catálogo |
| `/ganhos` | Custo de IA por dia e por loja |
| `/configuracoes` | Loja, equipe, caixa, respostas, integrações, conta, aparência |

**Dentro de uma conversa** o dono tem: histórico com traduções, imagens do
cliente, painel lateral com ficha do cliente e pedidos, navegação Anterior/Próximo
(também pelas setas do teclado), botões de subir/descer, "Gerar com IA" com
instruções salvas de um clique, "Ver em português", "Adicionar ao relatório",
"Marcar como respondida", e três formas de enviar: **Enviar (continua comigo)**,
**Aprovar e enviar**, **Aprovar e fechar**.

A interface é responsiva (funciona em 375 px), tem 6 paletas de cor, tema
claro/escuro e é instalável como app no iPhone.

---

## 8. Relatórios

**Resumo diário automático** — à meia-noite (fuso −3) o dia anterior é fechado:
quantos atendimentos, recebidos, spam, divisão por categoria, por loja. Não gasta IA.

**Relatório manual** — o dono marca conversas com "Adicionar ao relatório" e
escolhe um texto (REEMBOLSO 100%, REEMBOLSO 60%, REENVIO DO PEDIDO, TROCA DE
TAMANHO…). Sai no formato `PEDIDO 2225 - REEMBOLSO 100%`. Cada linha pode ser
editada à mão. **Nada entra automaticamente — é 100% curado pelo dono.**

**Link do chefe** — `/r/<workspace>/<token>`: página pública, sem login, com os
relatórios manuais por dia e checkbox para o chefe marcar o que já processou.
Revogável. Opção de só mostrar o dia atual depois da meia-noite.

**Relatório de reembolsos** — `/r/<workspace>/<token>/reembolsos`: pega todos os
reembolsos do relatório manual (hoje: 320 de 382 linhas), casa cada um com o
pedido para pegar o **valor pago**, calcula o **valor efetivamente reembolsado**
(valor × 100% ou 60%) e mostra: cartões de total, gráfico de barras **por motivo**
(qualidade, tamanho, defeito, não recebeu, atraso, produto errado, não gostou,
alergia, desistência, não informado), gráfico por loja e a lista detalhada.
Filtros de período: hoje / 7 dias / 30 dias / tudo.

O **motivo** é lido pela IA a partir das mensagens do próprio cliente e fica
guardado na conversa, então cada reembolso é lido uma vez só. Uma rotina semanal
lê sozinha os motivos dos reembolsos novos.

---

## 9. Tradução

Tudo que é do cliente pode ser traduzido para português com um clique (mensagem,
assunto, rascunho, situação, motivo). Usa o endpoint público gratuito do Google —
**não gasta IA**. Como o IP do Railway é compartilhado, o Google às vezes bloqueia
(HTTP 429); o sistema espaça pedidos, alterna hosts, e para de tentar por 10
minutos quando bloqueado. Não há fallback pago: foi decisão do dono manter grátis.

---

## 10. Custos

Modelo padrão Haiku 4.5 (US$ 1/milhão entrada, US$ 5/milhão saída). Uma resposta
completa custa entre US$ 0,01 e US$ 0,07, porque carrega catálogo, políticas e
histórico. O custo aparece em cada conversa e é somado por dia e por loja na tela
Ganhos. Leituras auxiliares (motivo de reembolso) custam ~US$ 0,0005 por caso.
Economias já implementadas: catálogo enxuto, histórico limitado às últimas 8
mensagens, escalados não geram rascunho, motivos em cache, tradução gratuita.

---

## 11. Modo de atendimento: clássico e novo

Acabou de ser criada a chave que permite **reformular o atendimento sem destruir o
atual**:

- Cada loja tem `modoAtendimento`: **`classico`** (tudo descrito acima, padrão de
  todas as lojas) ou **`novo`**.
- O modo é escolhido em Configurações → Loja, por loja — dá para testar o novo em
  uma loja só, com clientes reais, enquanto as outras seguem no clássico.
- Em `server/atendimento.js` existe `REGRAS_NOVO`, uma lista de regras que
  **substitui o bloco do fluxo de devolução** no prompt quando a loja está no modo
  novo. Hoje está vazia, então o modo novo responde exatamente como o clássico.
- O que **não** muda entre os modos: regras invioláveis, catálogo, políticas,
  FAQs, comportamentos, idioma, assinatura e todas as travas de código.

É aqui que entra qualquer proposta de novo fluxo de atendimento.

---

## 12. Restrições que não podem ser quebradas

1. **A IA nunca aprova nem confirma reembolso, troca, reenvio ou cancelamento.**
   Essa é a regra número um do dono, repetida várias vezes, e é protegida por
   prompt e por código.
2. **O relatório manual é curado pelo dono** — nada entra sozinho nele.
3. **Nenhum caso "sem nada a fazer" deve ocupar a fila humana** (um agradecimento
   não é trabalho).
4. **Cliente com pedido nunca é tratado como spam.**
5. **A fila humana é ordenada do mais recente para o mais antigo** — ordenações
   "inteligentes" por urgência foram testadas e rejeitadas por desorganizarem.
6. **Trabalho pago não pode ser perdido por clique errado** (modais que contêm
   texto gerado por IA não fecham ao clicar fora).
7. **O armazenamento é finito**: o Postgres já encheu uma vez. Gravações são
   coalescidas, imagens são limpas após 60 dias, e falha de gravação mostra um
   banner vermelho com retentativa automática.
8. **Toda mudança vale para todas as lojas** salvo quando explicitamente por loja.

---

## 13. Backup e segurança

- Código versionado no GitHub, com tag `v1-atendimento-original` marcando o estado
  antes da reformulação.
- Exportação completa do workspace em JSON pelo painel (Configurações → Conta →
  Dados), sem credenciais.
- Snapshot do volume Postgres no Railway (inclui as imagens dos clientes).
- Credenciais de e-mail cifradas (AES-256-GCM) com segredo do servidor; senhas de
  usuário com scrypt; sessões por cookie.
- Páginas públicas (link do chefe) usam token de 16 bytes comparado com
  `timingSafeEqual` e são `noindex`.
