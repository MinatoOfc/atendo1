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

## Bloqueios implementados no servidor (seção 11)

- O prompt recebe só a fase atual e a ação permitida.
- `acao_proposta` diferente da fase permitida → fila humana.
- Percentual ou cupom no texto diferente do previsto para a fase → fila humana.
- O estado persistido no ticket manda; o texto do histórico não decide a fase.
- Transição só é gravada quando o e-mail sai com sucesso (`transicaoPendente`).
- Ticket antigo que entra no modo novo começa na triagem.
