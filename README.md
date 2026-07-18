# atendo.

Atendimento ao cliente para lojas Shopify que se responde sozinho. Lê cada e-mail, classifica por tipo de solicitação, puxa o pedido real e rascunha a resposta no idioma do cliente — você só entra quando um humano precisa decidir.

Uso pessoal. Todos os dados ficam no navegador (localStorage); nenhuma informação sai da máquina.

## Rodando localmente

```bash
npm install
npm run dev
```

Abre em `http://localhost:5199`.

## Build de produção

```bash
npm run build   # gera dist/
npm start       # serve dist/ na porta $PORT (padrão 3000)
```

## Deploy no Railway

O `railway.json` já está configurado: build com `npm run build`, start com `npm start`. O Railway injeta `$PORT` automaticamente. Basta conectar o repositório e fazer deploy — nenhuma variável de ambiente é necessária.

## Como funciona

O botão **Sincronizar** traz e-mails de demonstração em seis idiomas. Cada um é classificado (rastreio, troca, reembolso, produto, entrega) e recebe uma resposta gerada a partir das políticas cadastradas e do pedido do cliente:

- Reembolsos e casos de baixa confiança vão para **Atendimento humano**
- O restante vai para **Aprovações**, para você revisar e enviar
- Com a automação ligada, respostas confiáveis saem sozinhas após o atraso configurado, com contador regressivo ao vivo

A **Base de Conhecimento** é a fonte de verdade: o que não estiver cadastrado lá nunca é prometido ao cliente.

## Estado atual

As conexões de e-mail e Shopify são simuladas — nenhuma senha é pedida e nenhum e-mail real é enviado. Conectar contas de verdade exigiria um backend com OAuth.

## Stack

React 19, TypeScript, Vite, React Router, lucide-react.
