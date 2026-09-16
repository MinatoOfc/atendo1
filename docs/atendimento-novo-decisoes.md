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

27. **Valor em dinheiro obrigatório (revisão de 16/09)**: toda fase com
    percentual exige o percentual E o valor em dinheiro calculado pelo servidor
    (percentual × valor pago); sem valor do pedido o texto não sai. Troca +
    reembolso e reenvio + reembolso exigem as duas ações nomeadas; a fase de
    50% exige o valor do frete (25%) separado do valor do reembolso; cupom
    exige código cadastrado E percentual; confirmação de reembolso/cancelamento
    exige o valor exato e "3 a 14 dias".

28. **Indicadores da Central = linhas visíveis**: pedidos totais, valor total,
    pedidos com atendimento, casos, envolvidos em reembolso, aceites
    pendentes, reembolsado de fato e jornadas são calculados sobre as linhas
    que sobram depois de busca + loja + período + desfecho + jornada + fase.

29. **"Reembolsado de fato" só com prova**: entra apenas quando a fase de
    confirmação (`conf_reembolso`, `conf_cancelamento`, `conf_troca` com
    reembolso parcial) está em `historicoEtapas` — gravada por
    `confirmarTransicao` somente depois de o e-mail sair por um canal real — ou
    quando o dono marcou o caso como processado no link do relatório
    (`relatorioProcessado`). Aceite com `acaoAceita` + `aguardando: humano`
    (ou com a confirmação ainda em rascunho) é "aceite pendente", com
    indicador próprio; linha do relatório clássico não processada é
    "registrado"; encerramento sem reembolso não entra em nada. O cenário
    hipotético usa os mesmos efetivados.

30. **Fases sem oferta também têm conteúdo obrigatório (16/09)**: o bloqueio
    positivo confere cada fase do mapa, não só as que têm oferta —
    `coleta` pede cada item que falta (pedido, produtos, motivo,
    pequeno/grande, foto, rua/CEP/cidade); `tam_ajuste` pergunta pequeno E
    grande; `def_foto` pede a foto; `endereco` pede o endereço completo (ou
    só os componentes que faltam); `nc_no_prazo` diz que está dentro do prazo,
    cita a data provável calculada pelo servidor (qualquer formato usual) e não
    oferece benefício; `nr_entregue_aguardar` pede mais 2 dias e a checagem
    com vizinhos/portaria; `nc_atrasado_25` exige "mais 5 dias úteis" além do
    cupom; `conf_troca` repete o endereço confirmado por inteiro, o prazo
    exato da troca/reenvio e, se houver, percentual + valor + 3 a 14 dias e
    cupom com a palavra, o código e o percentual. Em toda oferta com cupom a
    palavra "cupom" (Gutschein/coupon) é obrigatória — código solto não basta.
    O prompt entrega esses dados à IA (data provável, 2 dias, 5 dias úteis,
    endereço a repetir).

31. **Oferta indevida (16/09)**: em toda fase, cláusula a cláusula, o texto
    não pode OFERECER nem PROMETER troca, reenvio, cupom, reembolso ou
    cancelamento fora da oferta da fase (ou da opção já aceita, no pedido de
    endereço e nas confirmações). Uma cláusula é oferta quando cita a ação e
    traz um marcador de oferta/promessa ("oferecemos", "podemos", "gratuita",
    "wir können", "gerne", "alternativ"…) sem marcador de negação/limite
    ("não", "ainda não", "só depois do prazo", "erst nach Ablauf", "cannot",
    "leider"…). Assim, "dentro do prazo" pode explicar que reembolso ou
    cancelamento ainda não é possível, e a mera menção ("você pediu uma
    troca") não bloqueia. Antes dos dados obrigatórios, da foto validada ou do
    fim do prazo, nenhuma oferta aparece (coleta, ajuste de tamanho, pedido de
    foto, dentro do prazo, marcado como entregue).
    Análise (revisão de 16/09): a frase é dividida só por pontuação forte
    (. ! ? ;) e por conjunções adversativas/consecutivas ("mas", "então",
    "aber", "dann", "but", "however"…). Vírgula, dois-pontos, travessão,
    artigos ("o reembolso") e alternativas ("ou/or/oder") NÃO separam o
    marcador de oferta da ação — "Oferecemos, sem custo, o reenvio" e "We can
    offer a refund or an exchange" bloqueiam as duas ações. A negação só
    protege quando está entre o marcador e a ação ou colada a um deles ("não
    podemos reembolsar ou cancelar", "wir können leider nicht", "cannot");
    "se não chegar, podemos reenviar" continua sendo oferta.

32. **Idioma do cliente (16/09)**: no modo novo a resposta sai SEMPRE no
    idioma da última mensagem completa do cliente — a configuração "Sempre em
    X" da loja vale só para o clássico. A 1ª chamada devolve o código ISO
    (com região: de-AT, nl-BE, fr-BE) e `idiomaConfiavel`; o servidor
    normaliza (`nl-BE` → `nl`, guardando o original para exibir), grava em
    `atendimentoNovo.idioma` e só troca o alvo com uma mensagem completa. O
    que é "só dado" é decidido pelo SERVIDOR (`mensagemEhDados`), não pelo
    booleano da IA, e pelo significado classificado: desconta-se do corpo o
    endereço extraído, os nomes de produto, números/códigos, tamanhos e
    cortesias ("Danke", "Bedankt", "Merci"); se não sobra nada, é dado (foto,
    "ok", endereço, pedido/CEP/rastreio, produto ou tamanho isolados) e não
    altera idioma, original nem incerto quando já há um idioma confiável (sem
    nenhum ainda, entra só como incerto). Se sobra texto, a mensagem é uma
    solicitação — e troca o idioma — quando a intenção é pede_troca,
    pede_reembolso, pede_cancelamento, aceita, recusa ou pergunta_status,
    quando há ajustes ou motivo, ou quando aparecem palavras de ação/aceite/
    recusa/tamanho/pedido ("Bitte umtauschen", "Ik accepteer", "Je refuse",
    "Polo ist zu klein", "endereço + ik wil terugbetaling"). Nunca
    português/inglês por padrão. A 2ª chamada recebe
    "Escreva OBRIGATORIAMENTE em holandês (código "nl")" e devolve no JSON o
    idioma em que escreveu. Prova antes do envio (`conferirIdioma`): o
    código declarado tem de ser o alvo E a detecção local por palavras
    funcionais (de, nl, fr, it, es, en, pt) não pode apontar com força outro
    idioma; falhou → uma regeneração com instrução explícita; falhou de novo
    → fila humana "resposta gerada no idioma errado", sem rascunho e sem
    mudar a fase. Vale na primeira resposta, coleta/foto/endereço,
    regeneração (inclusive "só o texto"), aprovação (texto final, mesmo
    editado à mão), auto-envio e confirmação depois do aceite. Idioma fora
    do validador local (ex.: polonês): gera no idioma do cliente, confere só
    números/códigos e fica obrigatoriamente na aprovação humana
    (`aprovacaoObrigatoria`; nunca é agendado). Os validadores cobrem
    holandês (omruilen/ruilen/vervangen, opnieuw verzenden/nieuwe zending,
    terugbetaling, kortingscode/voucher, annuleren, aanbieden/wij kunnen/wij
    zullen/graag/kosteloos, niet/nog niet/geen/helaas) além de de, fr, it,
    es, en, pt.

33. **Parte 8 — migração dos casos históricos como "fase inferida" (16/09)**:
    a IA lê a conversa antiga inteira (cliente e loja) e infere jornada, fase
    (última que a loja de fato ofereceu, do catálogo), desfecho, percentual
    (só se escrito), motivo, categoria e produtos. O resultado vai para
    `ticket.inferenciaCentral` — um campo só da Central: status, categoria,
    relatório, mensagens e motor nunca mudam. Roda apenas por clique do dono
    (painel "Casos históricos" na Central ou "Inferir fase com IA" no modal de
    um caso), em lotes de até 40 (8 por chamada), com custo registrado por
    loja; nunca sozinha. Candidatos: SÓ casos antigos sem relatório —
    tickets do clássico (sem nenhum `atendimentoNovo`, nem em coleta) com
    categoria reembolso/troca/entrega ou motivo lido e sem relatório manual
    (`relatorioDia`/`relatorioLinha`/`relatorioTexto`): o relatório já é a
    fonte humana. As fases inferíveis são a lista explícita
    `FASES_MIGRAVEIS` (schema da IA, normalização e testes); confirmações
    nunca. O trecho enviado à IA é a conversa em ordem cronológica e, quando
    longa, início (assunto e primeiras mensagens) + fim (últimas mensagens,
    última oferta e encerramento), nunca só os primeiros caracteres; o texto FINAL de cada caso, já com marcadores e quebras, respeita o limite de 3.500 caracteres dentro de textoParaInferencia, e o inferidor não aplica nenhum corte adicional. Na Central, a linha do
    relatório manual tem prioridade sobre a inferência (desfecho, percentual,
    fase); a inferência entra como "inferida (IA)", separada nas métricas
    (contador inferidos, nunca passaram) e reembolso só inferido é
    "inferido" — fora do reembolsado de fato. Dá para refazer ou remover a
    inferência de um caso.

## Bloqueios implementados no servidor (seção 11)

- O prompt recebe só a fase atual e a ação permitida.
- `acao_proposta` diferente da fase permitida → fila humana.
- Percentual ou cupom no texto diferente do previsto para a fase → fila humana.
- O estado persistido no ticket manda; o texto do histórico não decide a fase.
- Transição só é gravada quando o e-mail sai com sucesso (`transicaoPendente`).
- Ticket antigo que entra no modo novo começa na triagem.
