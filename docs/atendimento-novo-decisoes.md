# Atendimento novo — decisões de implementação

A especificação completa (regras gerais, jornadas, escada de reembolso, cadência,
bloqueios, Central operacional) foi entregue pelo dono em 15/09/2026 e é a fonte
de verdade. Este arquivo registra apenas os pontos em que o mapa deixava margem e
a escolha feita no código — todas fáceis de mudar, porque as fases são dados em
`server/atendimento.js`.

## Escolhas feitas

1. **Pedido com um único produto**: os "produtos afetados" são preenchidos
   automaticamente. Perguntar "qual produto?" para um pedido de uma peça só
   atrasaria uma etapa sem ganhar informação. Com dois ou mais itens, a pergunta
   é obrigatória, como manda a regra 6.

2. **Seção 6 → seção 8 (cliente que só perguntou o status e depois pediu
   reembolso)**: a oferta de cupom de 25% da seção 6.2 é a mesma da seção 8.2
   (passos 1–4). Ao entrar na seção 8, o cliente segue para o cupom de 40%
   (8.2.5) — a etapa de 25% não é repetida porque já foi enviada. "Não eliminar
   nenhuma etapa" foi lido como "não pular o 40% e ir direto ao 100%".

3. **Seção 7 versus seção 8 (pedido não recebido)**: a seção 7 é usada quando o
   cliente **já chega pedindo reembolso** (primeira mensagem da conversa), ou
   quando a situação é de entrega falha (marcado como entregue sem receber,
   voltou ao remetente, recusado na porta). A seção 8 é usada quando o cliente
   pergunta pelo pedido ou pede cancelamento de algo que ainda está a caminho.
   A situação de entrega vem do status da Shopify (entregue/trânsito/aguardando)
   combinada com o que o cliente relata.

4. **7.2 → próxima etapa**: depois dos dois dias de espera sem o pedido chegar,
   a conversa entra na seção 7.3 pela oferta de reenvio + 20%, como o texto diz
   ("sem pular a oferta inicial da seção 7.3").

5. **Prazo de entrega**: não existia dado real de prazo no sistema (a tela
   Prazos era ilustrativa). Cada loja ganha `prazoEntrega` em dias úteis (mínimo
   e máximo) e cada pedido passa a guardar `despachadoEm` vindo da Shopify. O
   limite é despacho + máximo de dias úteis; sem despacho, usa a data do pedido
   mais três dias úteis de processamento. Dias úteis ignoram sábado e domingo.

6. **Cupons**: cada loja cadastra os códigos por percentual (10, 15, 25, 30,
   35, 40). Se uma fase precisa de um cupom que a loja não cadastrou, o caso vai
   para a fila humana com o motivo explícito — o sistema nunca inventa código.

7. **Casos fora do mapa** (dúvida sobre produto antes da compra, pedido de
   nota fiscal, etc.): no modo novo vão para a fila humana com o motivo "fora do
   mapa do atendimento novo". Durante o piloto isso é o comportamento seguro;
   um fluxo "geral" pode ser adicionado depois como nova jornada.

8. **Recusa sem pedir reembolso**: rejeitar a oferta atual avança a escada do
   mesmo jeito que rejeitar pedindo 100% — o mapa trata os dois como recusa.

9. **Aceite de cupom**: como qualquer aceite (regra 10 e seção 9), cria decisão
   humana pendente. A confirmação sai depois da aprovação do dono.

10. **Prazo expresso da troca por defeito (3.3.4)**: 5 a 11 dias, conforme o
    mapa (corrigido na revisão de 15/09 — o código usava 4 a 11).

12. **Endereço**: qualquer texto NÃO é endereço. Antes de encaminhar o aceite de
    troca/reenvio, o servidor confere rua+número, código postal e cidade; se
    faltar algo, a resposta pede só o que falta e o aceite espera. O endereço
    pode chegar em partes, em mensagens diferentes.

13. **Imagem**: uma imagem recebida é registrada como "imagem recebida", não
    como prova. A troca por defeito só é oferecida depois que o dono confirma na
    conversa que a foto comprova o defeito; se ele recusar, o sistema pede outra
    foto. Nenhuma descrição automática de imagem é feita.

14. **Regeneração no modo novo**: "Gerar nova resposta" reescreve apenas a ação
    da fase pendente, passa pelos mesmos bloqueios, e a instrução do lojista só
    pode mexer em tom/tamanho — instrução que cite percentual, cupom, oferta ou
    etapa é recusada. Sem fase pendente (caso com o dono), não há regeneração
    automática.

15. **Texto final**: todo caminho de envio (aprovar, auto-envio) reconfere o
    texto contra a fase. Edição humana que mude percentual ou cupom exige
    confirmação explícita e fica registrada no histórico de fases. No modo novo,
    a fase só muda depois de um canal real enviar com sucesso; sem canal ou com
    falha, nada muda.

11. **Envio automático no modo novo**: desligado por padrão (implantação, item
    3). Os rascunhos ficam em Aprovações com o horário mínimo da cadência
    registrado; ligar o automático é uma chave por loja.

16. **Frete de devolução (5.9, revisão pelo mapa em 16/09)**: na fase de 50% a
    IA informa o custo estimado do frete de retorno só em dinheiro (25% do
    valor pago, calculado pelo servidor) — nunca a porcentagem. Texto que cite
    "25%" nessa fase é derrubado pelo bloqueio.

17. **Marcado como entregue e não recebido (7.2)**: passados os 2 dias sem o
    pacote, o próximo passo é reenvio + 35% (a seta do mapa entra no post-it
    de 35%, não no de 20%; o texto digitado da especificação dizia 20%).

18. **Confirmação depois do aceite (seção 9 / nota do mapa)**: todo aceite — e
    o 100% ou cancelamento decididos pelo dono — fica com o dono. Ao clicar
    "Aprovar e gerar a confirmação" na conversa, o servidor escreve a fase de
    confirmação correspondente: troca/reenvio → aprovado, frete expresso no
    prazo da oferta aceita (5 a 11 ou 4 a 11 dias) e o endereço confirmado
    repetido; reembolso e cancelamento → aprovado, valor em dinheiro e 3 a 14
    dias para o dinheiro voltar ao método de pagamento (se questionar, a loja
    segue a lei do país); cupom → código liberado. É a única fase em que a IA
    pode falar de fato consumado, e mesmo ali só com os números da opção
    aceita. O rascunho passa pela Aprovações; enviado, o caso fecha e qualquer
    mensagem nova vai ao dono.

19. **Relatório**: continua 100% manual. O popup "Adicionar ao relatório"
    mostra uma sugestão de linha a partir da opção aceita (ex.: "REENVIO —
    ENDEREÇO: …", "REEMBOLSO 40%"), que só entra se o dono clicar.

20. **Seção 6 → 8.2 (mantido, a confirmar com o dono)**: quem só perguntou o
    status e está atrasado já recebe desculpas + cupom de 25%; se recusar, a
    seta do mapa entra em 8.2 no mesmo post-it de desculpas + 25%. O motor não
    repete essa mensagem e segue para o cupom de 40% (decisão 6).

21. **Central operacional (revisão da Parte 7, 16/09)**: o cálculo é UM só,
    puro e testado (`shared/central.js`), usado pela página e por
    `GET /api/central`. "Todos os pedidos" é a junção pedido × caso: pedido
    sem conversa aparece como "sem atendimento" / "sem fase". As métricas de
    fase contam uma vez por pedido + fase (vários tickets, mensagens repetidas
    ou conversas fundidas não duplicam) e só entram fases efetivamente
    enviadas (`historicoEtapas` sem evento): rascunho pendente, fase inferida
    e correção manual ficam fora de passaram/pararam/avançaram e aparecem em
    contadores separados. Valores por moeda em cada fase e indicador. "Antes
    do pipeline" virou "cenário hipotético sem retenção" (e "dados históricos
    insuficientes" sem reembolso confirmado pelo motor) — nunca economia
    comprovada. Filtros de jornada e fase atual somam-se aos demais.

22. **Correção manual com auditoria**: cada correção e cada remoção fica em
    `ticket.centralHistorico` (fase anterior, nova fase, jornada, usuário,
    data, justificativa, remoção); `centralAjuste` é só a correção ativa.
    Nada disso toca `atendimentoNovo.etapa`, `transicaoPendente` ou a próxima
    oferta.

23. **Texto final — exigências positivas**: além dos bloqueios negativos, o
    texto de uma fase com oferta TEM de conter o percentual da etapa, só
    valores em dinheiro calculados pelo servidor (valor pago, percentual em
    dinheiro, frete estimado), o código do cupom cadastrado (nenhum código
    inventado nem de outra etapa), a ação nomeada (troca / reenvio /
    reembolso / cupom / cancelamento no idioma do cliente) e o prazo da
    oferta. Vale em todo caminho de envio (chegada, regenerar, aprovar,
    auto-envio) e na confirmação (com os números da opção aceita).

24. **Canal de envio no modo novo**: só a conta de e-mail da própria loja
    (`ticket.lojaId`); sem ela, nada sai — a conta de outra loja nunca é
    usada como reserva. (O clássico mantém a reserva antiga.)

25. **Foto**: a validação só existe no fluxo de defeito, com uma imagem
    aguardando a comprovação (`aguardandoComprovacao`) e uma próxima etapa
    definida; não há destino automático para `def_troca`. Os botões só
    aparecem nesse caso.

26. **Testes**: o pipeline encerra o servidor com `encerrar()` (intervalos,
    tarefas de arranque, gravações pendentes e HTTP) em vez de
    `process.exit`; uma falha real termina `npm test` com código diferente de
    zero (test/saida.test.mjs prova isso com um processo filho).

## Bloqueios implementados no servidor (seção 11)

- O prompt recebe só a fase atual e a ação permitida.
- `acao_proposta` diferente da fase permitida → fila humana.
- Percentual ou cupom no texto diferente do previsto para a fase → fila humana.
- O estado persistido no ticket manda; o texto do histórico não decide a fase.
- Transição só é gravada quando o e-mail sai com sucesso (`transicaoPendente`).
- Ticket antigo que entra no modo novo começa na triagem.
