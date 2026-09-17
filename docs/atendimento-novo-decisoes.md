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

34. **Alternância antigo × novo por loja (16/09)**: o modo muda só pela rota
    própria (`POST /api/lojas/:id/modo`), individual por loja, com validação
    no servidor antes de ativar o novo — conta de e-mail própria da loja,
    prazo em dias úteis e todos os cupons que o mapa usa (15, 25, 30, 35,
    40%) — e confirmação explícita; a rota genérica da loja recusa
    `modoAtendimento`. Cada troca grava `modoDesde` e uma entrada em
    `modoHistorico` (modo anterior, novo, usuário, loja, data). O envio
    automático do novo nunca liga com a troca. O clássico nunca some. Cada
    conversa nasce com `ticket.motor` (modo da loja naquele dia) e continua
    nele até terminar: trocar a loja vale só para conversas novas; ao voltar
    ao clássico, as conversas do novo seguem suas fases com estado,
    histórico, endereço, foto e decisão pendente preservados. Migrar uma
    conversa aberta do clássico para o novo é ação manual, individual e
    confirmada (`POST /api/tickets/:id/migrar-motor`), começa pela triagem e
    fica em `motorHistorico`; nunca automática, nunca ao contrário.

35. **Pipeline em link externo (16/09)**: `GET /p/:wsId/:token` (página) e
    `/dados` (JSON), somente leitura, com o MESMO cálculo da Central
    (`shared/central.js`, `server/pipeline-externo.js`) sobre os dados reais
    — nada simulado. Token de 32 bytes por workspace (`tokenPipeline`),
    comparado em tempo constante; gerar novo ou revogar derruba o endereço
    antigo na hora; o token não vai para o HTML nem para logs; workspace
    errado dá 404. O JSON sai sanitizado: sem nome, e-mail, endereço,
    telefone, texto de conversa, rascunho ou resposta; a busca externa olha
    só pedido, produto, motivo e loja. Rascunho pendente, inferência e
    correção manual continuam fora das métricas de fases enviadas.

36. **Mapa visual completo (16/09)**: `shared/mapa.js` é o catálogo de TODOS os
    itens da apresentação do mapa (Miro + site de exemplo) — 85 itens em 6
    jornadas, cada uma COMPLETA e INDEPENDENTE: Entrada geral (16), Tamanho
    (8: ajuste → troca → troca+20% → 40 → 50 → 60 → 70 → 100), Qualidade (9:
    troca alternativa → cupom 35% → 25 → 40 → 50 → 60 → 70 → 100), Defeito /
    produto errado (18: dois subfluxos inteiros — foto → validação humana →
    troca → troca+20% → escada; confirmar produto → produto correto+15% →
    35% → 25% → escada), Não recebeu / atraso (32: só status dentro/fora do
    prazo, não chegou/voltou, marcado entregue, recusado na porta,
    processado no prazo, prazo vencido, não processado) e Cancelamento (2).
    Nenhum cartão compacta dois passos do mapa; uma fase do motor pode
    aparecer em várias jornadas (troca_20, reemb_40…100, qual_cupom_35,
    nr_reenvio_*), sempre com id próprio por jornada. Cada item tem id
    estável, jornada, grupo, **segmento** (que casos ele conta), ordem,
    título, descrição, tipo, fase real (quando existe) e destinos; destinos
    só apontam para a própria jornada ou para a Entrada geral (aceite,
    endereço, confirmações); só a Entrada geral encaminha para uma jornada.
    As 28 fases do motor aparecem todas (59 itens com fase, 26 regras e
    decisões sem fase); 26 fases são efetivamente enviáveis (100% e
    cancelamento são decisão do dono). `test/mapa.test.mjs` guarda a lista
    fechada e ordenada (falha em remoção, omissão, duplicata ou troca de
    ordem), as contagens por jornada e a independência das jornadas.

36b. **Métricas por item visual, não por fase global**: `metricasPorItem`
    (shared/mapa.js) cruza a fase real do registro com o **segmento** do
    item (fluxo/subfluxo reais do motor, guardados no registro da Central:
    tamanho, qualidade, defeito, errado, nr_status, nr_cancelamento,
    nr_nao_chegou, nr_recusado, nr_entregue, cancelamento). Um caso de
    Tamanho parado no 40% conta só no "40%" de Tamanho; Qualidade só em
    Qualidade; Defeito só em Defeito; Produto errado nunca entra nos números
    de Defeito, mesmo compartilhando a jornada técnica. O funil de cada
    jornada é coerente (nenhuma etapa maior que a anterior; parou + avançou
    + em aberto = passaram) e o percentual é sobre os casos daquele caminho.
    A página externa e o JSON (`porItem`) usam só isso; o total global da
    fase não aparece em cartão nenhum.

37. **Link externo sem texto livre**: o JSON público leva só categoria fechada
    do motivo (rótulo gerado no servidor: tamanho pequeno/grande, qualidade,
    não gostou, defeito, produto errado, atraso, não recebido, cancelamento,
    não informado, outro), produto só do catálogo do pedido (itens da
    Shopify) e número do pedido só em dígitos; nada vem da conversa, da
    inferência da IA ou de dados antigos. A busca externa ignora o nome.

38. **Envio automático no piloto**: toda ativação do modo novo zera
    `novoEnvioAutomatico` (mesmo se estava ligado antes de voltar ao
    clássico); ligar exige loja no novo, confirmação explícita e a variável
    `ATENDO_LIBERAR_AUTOENVIO=1`. Sem ela o bloqueio vale em três pontos:
    (a) no agendamento — `prepararRascunhoNovo` só cria `enviaEm` com
    `envioAutomaticoLiberado()`; (b) no laço de auto-envio — reconfere antes
    de enviar; se não estiver liberado, não envia, remove `enviaEm` das
    conversas do motor novo, mantém o rascunho em Aprovações e registra
    "envio automático bloqueado durante o piloto"; (c) no arranque do
    servidor — todas as lojas passam a desligado (um `true` persistido é
    neutralizado), os agendamentos do motor novo são cancelados e o clássico
    não é tocado. `test/piloto.test.mjs` sobe o servidor sem a variável com
    um estado salvo (loja no novo com automático ligado, conversa do novo
    com `enviaEm` vencido, conversa clássica agendada) e prova tudo isso.

39. **Marcado como entregue, mas não recebeu — correção pelo Miro (16/09)**: o
    caminho obrigatório é aguardar 2 dias → (recebeu: encerrar) → destacar no
    relatório → reenvio expresso + 20% → reenvio expresso + 35% → 100% com o
    dono. O motor saltava do "aguardar" direto para o 35%; `nr_entregue_aguardar`
    agora sai só para `nr_reenvio_20` (e `nr_reenvio_20 → nr_reenvio_35 →
    reemb_100` fica como estava; aceite de 20% ou 35% pede o endereço completo
    e vai ao dono). Os 2 dias são 48 h contadas do envio REAL do e-mail da
    fase (horário gravado em `historicoEtapas`, no primeiro envio): "ainda não
    chegou" antes disso repete a fase dizendo que o período não terminou e não
    reinicia a contagem; sem horário confiável o motor não avança sozinho;
    "recebi" encerra a qualquer momento. Nenhuma mensagem leva do "aguardar"
    ao 35%. O mapa externo liga relatório → 20% → 35% → 100%, sem atalho. A
    rota de ensaio `/api/simular-email` (só com ATENDO_SIMULAR=1) aceita um
    horário simulado para os testes de prazo; e-mails reais usam o relógio do
    servidor. Testes: unitário (motor) e ponta a ponta pelo pipeline real.

40. **Página externa com a estrutura da referência e a cara do Atendo (16/09)**:
    a página do link externo reproduz a composição, as proporções, a navegação
    e o comportamento do painel operacional de referência (barra lateral fixa
    de 272px com as seis jornadas, contagem, valor e percentual; somente uma
    jornada visível por vez; cabeçalho com "Mapa do fluxo / Todos os pedidos" e
    "Limpar ajustes"; barra de filtros fixa ao rolar; aviso "Funil conectado aos
    dados disponíveis"; cinco cartões do funil; faixa de cinco indicadores;
    "Percentual por tipo de caso" com barras; fluxo em coluna de 621px com linha
    vertical e cartões de quatro métricas; painel "Leitura da jornada" de 300px
    fixo à direita; drawer de 720px com quatro métricas, busca, "Ver:
    passaram/pararam/avançaram", lista de pedidos e seletor de fase atribuída;
    tabela de nove colunas). Cores (tema escuro padrão do Atendo), tipografia, botões, bordas e sombras são os
    do Atendo, não os da referência. Dados sempre reais: pedidos, casos, moedas
    separadas (nunca somadas), fases enviadas, inferências e correções
    marcadas. Regras e decisões ocupam cartões iguais, com números derivados do
    caminho e fora das métricas oficiais. Ajustes de fase feitos na página ficam
    só no navegador (localStorage); "Limpar ajustes" remove apenas isso; nada
    escreve no servidor. Testes visuais permanentes (Playwright,
    `npm run test:visual`, fora do `npm test`): capturas de regressão em
    1280×720 e 390×844 (Entrada, Tamanho, Não recebeu, drawer, Todos os
    pedidos) com números e datas mascarados e 0,5% de diferença máxima, mais a
    comparação estrutural com a referência (medidas, contagens, fixação e
    comportamento; cores ignoradas de propósito) e capturas lado a lado em
    test/visual/saida.

41. **Produto informado pelo cliente é obrigatório em TODO o motor (16/09)**: o
    mapa diz "o cliente tem que informar quais produtos sempre, não prosseguir
    sem essa info". O motor não preenche mais o produto pelo catálogo do pedido
    (pedido de um item não é o cliente informando) e só aceita citação que casa
    com um item real do pedido (`casarProdutos`). Trava global antes de qualquer
    saída (`travaProduto`, em `irPara` e nos demais desfechos de `decidir`):
    sem produto, nenhuma fase, oferta, aceite, endereço, escalada ao dono,
    reembolso de 100%, cancelamento ou confirmação sai — só a coleta perguntando
    o produto, com a fase pendente gravada em `proximaAposColeta` (`__aceite__`
    e `__humano__` para aceite e escalada). Quando o produto chega, o motor
    retoma exatamente a pendência, sem repetir, adiantar ou pular. Vale para as
    oito jornadas e para estados antigos: no arranque, conversas abertas do
    modo novo sem a marca `produtosInformados` e com pedido de item único têm o
    produto preenchido automaticamente apagado e voltam a pedir o produto. Na
    Central, "produto identificado" passa a ser só o informado pelo cliente.
    Testes: motor (um item, vários itens, oito jornadas, 100% e cancelamento
    sem produto, aceite sem produto, retomada exata, coleta sem oferta),
    Central (item único não identifica) e ponta a ponta pelo pipeline real.

42. **Testes visuais: navegador padrão = Chrome**: as capturas base foram geradas
    no Google Chrome, então `npm run test:visual` usa o canal "chrome" por
    padrão; `PW_CANAL=chromium` força o Chromium empacotado (só diagnóstico —
    as capturas não batem nele). O servidor de ensaio (porta 8798) encerra
    sozinho quando o processo que o iniciou termina.

43. **Prova de produto: regra única e trava em todas as saídas (16/09)**:
    `produtoFoiInformado(an)` (shared/produto.js) = `produtosInformados === true`
    E lista não vazia — texto em `produtosAfetados` sem a marca não é prova. É a
    fonte para o motor (`semProduto`), a Central (`produtoIdentificado`) e o
    servidor. A trava vale antes de `aguardando = "humano"`, do processamento
    do endereço, de `/api/tickets/:id/novo/confirmar`, de `/api/tickets/:id/aprovar`,
    do envio automático, de `prepararRascunhoNovo` (todo rascunho que não seja a
    coleta vira a pergunta do produto, com a fase pendente preservada) e do
    envio real (`enviarResposta`). Casos antigos sem prova são migrados no
    arranque (`migrarCasosSemProduto`) e no laço de envio: a fase ou decisão
    pendente é preservada em `proximaAposColeta` (`__aceite__`, `__humano__`
    ou a fase), o rascunho antigo de oferta é removido com o agendamento, o caso
    sai da mão do dono (nada é confirmado nem aprovado) e só a pergunta do
    produto é gerada (`gerarColetasDeProduto`). Estados com vários itens NÃO
    são marcados automaticamente como informados: sem prova, perguntam de novo.
    Com o produto informado, `retomarPendencia` retoma exatamente o que estava
    pendente. Testes de rota no pipeline real: rascunho antigo (manual e
    automático), aceite aguardando o dono, fase endereço, vários itens sem marca,
    escalada antiga, Central não identificando, retomada exata.

44. **Testes visuais encerram sozinhos**: o servidor de ensaio abre uma porta de
    controle (8796) e o `globalTeardown` do Playwright chama `POST /encerrar`;
    o servidor fecha o HTTP e sai com código 0, e o teardown espera a porta 8798
    fechar. Rede de segurança: vida máxima de 20 min e sinais do sistema.

45. **Motor pela conversa, nunca pela transição pendente (16/09)**: `enviarResposta`
    e `/api/tickets/:id/aprovar` identificam o modo novo por `motorDaConversa(t)`.
    Uma conversa do novo sem `transicaoPendente` (classificação falhou, IA
    pausada, rascunho falhou, com o dono sem ação automática) continua do novo:
    usa só a conta da própria loja; sem produto comprovadamente informado nada
    sai (única exceção: coleta cujos faltantes contenham `produtos`); com
    produto e resposta humana sem transição, envia pela conta própria sem
    registrar transição inexistente; `confirmarTransicao` só roda quando a
    transição existe. Em `/aprovar` a trava vem antes do bloco da transição:
    sem transição ou com outra fase, bloqueia, preserva o motivo humano / a
    fase pendente e prepara a coleta do produto (`exigirColetaDeProduto`; manual
    quando a IA está pausada ou indisponível). `mandarParaHumanoNovo` sem
    produto deixa como única resposta permitida a coleta escrita à mão
    (`exigirColetaManualDeProduto`), com o motivo preservado. O teardown dos
    testes visuais lança erro se 8798 ou 8796 continuar aberta.

46. **Cadência fixa do modo novo (16/09)**: `PRIMEIRA_RESPOSTA_MS = 3 min` e
    `CADENCIA_MS = 5 h` (server/atendimento.js). `horarioMinimoEnvio(t, agora)` =
    `max(agora, últimaMensagemDoCliente + prazo)`: 3 min enquanto a loja ainda
    não respondeu, 5 h depois disso. O prazo parte do horário da mensagem do
    cliente, não do fim do processamento; se o servidor processar depois do
    prazo, sai na hora; uma mensagem nova reinicia o relógio (a mais recente
    manda) — e o rascunho é recalculado. O laço de envio reconfere a cadência
    no momento do envio: nunca sai antes, e a fase só muda depois do envio
    real. `config.atrasoMinutos` NÃO entra no modo novo (é só do clássico; a
    interface diz isso). Textos da interface: "Primeira resposta: automática
    após 3 minutos. Depois que o cliente responder: próxima resposta
    automática após 5 horas. Uma nova mensagem reinicia o relógio." Testes:
    unitários (2min59 não / 3min sim; recebida há 2 min → +1 min; há mais de
    3 min → já; 4h59 não / 5h sim; nova mensagem reagenda; várias mensagens
    reiniciam) e ponta a ponta pelo pipeline real com relógio simulado (nada
    sai antes; fase e histórico intactos; clássico usa o seu atraso).

47. **Separação definitiva antigo × novo (16/09)**: ao ativar o novo numa loja,
    o servidor grava `novoAtivadoEm` (data e hora exatas). Toda conversa nasce
    com `motorAtendimento: "classico" | "novo"` gravado DEFINITIVAMENTE
    (`motorDeNascimento`): "novo" só quando a loja está no novo E a data real
    do primeiro e-mail do cliente (data da caixa de entrada — `primeiroEmailEm`,
    nunca a de importação, processamento ou o horário atual) é posterior a
    `novoAtivadoEm`. Depois de gravado, o campo nunca é recalculado: nem por
    resposta nova, reabertura, importação tardia, edição de status, alternância
    de modo ou assunto/pedido coincidente. Conversas antigas sem o campo são
    fixadas no arranque (`fixarMotorDasConversas`) com o que já tinham; lojas no
    novo sem data ganham `modoDesde` (ou o arranque) como ativação. NÃO existe
    migração de conversa para o novo: a rota devolve 410 e o botão foi removido;
    a inferência da Central segue só para métricas. O agendador (3 min / 5 h) e
    `prepararRascunhoNovo`/`processarNovo` só aceitam `motorAtendimento === "novo"`;
    conversa clássica nunca recebe fase, rascunho, histórico ou `enviaEm` do novo.
    Motores diferentes nunca se fundem; a resposta numa thread antiga volta à
    conversa clássica original (`acharConversa`). Testes ponta a ponta: um
    minuto antes/depois da ativação, importação tardia pela data real, resposta
    em thread antiga, alternância novo → antigo → novo, clássico atrasado há
    dias fora do agendador, inferência sem mudar o motor, rota 410 e fontes sem
    botão, sem fusão entre motores.

48. **Base de Conhecimento exclusiva do clássico (17/09)**: políticas, FAQs,
    comportamentos da IA, biblioteca, sugestões do histórico e aprendizado das
    respostas manuais (`estiloExemplos`) só entram em conversas com
    `motorAtendimento: "classico"`. `montarSystem`, `processarEmailIA`,
    `processarEmail` e `gerarRascunhoLocal` lançam erro se receberem conversa
    do novo. `promptClassificar` e `promptEscrever` recusam qualquer objeto com
    campos da Base ou o estado completo (`assertSemBaseDeConhecimento`) e o
    servidor entrega ao escritor do novo só `configDoNovo` (nome e assinatura
    da loja). O novo recebe apenas fase e instrução do mapa, estado da conversa,
    mensagens necessárias, dados do pedido, produtos citados, valores, moeda,
    prazo, cupons exigidos pela fase, idioma, nome e assinatura. Uma regra da
    Base nunca complementa, antecipa ou contradiz uma fase; se a IA do novo
    falhar, o caso vai ao dono sem fallback clássico. Conversa clássica segue
    usando a Base mesmo com a loja no novo. Interface: aviso na Base de
    Conhecimento e em Configurações ("fonte de verdade do atendimento
    clássico"; loja no novo → alterações não modificam o novo pipeline).
    Teste ponta a ponta com marcadores conflitantes ("OFERECER 100%
    IMEDIATAMENTE") cadastrados via rotas: aparecem no prompt real e na
    resposta simulada do clássico; nunca nos prompts capturados de
    classificação e escrita do novo (1ª resposta, regeneração, aprovação,
    recusa, aceite, confirmação, autoenvio); fase, cupom e escada intactos;
    falha da IA do novo → dono, sem prompt clássico; clássico continua com a
    Base depois de a loja ativar o novo.

49. **"Exigir minha aprovação após o aceite" (17/09)** — `exigirAprovacaoAceiteNovo`
    por loja, padrão `true`. NÃO liga nem desliga a negociação: nos dois modos a
    IA classifica, coleta, faz só a oferta da fase, avança uma etapa por recusa,
    respeita idioma e cadência (3 min / 5 h) e nunca escala só por recusa,
    insistência, mensagem nova ou avanço de fase. A opção decide só o que
    acontece DEPOIS do aceite de uma proposta (25%, 40%, cupom, troca, reenvio —
    não é o 100%). No aceite, `conclusaoPendente` fotografa jornada, fase,
    tipo, percentual, valor/moeda (calculados pelo servidor), cupom, produtos,
    endereço, data e texto do aceite, histórico das fases e o MODO
    (`manual`/`automatico`) — o modo nunca é recalculado depois. Pré-condições
    (`faltaParaConcluir`): produto informado e do pedido, motivo/ajuste quando
    exigidos, foto validada no defeito, endereço completo em troca/reenvio,
    aceite = última oferta realmente enviada, cupom cadastrado, idioma com
    validação local, caixa própria; qualquer falta → dono. **Manual**: o caso
    vai ao dono com "Cliente aceitou [proposta] — aguardando sua aprovação.";
    nada é confirmado antes; o card mostra a solução e os botões "Aprovar e
    gerar confirmação" e "Recusar / corrigir"; ao aprovar, só a confirmação da
    proposta aceita é gerada e validada, autorizada e agendada para as 5 h da
    última mensagem (se já passou, sai já); a fase muda só com o envio real; o
    relatório continua manual. **Automático** (desligar exige piloto liberado,
    automação geral e da loja, caixa própria, prazo e cupons, e confirmação com
    o texto "A IA continuará negociando normalmente…"; fica na auditoria
    `aceiteHistorico`): o aceite não vai ao dono; troca/reenvio pede o endereço
    antes e retoma a mesma solução; a confirmação passa por todos os
    validadores e sai 5 h após a mensagem mais recente; mensagem nova durante
    a espera reagenda (recusa/novo pedido cancela e vai ao dono); só depois do
    envio real: transição, conclusão fechada e UMA linha no relatório diário
    (`relatorioAuto`, chave = id do aceite; idempotente entre agendador,
    reinício, mensagem repetida e nova tentativa). Falha de geração, validação
    ou entrega: não avança, não conclui, não registra, vai ao dono com o motivo.
    Sempre humanos: 100%, cancelamento, foto de defeito, casos sensíveis, fora
    do mapa, divergência aceite × oferta, produto/pedido/cupom/endereço/idioma
    faltando, falha de IA ou envio, loja sem caixa própria. Toda ativação do
    novo e o piloto sem liberação voltam a exigir aprovação; mudar a opção não
    toca aceites já pendentes. Clássico intacto. Sem movimentação financeira:
    "processar" = enviar a confirmação válida e registrar no relatório.

50. **Três travas da conclusão após o aceite (17/09)**:

    a) **Mensagem nova durante a confirmação já autorizada** (automática OU
    manual já aprovada pelo dono): a confirmação antiga nunca sai sem analisar a
    mensagem. O agendamento é cancelado, a mensagem é reclassificada e o mesmo
    `conclusaoPendente.id` é preservado. Agradecimento, reforço do aceite, dado
    complementar ou pergunta sobre o prazo mantêm a solução, regeram e revalidam
    a confirmação e reiniciam as 5 h a partir da nova mensagem — no manual, a
    autorização do dono é preservada e não há segunda aprovação. Recusa, outro
    percentual, outra solução ou voltar atrás cancelam definitivamente:
    `enviaEm`, rascunho e transição de confirmação removidos, conclusão
    `cancelada`, caso com o dono, sem avançar para a próxima oferta e sem
    relatório.

    b) **Estado incompatível da configuração**: `podeConclusaoAutomatica` exige
    loja no novo, envio automático da loja, automação geral, piloto liberado e
    prontidão. `neutralizarConclusaoAutomatica` roda ao desligar o envio
    automático da loja, ao desligar a automação geral e no arranque: a aprovação
    volta a `true` (com auditoria em `aceiteHistorico`, incluindo o motivo), as
    conclusões automáticas ainda não enviadas perdem o agendamento e vão para o
    dono com "Conclusão automática interrompida porque…", preservando a solução
    aceita, sem confirmação e sem relatório. Religar a automação não retoma as
    interrompidas; novos aceites passam a ser manuais.

    c) **Idempotência durável na queda do servidor**: antes de chamar o canal,
    a confirmação ganha um Message-ID ESTÁVEL (`atendo-<id do aceite>`), o
    status vira `enviando` e o estado é gravado de verdade (`await gravarAgora`).
    Depois do envio confirmado: `concluida`, id da mensagem, fase enviada, linha
    idempotente e gravação imediata. No arranque,
    `reconciliarEnviosInterrompidos` nunca reenvia às cegas: consulta a caixa de
    enviados pelo Message-ID (`procurarEnviado` em server/mail.js) — se a
    mensagem existir, fecha a conclusão e o relatório sem reenviar; se não
    existir ou não der para conferir, vai ao dono ("O servidor foi interrompido
    durante o envio da confirmação. Verifique a caixa de enviados antes de
    tentar novamente."), sem reenvio e sem relatório. `test/queda.test.mjs` sobe
    o servidor num processo filho que morre (exit 7) exatamente depois de o
    canal confirmar e antes da gravação, e prova no reinício: um único e-mail,
    uma única confirmação, uma única linha e o caso reconciliado — e, no
    cenário sem comprovação, o caso com o dono sem reenvio nem relatório.

51. **Segurança da conclusão após o aceite — auditoria (17/09)**:

    a) **Gravação crítica que falha fechado**: toda gravação de um workspace
    entra numa fila serializada (`enfileirarGravacao`), então uma gravação
    antiga e lenta nunca termina depois e sobrescreve o estado crítico mais
    recente. `gravarCritico` espera a fila, grava e PROPAGA o erro; o envio da
    confirmação usa essa versão. Se `status: enviando` + Message-ID não puderem
    ser persistidos, o estado em memória é revertido e nenhum canal (SMTP,
    Resend ou simulado) é chamado: sem e-mail, sem fase, sem relatório, caso
    com o dono e o motivo exato do erro de persistência na mensagem.
    `gravarAgora` continua existindo, com retentativa, para as ações normais.

    b) **Estado final atômico**: a confirmação passou a finalizar tudo em
    memória (transição `conf_*`, conclusão `concluida`, Message-ID, resposta,
    origem, `respondidoEm`, status `enviado`, `enviaEm` removido, agendamento
    limpo e — só no automático de verdade — a linha do relatório) e fazer UMA
    gravação crítica no fim. Queda entre o canal e essa gravação deixa
    `enviando` persistido, que o arranque reconcilia. Para estado legado meio
    gravado (conclusão `concluida` ou fase `conf_*` com o ticket ainda em
    `aprovacao` ou com `enviaEm`), `corrigirConfirmacoesMeioGravadas` fecha o
    ticket no arranque, sem reenviar, sem segunda transição e sem segunda linha.

    c) **Interrupção vira conclusão manual de verdade**: ao perder os
    pré-requisitos, `neutralizarConclusaoAutomatica` preserva o id e os dados da
    solução, grava `modoOriginal: automatico` e o histórico da conversão em
    `autoHistorico`, muda `modo` para `manual` e marca
    `relatorioAutomaticoProibido` — `concluirAposEnvio` nunca cria `relatorioAuto`
    para essa conclusão, mesmo depois da aprovação do dono. O rascunho e a
    transição de confirmação antigos são invalidados: o clique do dono regera e
    revalida a confirmação. `/novo/confirmar` roda `faltaParaConcluir` em
    qualquer conclusão viva (inclusive `interrompida` e `aguardando_dados`), não
    só em `aguardando_aprovacao`.

    d) **Conclusões que ainda aguardam dados não são quebradas**: quando a
    interrupção pega uma troca ou reenvio em `aguardando_dados`, a coleta de
    endereço continua — a pergunta pendente fica em Aprovações para envio
    manual, a conversa segue esperando o cliente, o endereço é validado
    normalmente e só depois o caso vai ao dono. Nada fica preso em
    `aguardando: humano` e nenhuma etapa é pulada. Uma conclusão `interrompida`
    nunca volta a ser automática.

    e) **Toda perda de pré-requisito protege na hora**: além de desligar o envio
    automático da loja e a automação geral, `DELETE /api/lojas/:id/email`
    neutraliza imediatamente as conclusões automáticas daquela loja, e o
    agendador faz uma última conferência de `podeConclusaoAutomatica` logo antes
    do envio — se os pré-requisitos caíram, converte com segurança para
    aprovação manual em vez de enviar.

    Os ganchos de teste (`ATENDO_TESTE_QUEDA` com os pontos `antes`,
    `depois-memoria` e `depois`, `ATENDO_TESTE_FALHA_GRAVACAO` e
    `ATENDO_TESTE_ENVIOS`) só funcionam com `ATENDO_SIMULAR=1` e o canal
    simulado, nunca pela presença acidental de uma variável em produção.

    f) **A invariável é aplicada na hora, em toda alteração de configuração**:
    `conferirPreRequisitosAutomaticos(req, motivo, lojaId)` é a conferência única
    e SÍNCRONA, chamada depois de cada mudança capaz de invalidar
    `podeConclusaoAutomatica` e sempre ANTES de salvar e de a rota responder —
    então a própria resposta HTTP já mostra `exigirAprovacaoAceiteNovo: true`, a
    conclusão pendente com `modo: manual`, `modoOriginal: automatico`,
    `relatorioAutomaticoProibido: true`, o agendamento removido e a auditoria com
    o motivo exato. Pontos cobertos: `/api/lojas` (envio automático, prazo de
    entrega, cupons e a própria aprovação, numa conferência única no fim da
    rota), `/api/lojas/:id/modo` (principalmente ao voltar para clássico),
    `DELETE /api/lojas/:id/email` (remove a conta → limpa `cacheContas` →
    confere/neutraliza sincronamente → salva → responde, sem `setTimeout`) e
    `/api/config` (automação geral). Conclusões já `concluida` não são tocadas e
    uma conclusão em `enviando` continua sob a reconciliação por Message-ID.
    Recolocar cupom, prazo, e-mail ou o modo novo NÃO religa a conclusão
    automática: o dono precisa desligar a aprovação de novo, com confirmação. As
    conversas seguem no motor em que nasceram. A conferência do agendador
    imediatamente antes do envio continua como defesa adicional.

39. **Fusão de conversas só no mesmo motor**: `fundirConversasDuplicadas`
    exige `motorDaConversa(a) === motorDaConversa(b)`; clássico e novo nunca
    se unem automaticamente. O Vite encaminha `/p` para o servidor, então o
    link copiado abre também em desenvolvimento.

## Bloqueios implementados no servidor (seção 11)

- O prompt recebe só a fase atual e a ação permitida.
- `acao_proposta` diferente da fase permitida → fila humana.
- Percentual ou cupom no texto diferente do previsto para a fase → fila humana.
- O estado persistido no ticket manda; o texto do histórico não decide a fase.
- Transição só é gravada quando o e-mail sai com sucesso (`transicaoPendente`).
- Ticket antigo que entra no modo novo começa na triagem.
