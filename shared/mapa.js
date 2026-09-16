/**
 * Mapa visual COMPLETO do pipeline — transcrito, item a item, da apresentação
 * do fluxo (Miro + exemplo externo "Central de Reembolsos"): cada jornada é
 * completa e independente, com o seu caminho inteiro até a conclusão, mesmo
 * quando uma ação do motor também aparece em outra jornada.
 *
 * Cada item:
 *  id        identificador estável e próprio (mesmo quando aponta para a mesma fase do motor)
 *  jornada   entrada | tamanho | qualidade | defeito_errado | nao_recebido | cancelamento
 *  grupo     subfluxo dentro da jornada (como na apresentação)
 *  segmento  recorte dos casos usado nas métricas deste item (ver segmentoDoRegistro)
 *  ordem     posição dentro da jornada
 *  titulo / descricao
 *  tipo      regra | coleta | decisao | oferta | confirmacao | humano
 *  fase      fase real do motor relacionada (null quando é só regra/decisão)
 *  destinos  ids dos itens para onde o fluxo pode seguir (aceite / recusa)
 *
 * Métricas: por ITEM (fase real × segmento do caso), nunca o total global da
 * fase. Regra e decisão nunca são contabilizadas como "fase enviada".
 */

export const TIPOS_MAPA = ['regra', 'coleta', 'decisao', 'oferta', 'confirmacao', 'humano']
export const JORNADAS_MAPA = ['entrada', 'tamanho', 'qualidade', 'defeito_errado', 'nao_recebido', 'cancelamento']

// segmento = a fatia dos casos que um item conta
export const SEGMENTOS = {
  todos: 'todos os casos',
  tamanho: 'jornada tamanho',
  qualidade: 'jornada qualidade / não gostou',
  defeito: 'defeito ou dano (fluxo "defeito")',
  errado: 'produto recebido errado (fluxo "errado")',
  nr_status: 'não recebido — só perguntou o status',
  nr_cancelamento: 'não recebido — pediu cancelamento/reembolso de pedido a caminho',
  nr_nao_chegou: 'pediu reembolso — não chegou ou voltou ao remetente',
  nr_recusado: 'recusou na porta ou voltou ao remetente',
  nr_entregue: 'marcado como entregue, sem receber',
  cancelamento: 'cancelamento de pedido não processado',
}

const J = jornada => { let n = 0; return (id, grupo, segmento, titulo, descricao, tipo, fase, destinos = []) => ({ id, jornada, grupo, segmento, ordem: ++n, titulo, descricao, tipo, fase, destinos }) }

const e = J('entrada')
const s = J('tamanho')
const q = J('qualidade')
const d = J('defeito_errado')
const r = J('nao_recebido')
const c = J('cancelamento')

export const MAPA_VISUAL = [
  /* ---------------- Entrada geral ---------------- */
  e('entry-request', 'Triagem obrigatória', 'todos', 'Chegou pedindo reembolso ou cancelamento', 'Registrar o pedido e confirmar se o cliente recebeu a compra.', 'decisao', null, ['entry-received']),
  e('entry-received', 'Triagem obrigatória', 'todos', 'Confirmar se recebeu o pedido', 'Separar produto recebido de atraso, recusa, retorno ao remetente ou pedido ainda não entregue.', 'decisao', null, ['entry-products', 'delivery-status-within-check', 'delivery-refund-only']),
  e('entry-products', 'Triagem obrigatória', 'todos', 'Perguntar o motivo e quais produtos', 'Perguntar quando o cliente ainda não tiver informado essas duas respostas.', 'coleta', 'coleta', ['entry-products-required']),
  e('entry-products-required', 'Triagem obrigatória', 'todos', 'Produtos são informação obrigatória', 'Não prosseguir sem saber exatamente quais produtos do pedido estão envolvidos.', 'regra', null, []),
  e('entry-first-response', 'Cadência do atendimento', 'todos', 'Primeira resposta pode ser rápida', 'Fazer a triagem inicial assim que possível.', 'regra', null, ['entry-interval-5h']),
  e('entry-interval-5h', 'Cadência do atendimento', 'todos', 'Demais respostas com intervalo de 5 horas', 'Depois que o cliente responder, respeitar o intervalo de 5 horas definido no Miro.', 'regra', null, []),
  e('rule-phase-only', 'Regras de execução e confirmação', 'todos', 'Nunca antecipar uma oferta', 'A IA só pode oferecer a opção que pertence à fase atual do pipeline.', 'regra', null, []),
  e('rule-email-confirm', 'Regras de execução e confirmação', 'todos', 'Confirmar por e-mail todo aceite', 'Quando o cliente aceitar uma solução, o dono aprova e sai a confirmação de que ela será processada.', 'humano', null, ['entry-confirm-exchange', 'entry-confirm-refund', 'entry-confirm-coupon', 'entry-confirm-cancel']),
  e('rule-exchange-confirm', 'Regras de execução e confirmação', 'todos', 'Troca: confirmar endereço e prazo', 'Informar entrega expressa em 4–11 dias e pedir confirmação do endereço completo (rua e número, código postal, cidade).', 'coleta', 'endereco', ['rule-email-confirm']),
  e('rule-refund-window', 'Regras de execução e confirmação', 'todos', 'Reembolso: informar prazo de 3–14 dias', 'O valor volta ao método de pagamento nesse prazo; se questionado, explicar que segue a lei do país.', 'regra', null, []),
  e('entry-confirm-exchange', 'Confirmação enviada', 'todos', 'Confirmação de troca ou reenvio', 'Aprovado: chega em 4–11 dias (5–11 na troca) com frete expresso; repete o endereço confirmado.', 'confirmacao', 'conf_troca', []),
  e('entry-confirm-refund', 'Confirmação enviada', 'todos', 'Confirmação de reembolso', 'Aprovado: valor em dinheiro e 3–14 dias para voltar ao método de pagamento.', 'confirmacao', 'conf_reembolso', []),
  e('entry-confirm-coupon', 'Confirmação enviada', 'todos', 'Confirmação de cupom', 'Código liberado, válido para qualquer pedido.', 'confirmacao', 'conf_cupom', []),
  e('entry-confirm-cancel', 'Confirmação enviada', 'todos', 'Confirmação de cancelamento', 'Pedido cancelado como direito do cliente; 3–14 dias para o dinheiro voltar.', 'confirmacao', 'conf_cancelamento', []),
  e('rule-coupon-10', 'Cupons padronizados', 'todos', 'Cupom 10OFF = 10% de desconto', 'Usar o código 10OFF para a oferta de 10%.', 'regra', null, []),
  e('rule-coupon-standard', 'Cupons padronizados', 'todos', 'Mesmo código em todas as lojas', 'Criar os cupons do fluxo (10, 15, 25, 30, 35, 40%) com códigos cadastrados por loja e disponibilizá-los para a IA.', 'regra', null, []),

  /* ---------------- Tamanho / caimento ---------------- */
  s('size-direction', 'Troca por tamanho', 'tamanho', 'Confirmar se ficou pequeno ou grande', 'Recomendar um tamanho maior quando ficou pequeno e menor quando ficou grande.', 'coleta', 'tam_ajuste', ['size-free-exchange']),
  s('size-free-exchange', 'Troca por tamanho', 'tamanho', 'Troca gratuita sem devolução', 'Cliente mantém o primeiro produto; novo envio expresso em 5–11 dias.', 'oferta', 'tam_troca', ['rule-exchange-confirm', 'size-exchange-20']),
  s('size-exchange-20', 'Troca por tamanho', 'tamanho', 'Troca gratuita + reembolso de 20%', 'Segunda proposta sem devolução do primeiro produto.', 'oferta', 'troca_20', ['rule-exchange-confirm', 'size-refund-40']),
  s('size-refund-40', 'Escada de reembolso', 'tamanho', 'Reembolso de 40% sem devolução', 'Explicar que a devolução e revisão levariam mais de 10 dias.', 'oferta', 'reemb_40', ['rule-email-confirm', 'size-refund-50']),
  s('size-refund-50', 'Escada de reembolso', 'tamanho', 'Reembolso de 50% sem devolução', 'Calcular e informar em dinheiro o custo do frete de volta (25% da compra, sem citar a porcentagem).', 'oferta', 'reemb_50', ['rule-email-confirm', 'size-refund-60']),
  s('size-refund-60', 'Escada de reembolso', 'tamanho', 'Reembolso de 60% sem devolução', 'Reforçar claramente os pontos negativos da devolução.', 'oferta', 'reemb_60', ['rule-email-confirm', 'size-refund-70']),
  s('size-refund-70', 'Escada de reembolso', 'tamanho', 'Reembolso de 70% sem devolução', 'Última proposta parcial; o custo de retorno torna a devolução financeiramente equivalente.', 'oferta', 'reemb_70', ['rule-email-confirm', 'size-full']),
  s('size-full', 'Escada de reembolso', 'tamanho', 'Reembolso de 100%', 'Fase final, decisão do dono, somente depois da recusa de todas as propostas anteriores.', 'humano', 'reemb_100', ['rule-email-confirm']),

  /* ---------------- Qualidade / não gostou ---------------- */
  q('quality-check', 'Alternativas antes do reembolso', 'qualidade', 'Qualidade, não gostou ou não explicou', 'Entrar neste caminho quando o produto foi recebido e o motivo se encaixa em uma dessas situações.', 'decisao', null, ['quality-alternative']),
  q('quality-alternative', 'Alternativas antes do reembolso', 'qualidade', 'Produto correto ou alternativa + 15% OFF', 'Oferecer outra cor, tamanho, modelo ou versão, sem devolução, entrega em 4–11 dias, cupom de 15%.', 'oferta', 'qual_troca', ['rule-exchange-confirm', 'quality-coupon-35']),
  q('quality-coupon-35', 'Alternativas antes do reembolso', 'qualidade', 'Cupom de 35% para qualquer pedido', 'O cliente fica com o produto e usa o desconto em uma nova compra.', 'oferta', 'qual_cupom_35', ['rule-email-confirm', 'quality-refund-25']),
  q('quality-refund-25', 'Escada de reembolso', 'qualidade', 'Reembolso de 25% sem devolução', 'Primeira proposta de devolução parcial do valor.', 'oferta', 'reemb_25', ['rule-email-confirm', 'quality-refund-40']),
  q('quality-refund-40', 'Escada de reembolso', 'qualidade', 'Reembolso de 40% sem devolução', 'Explicar que o reembolso integral só ocorreria depois do retorno e da revisão, em mais de 10 dias.', 'oferta', 'reemb_40', ['rule-email-confirm', 'quality-refund-50']),
  q('quality-refund-50', 'Escada de reembolso', 'qualidade', 'Reembolso de 50% sem devolução', 'Calcular e informar o custo do frete de volta em dinheiro, sem citar o percentual de 25%.', 'oferta', 'reemb_50', ['rule-email-confirm', 'quality-refund-60']),
  q('quality-refund-60', 'Escada de reembolso', 'qualidade', 'Reembolso de 60% sem devolução', 'Reforçar os pontos negativos da devolução e permitir que o cliente fique com o produto.', 'oferta', 'reemb_60', ['rule-email-confirm', 'quality-refund-70']),
  q('quality-refund-70', 'Escada de reembolso', 'qualidade', 'Reembolso de 70% sem devolução', 'Última proposta parcial antes do reembolso integral.', 'oferta', 'reemb_70', ['rule-email-confirm', 'quality-full']),
  q('quality-full', 'Escada de reembolso', 'qualidade', 'Reembolso de 100%', 'Fase final, decisão do dono, após a recusa de todas as opções anteriores.', 'humano', 'reemb_100', ['rule-email-confirm']),

  /* ---------------- Defeito / produto errado ---------------- */
  d('defect-photo', 'Produto com defeito ou danificado', 'defeito', 'Pedir foto comprovando o defeito', 'Aguardar a foto; nada é oferecido antes.', 'coleta', 'def_foto', ['defect-photo-review']),
  d('defect-photo-review', 'Produto com defeito ou danificado', 'defeito', 'A foto comprova o defeito?', 'Imagem não é prova: o dono confirma se a foto mostra o defeito; se não, pede outra foto.', 'humano', null, ['defect-free-exchange', 'defect-photo']),
  d('defect-free-exchange', 'Produto com defeito ou danificado', 'defeito', 'Troca gratuita sem devolução', 'Cliente mantém o primeiro produto; reenvio expresso em 5–11 dias.', 'oferta', 'def_troca', ['rule-exchange-confirm', 'defect-exchange-20']),
  d('defect-exchange-20', 'Produto com defeito ou danificado', 'defeito', 'Troca gratuita + reembolso de 20%', 'Segunda proposta caso a troca simples seja recusada.', 'oferta', 'troca_20', ['rule-exchange-confirm', 'defect-refund-40']),
  d('defect-refund-40', 'Produto com defeito ou danificado', 'defeito', 'Reembolso de 40% sem devolução', 'Explicar o prazo de retorno e revisão superior a 10 dias.', 'oferta', 'reemb_40', ['rule-email-confirm', 'defect-refund-50']),
  d('defect-refund-50', 'Produto com defeito ou danificado', 'defeito', 'Reembolso de 50% sem devolução', 'Informar em dinheiro o custo estimado do frete de retorno.', 'oferta', 'reemb_50', ['rule-email-confirm', 'defect-refund-60']),
  d('defect-refund-60', 'Produto com defeito ou danificado', 'defeito', 'Reembolso de 60% sem devolução', 'Reforçar os contras da devolução.', 'oferta', 'reemb_60', ['rule-email-confirm', 'defect-refund-70']),
  d('defect-refund-70', 'Produto com defeito ou danificado', 'defeito', 'Reembolso de 70% sem devolução', 'Última proposta parcial antes do integral.', 'oferta', 'reemb_70', ['rule-email-confirm', 'defect-full']),
  d('defect-full', 'Produto com defeito ou danificado', 'defeito', 'Reembolso de 100%', 'Encerramento, decisão do dono, depois da recusa de todas as alternativas.', 'humano', 'reemb_100', ['rule-email-confirm']),
  d('wrong-confirm', 'Produto recebido errado', 'errado', 'Confirmar o produto recebido errado', 'Validar o que foi comprado e o que chegou.', 'decisao', null, ['wrong-correct']),
  d('wrong-correct', 'Produto recebido errado', 'errado', 'Enviar o produto correto + 15% OFF', 'Sem devolver a primeira remessa; entrega expressa em 4–11 dias.', 'oferta', 'err_envio', ['rule-exchange-confirm', 'wrong-coupon-35']),
  d('wrong-coupon-35', 'Produto recebido errado', 'errado', 'Cupom de 35% para qualquer pedido', 'Cliente mantém o item recebido.', 'oferta', 'qual_cupom_35', ['rule-email-confirm', 'wrong-refund-25']),
  d('wrong-refund-25', 'Produto recebido errado', 'errado', 'Reembolso de 25% sem devolução', 'Primeira proposta de reembolso parcial.', 'oferta', 'reemb_25', ['rule-email-confirm', 'wrong-refund-40']),
  d('wrong-refund-40', 'Produto recebido errado', 'errado', 'Reembolso de 40% sem devolução', 'Explicar o prazo de retorno e inspeção.', 'oferta', 'reemb_40', ['rule-email-confirm', 'wrong-refund-50']),
  d('wrong-refund-50', 'Produto recebido errado', 'errado', 'Reembolso de 50% sem devolução', 'Informar o custo do frete de retorno em dinheiro.', 'oferta', 'reemb_50', ['rule-email-confirm', 'wrong-refund-60']),
  d('wrong-refund-60', 'Produto recebido errado', 'errado', 'Reembolso de 60% sem devolução', 'Reforçar os contras da devolução.', 'oferta', 'reemb_60', ['rule-email-confirm', 'wrong-refund-70']),
  d('wrong-refund-70', 'Produto recebido errado', 'errado', 'Reembolso de 70% sem devolução', 'Última proposta parcial.', 'oferta', 'reemb_70', ['rule-email-confirm', 'wrong-full']),
  d('wrong-full', 'Produto recebido errado', 'errado', 'Reembolso de 100%', 'Fase final, decisão do dono, após a recusa das alternativas.', 'humano', 'reemb_100', ['rule-email-confirm']),

  /* ---------------- Não recebeu / atraso ---------------- */
  r('delivery-status-within-check', 'Só perguntou o status — dentro do prazo', 'nr_status', 'Não pediu reembolso; só perguntou o status', 'Identificar que o contato é apenas uma consulta de entrega.', 'decisao', null, ['delivery-status-within']),
  r('delivery-status-within', 'Só perguntou o status — dentro do prazo', 'nr_status', 'Dentro do prazo: informar e acalmar', 'Informar o prazo e a provável data em que o pedido será recebido. Sem oferta.', 'regra', 'nc_no_prazo', []),
  r('delivery-status-late-check', 'Só perguntou o status — prazo vencido', 'nr_status', 'Não pediu reembolso; só perguntou o status', 'Confirmar que o prazo de entrega já terminou.', 'decisao', null, ['delivery-status-late']),
  r('delivery-status-late', 'Só perguntou o status — prazo vencido', 'nr_status', 'Aguardar até 5 dias úteis + cupom de 25%', 'Pedir desculpas, explicar o atraso logístico e garantir que o cliente não ficará no prejuízo.', 'oferta', 'nc_atrasado_25', ['rule-email-confirm', 'delivery-late-coupon40']),
  r('delivery-refund-only', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Atenção: somente se já pediu reembolso', 'Este caminho não deve ser usado para simples consulta de status.', 'regra', null, ['delivery-returned']),
  r('delivery-returned', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Não chegou ou voltou ao remetente', 'Confirmar a situação logística do pedido.', 'decisao', null, ['delivery-returned-reship30']),
  r('delivery-returned-reship30', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Reenvio expresso + cupom de 30%', 'O reembolso só ocorre após o retorno às instalações (pode levar mais de 17 dias); oferecer reenvio em 4–11 dias.', 'oferta', 'nr_reenvio_30', ['delivery-returned-address', 'delivery-returned-reship20']),
  r('delivery-returned-address', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Se aceitar: confirmar endereço completo', 'Pedir a confirmação de todos os dados de entrega.', 'coleta', 'endereco', ['delivery-returned-report']),
  r('delivery-returned-report', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Destacar reenvio e endereço no relatório', 'Registrar o acompanhamento com o endereço completo (ação manual do dono).', 'regra', null, ['rule-email-confirm']),
  r('delivery-returned-reship20', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Se recusar: reenvio expresso + reembolso de 20%', 'Reenvio em 4–11 dias mais 20% em dinheiro.', 'oferta', 'nr_reenvio_20', ['delivery-returned-address', 'delivery-returned-reship35']),
  r('delivery-returned-reship35', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Reenvio expresso + reembolso de 35%', 'Reforçar os pontos negativos do retorno e fazer a última proposta de reenvio.', 'oferta', 'nr_reenvio_35', ['delivery-returned-address', 'delivery-returned-full']),
  r('delivery-returned-full', 'Pediu reembolso — não chegou ou voltou ao remetente', 'nr_nao_chegou', 'Reembolso de 100%', 'Decisão do dono depois da recusa das propostas de reenvio.', 'humano', 'reemb_100', ['rule-email-confirm']),
  r('delivery-delivered-scan', 'Marcado como entregue, mas cliente não recebeu', 'nr_entregue', 'Pedido marcado como entregue; cliente alega que não chegou', 'Abrir verificação antes de avançar.', 'decisao', null, ['delivery-delivered-wait2']),
  r('delivery-delivered-wait2', 'Marcado como entregue, mas cliente não recebeu', 'nr_entregue', 'Aguardar 2 dias e consultar vizinhos', 'A transportadora pode marcar a entrega antes da chegada; pedir também que confira com vizinhos ou na portaria. Sem oferta.', 'regra', 'nr_entregue_aguardar', ['delivery-delivered-report']),
  r('delivery-delivered-report', 'Marcado como entregue, mas cliente não recebeu', 'nr_entregue', 'Após 2 dias sem entrega: destacar no relatório', 'Confirmar que não houve entrega e seguir para a resolução.', 'regra', null, ['delivery-delivered-reship20']),
  r('delivery-delivered-reship20', 'Marcado como entregue, mas cliente não recebeu', 'nr_entregue', 'Reenvio expresso + reembolso de 20%', 'Após os 2 dias sem entrega: explicar o retorno superior a 17 dias e fazer a primeira proposta de reenvio expresso com 20%.', 'oferta', 'nr_reenvio_20', ['delivery-returned-address', 'delivery-delivered-reship35']),
  r('delivery-delivered-reship35', 'Marcado como entregue, mas cliente não recebeu', 'nr_entregue', 'Reenvio expresso + reembolso de 35%', 'Reforçar os pontos negativos do retorno e fazer a segunda proposta.', 'oferta', 'nr_reenvio_35', ['delivery-returned-address', 'delivery-delivered-full']),
  r('delivery-delivered-full', 'Marcado como entregue, mas cliente não recebeu', 'nr_entregue', 'Reembolso de 100%', 'Decisão do dono depois da recusa das propostas de reenvio.', 'humano', 'reemb_100', ['rule-email-confirm']),
  r('delivery-refused-eligibility', 'Recusou na porta ou voltou ao remetente', 'nr_recusado', 'Confirmar recusa na porta ou retorno ao remetente', 'Usar este caminho somente quando o cliente disser que recusou a entrega ou que o pedido voltou.', 'decisao', null, ['delivery-refused-reship30']),
  r('delivery-refused-reship30', 'Recusou na porta ou voltou ao remetente', 'nr_recusado', 'Reenvio expresso + cupom de 30%', 'Primeira proposta: reenvio em 4–11 dias mais cupom de 30% (mesma oferta inicial da seção 7).', 'oferta', 'nr_reenvio_30', ['delivery-returned-address', 'delivery-refused-20']),
  r('delivery-refused-20', 'Recusou na porta ou voltou ao remetente', 'nr_recusado', 'Reenvio expresso + reembolso de 20%', 'Explicar que o reembolso integral depende do retorno, que pode levar mais de 17 dias.', 'oferta', 'nr_reenvio_20', ['delivery-returned-address', 'delivery-refused-35']),
  r('delivery-refused-35', 'Recusou na porta ou voltou ao remetente', 'nr_recusado', 'Reenvio expresso + reembolso de 35%', 'Reforçar os pontos negativos e oferecer a segunda resolução.', 'oferta', 'nr_reenvio_35', ['delivery-returned-address', 'delivery-refused-full']),
  r('delivery-refused-full', 'Recusou na porta ou voltou ao remetente', 'nr_recusado', 'Reembolso de 100%', 'Decisão do dono; informar prazo de 3–14 dias para retorno ao método de pagamento.', 'humano', 'reemb_100', ['rule-email-confirm']),
  r('delivery-never-arrived-within', 'Pedido não chegou — processado e ainda no prazo', 'nr_cancelamento', 'O pedido ainda não chegou', 'Verificar processamento e prazo completo de dias úteis.', 'decisao', null, ['delivery-processed-within']),
  r('delivery-processed-within', 'Pedido não chegou — processado e ainda no prazo', 'nr_cancelamento', 'Já processado e prazo ainda não terminou', 'Informar a provável data e pedir que aguarde mais um pouco.', 'regra', 'nc_no_prazo', ['delivery-processed-terms']),
  r('delivery-processed-terms', 'Pedido não chegou — processado e ainda no prazo', 'nr_cancelamento', 'Se insistir no reembolso: explicar o prazo', 'O reembolso só é possível depois de vencido o prazo de entrega previsto nos termos.', 'regra', null, ['delivery-deadline-passed']),
  r('delivery-deadline-passed', 'Pedido não chegou — prazo completo vencido', 'nr_cancelamento', 'Prazo completo de dias úteis terminou', 'Confirmar que o pedido não chegou dentro do período contratado.', 'decisao', null, ['delivery-late-wait']),
  r('delivery-late-wait', 'Pedido não chegou — prazo completo vencido', 'nr_cancelamento', 'Aguardar até 5 dias úteis + cupom de 25%', 'Pedir desculpas pelo atraso logístico e garantir que o cliente não ficará no prejuízo.', 'oferta', 'nc_atrasado_25', ['rule-email-confirm', 'delivery-late-coupon40']),
  r('delivery-late-coupon40', 'Pedido não chegou — prazo completo vencido', 'nr_cancelamento', 'Cupom de 40% para a próxima compra', 'Resolução adicional se o cliente pedir cancelamento; aguardar 5 horas após a resposta.', 'oferta', 'nc_cupom_40', ['rule-email-confirm', 'delivery-late-full']),
  r('delivery-late-full', 'Pedido não chegou — prazo completo vencido', 'nr_cancelamento', 'Reembolso de 100%', 'Decisão do dono se o cliente recusar e mantiver o pedido de cancelamento.', 'humano', 'reemb_100', ['rule-email-confirm']),
  r('delivery-unprocessed-check', 'Pedido ainda não processado', 'cancelamento', 'Confirmar que ainda não foi processado', 'Aplicar o cancelamento padrão.', 'decisao', null, ['delivery-unprocessed-cancel']),
  r('delivery-unprocessed-cancel', 'Pedido ainda não processado', 'cancelamento', 'Cancelar como direito do cliente', 'O dono confirma o cancelamento e destaca no relatório para impedir o processamento.', 'humano', 'cancel_nao_processado', ['rule-email-confirm']),

  /* ---------------- Cancelamento ---------------- */
  c('cancel-check', 'Cancelamento padrão', 'cancelamento', 'Confirmar que o pedido não foi processado', 'Verificar a situação operacional antes de responder.', 'decisao', null, ['cancel-complete']),
  c('cancel-complete', 'Cancelamento padrão', 'cancelamento', 'Cancelar e destacar no relatório', 'Responder que o pedido foi cancelado como direito do cliente e impedir o processamento.', 'humano', 'cancel_nao_processado', ['rule-email-confirm']),
]

export const itemPorId = Object.fromEntries(MAPA_VISUAL.map(i => [i.id, i]))

/** Itens de uma jornada, na ordem do mapa. */
export const itensDaJornada = jornada => MAPA_VISUAL.filter(i => i.jornada === jornada).sort((a, b) => a.ordem - b.ordem)

/** Ids das fases do motor que o mapa referencia (para conferir contra FASES). */
export const fasesDoMapa = () => [...new Set(MAPA_VISUAL.map(i => i.fase).filter(Boolean))]

/**
 * Segmento de um caso (registro da Central): pelo fluxo/subfluxo reais do motor
 * quando existem; no clássico, pela categoria do motivo.
 */
export function segmentoDoRegistro(r) {
  if (r.fluxo) {
    switch (r.fluxo) {
      case 'tamanho': return 'tamanho'
      case 'qualidade': return 'qualidade'
      case 'defeito': return 'defeito'
      case 'errado': return 'errado'
      case 'cancelamento': return 'cancelamento'
      case 'entregue_nao_recebido': return 'nr_entregue'
      case 'nao_recebido_reembolso': return r.subfluxo === 'recusado' ? 'nr_recusado' : 'nr_nao_chegou'
      case 'nao_recebido_status': return r.subfluxo === 'cancelamento' ? 'nr_cancelamento' : 'nr_status'
      default: return null
    }
  }
  switch (r.motivoCategoria) {
    case 'tamanho': case 'tamanho_pequeno': case 'tamanho_grande': return 'tamanho'
    case 'qualidade': case 'nao_gostou': return 'qualidade'
    case 'defeito': return 'defeito'
    case 'errado': return 'errado'
    case 'atraso': return 'nr_status'
    case 'nao_recebeu': case 'nao_recebido': return 'nr_nao_chegou'
    case 'arrependimento': case 'cancelamento': return 'cancelamento'
    default: return r.jornada === 'qualidade' ? 'qualidade' : r.jornada === 'tamanho' ? 'tamanho' : r.jornada === 'nao_recebido' ? 'nr_nao_chegou' : r.jornada === 'cancelamento' ? 'cancelamento' : null
  }
}

/** Registros que pertencem ao segmento de um item ("todos" = todos). */
export const registrosDoSegmento = (registros, segmento) => segmento === 'todos' ? registros : registros.filter(r => segmentoDoRegistro(r) === segmento)

/**
 * Métricas por ITEM visual: a fase real do item medida só dentro do segmento do
 * item (fluxo/subfluxo do caso). Um caso de Tamanho no 40% conta no "40%" de
 * Tamanho e em nenhum outro. Itens sem fase não têm métricas (regra/decisão).
 * `metricasPorFase` é a função da Central — o cálculo é o mesmo, só recortado.
 */
export function metricasPorItem(registros, fases, metricasPorFase, relacaoComFase) {
  const cache = new Map()
  const porSegmento = seg => {
    if (!cache.has(seg)) cache.set(seg, { regs: registrosDoSegmento(registros, seg), m: metricasPorFase(registrosDoSegmento(registros, seg), fases) })
    return cache.get(seg)
  }
  const saida = {}
  for (const i of MAPA_VISUAL) {
    if (!i.fase) continue
    const { regs, m } = porSegmento(i.segmento)
    const base = m[i.fase] ?? { passaram: 0, pararam: 0, avancaram: 0, emAberto: 0, valorPorMoeda: {}, inferidos: 0, manuais: 0 }
    const grupo = { passaram: [], pararam: [], avancaram: [], emAberto: [] }
    for (const r of regs) {
      const rel = relacaoComFase(r, i.fase)
      if (rel) {
        grupo.passaram.push(r.chave)
        if (rel === 'pararam') grupo.pararam.push(r.chave); else if (rel === 'avancaram') grupo.avancaram.push(r.chave); else grupo.emAberto.push(r.chave)
      } else if (r.confirmacaoEnviada === i.fase) { grupo.passaram.push(r.chave); grupo.pararam.push(r.chave) }
    }
    const totalSeg = regs.length
    saida[i.id] = { ...base, id: i.id, fase: i.fase, segmento: i.segmento, totalSegmento: totalSeg, pctPassaram: totalSeg ? Math.round((base.passaram / totalSeg) * 1000) / 10 : 0, chaves: grupo }
  }
  return saida
}

/** Problemas de consistência do mapa (lista vazia = ok). */
export function validarMapa(fases) {
  const erros = []
  const ids = new Set()
  for (const i of MAPA_VISUAL) {
    if (ids.has(i.id)) erros.push(`id duplicado: ${i.id}`)
    ids.add(i.id)
    if (!TIPOS_MAPA.includes(i.tipo)) erros.push(`${i.id}: tipo inválido ${i.tipo}`)
    if (!JORNADAS_MAPA.includes(i.jornada)) erros.push(`${i.id}: jornada inválida`)
    if (!SEGMENTOS[i.segmento]) erros.push(`${i.id}: segmento inválido ${i.segmento}`)
    if (i.fase && !fases[i.fase]) erros.push(`${i.id}: fase inexistente ${i.fase}`)
    if ((i.tipo === 'regra' || i.tipo === 'decisao') && i.fase && fases[i.fase]?.oferta) erros.push(`${i.id}: regra/decisão não pode apontar para fase com oferta`)
  }
  for (const i of MAPA_VISUAL) for (const d of i.destinos) {
    if (!ids.has(d)) { erros.push(`${i.id}: destino inexistente ${d}`); continue }
    const alvo = itemPorId[d]
    // cada jornada é independente: só aponta para si mesma ou para a Entrada geral (aceite/endereço/confirmação);
    // a Entrada geral é a triagem e é a única que pode encaminhar para uma jornada
    if (i.jornada !== 'entrada' && alvo.jornada !== i.jornada && alvo.jornada !== 'entrada') erros.push(`${i.id} (${i.jornada}) aponta para ${d} em outra jornada (${alvo.jornada})`)
  }
  for (const id of Object.keys(fases)) if (!MAPA_VISUAL.some(i => i.fase === id)) erros.push(`fase do motor fora do mapa: ${id}`)
  for (const j of JORNADAS_MAPA) {
    const ordens = itensDaJornada(j).map(i => i.ordem)
    ordens.forEach((o, k) => { if (o !== k + 1) erros.push(`${j}: ordem ${o} fora de sequência`) })
  }
  return erros
}
