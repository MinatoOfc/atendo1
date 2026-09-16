/**
 * Mapa visual COMPLETO do pipeline — cada etapa, regra, decisão, ramificação,
 * oferta, confirmação e decisão humana do mapa mental, na ordem do mapa.
 *
 * É o catálogo que a página externa (e qualquer visão do pipeline) desenha.
 * Não confundir com FASES (server/atendimento.js): FASES são só os estados que
 * o motor grava e envia. Aqui cada item diz:
 *  id        identificador estável
 *  jornada   entrada | tamanho | qualidade | defeito_errado | nao_recebido | cancelamento
 *  grupo     subfluxo dentro da jornada
 *  ordem     posição dentro da jornada
 *  titulo / descricao
 *  tipo      regra | coleta | decisao | oferta | confirmacao | humano
 *  fase      id da fase real do motor relacionada (null quando é só regra/decisão)
 *  destinos  ids dos itens para onde o fluxo pode seguir
 *
 * Só itens com `fase` podem carregar métricas de "fase enviada"; regra e decisão
 * nunca são contabilizadas como enviadas.
 */

export const TIPOS_MAPA = ['regra', 'coleta', 'decisao', 'oferta', 'confirmacao', 'humano']

const item = (id, jornada, grupo, ordem, titulo, descricao, tipo, fase, destinos = []) => ({ id, jornada, grupo, ordem, titulo, descricao, tipo, fase, destinos })

export const MAPA_VISUAL = [
  /* ---------------- Entrada geral ---------------- */
  item('regra_cadencia', 'entrada', 'Regras gerais', 1, 'Cadência das respostas', 'A primeira resposta pode ser rápida; as seguintes saem com intervalo de 5 horas depois de o cliente responder.', 'regra', null, ['triagem']),
  item('regra_produtos', 'entrada', 'Regras gerais', 2, 'Produtos obrigatórios', 'O cliente tem de informar quais produtos estão envolvidos; nada prossegue sem essa informação.', 'regra', null, ['coleta_produtos']),
  item('regra_nao_antecipar', 'entrada', 'Regras gerais', 3, 'Nunca antecipar oferta', 'A IA nunca oferece uma opção que não esteja na fase correta: uma etapa por resposta, sem saltos.', 'regra', null, []),
  item('regra_cupons', 'entrada', 'Regras gerais', 4, 'Cupons padronizados', 'Cupons por percentual (10, 15, 25, 30, 35, 40%) com código cadastrado por loja; nunca inventados.', 'regra', null, []),
  item('regra_idioma', 'entrada', 'Regras gerais', 5, 'Idioma do cliente', 'A resposta sai sempre no idioma da última mensagem completa do cliente.', 'regra', null, []),
  item('triagem', 'entrada', 'Triagem', 6, 'Triagem obrigatória', 'Classificar a mensagem (intenção, motivo, situação da entrega) e escolher a jornada.', 'decisao', null, ['coleta_pedido', 'coleta_produtos', 'coleta_motivo', 'tam_ajuste', 'qual_troca', 'def_foto', 'err_envio', 'nc_decisao', 'cancel_decisao']),
  item('coleta_pedido', 'entrada', 'Coleta', 7, 'Confirmar o pedido', 'Sem pedido localizado, pedir o número do pedido ou o e-mail da compra antes de qualquer oferta.', 'coleta', 'coleta', ['triagem']),
  item('coleta_produtos', 'entrada', 'Coleta', 8, 'Coletar os produtos', 'Perguntar quais produtos do pedido estão envolvidos (obrigatório com mais de um item).', 'coleta', 'coleta', ['triagem']),
  item('coleta_motivo', 'entrada', 'Coleta', 9, 'Coletar o motivo', 'Perguntar o motivo da devolução/reembolso quando o cliente não disse.', 'coleta', 'coleta', ['triagem']),
  item('regra_aceite', 'entrada', 'Aceite', 10, 'Todo aceite é confirmado', 'Sempre que o cliente concorda com uma fase, o caso vai ao dono e sai um e-mail confirmando que será processado.', 'regra', null, ['dono_aceite']),
  item('endereco', 'entrada', 'Aceite', 11, 'Confirmar endereço completo', 'Troca ou reenvio: pedir rua e número, código postal e cidade; qualquer texto não é endereço.', 'coleta', 'endereco', ['dono_aceite']),
  item('dono_aceite', 'entrada', 'Aceite', 12, 'Decisão do dono', 'O dono aprova o aceite (ou decide o 100% / cancelamento) antes da confirmação.', 'humano', null, ['conf_troca', 'conf_reembolso', 'conf_cupom', 'conf_cancelamento']),
  item('conf_troca', 'entrada', 'Confirmação', 13, 'Confirmação de troca/reenvio', 'Chega em 4 a 11 dias (5 a 11 na troca) com frete expresso; repete o endereço confirmado.', 'confirmacao', 'conf_troca', ['encerramento']),
  item('conf_reembolso', 'entrada', 'Confirmação', 14, 'Confirmação de reembolso', '3 a 14 dias para o dinheiro voltar ao método de pagamento; se questionar, seguimos a lei do país.', 'confirmacao', 'conf_reembolso', ['encerramento']),
  item('conf_cupom', 'entrada', 'Confirmação', 15, 'Confirmação de cupom', 'Código liberado, válido para qualquer pedido.', 'confirmacao', 'conf_cupom', ['encerramento']),
  item('conf_cancelamento', 'entrada', 'Confirmação', 16, 'Confirmação de cancelamento', 'Pedido cancelado como direito do cliente; 3 a 14 dias para o dinheiro voltar.', 'confirmacao', 'conf_cancelamento', ['encerramento']),
  item('regra_prazos', 'entrada', 'Regras de prazo', 17, 'Prazos', 'Troca/reenvio: 4 a 11 dias (5 a 11 na troca por tamanho/defeito). Dinheiro: 3 a 14 dias.', 'regra', null, []),
  item('regra_relatorio', 'entrada', 'Regras de prazo', 18, 'Destacar no relatório', 'Reenvio e casos de não recebimento são destacados no relatório manual com o endereço completo (ação manual do dono).', 'regra', null, []),
  item('encerramento', 'entrada', 'Encerramento', 19, 'Encerramento', 'Agradecimento encerra a conversa; mensagem nova depois da confirmação vai ao dono.', 'regra', null, []),

  /* ---------------- Tamanho / caimento ---------------- */
  item('tam_ajuste', 'tamanho', 'Troca por tamanho', 1, 'Perguntar se ficou pequeno ou grande', 'Para cada produto, perguntar se ficou pequeno ou grande.', 'coleta', 'tam_ajuste', ['tam_recomendar']),
  item('tam_recomendar', 'tamanho', 'Troca por tamanho', 2, 'Recomendar o tamanho', 'Ficou pequeno → um tamanho maior; ficou grande → um tamanho menor.', 'regra', null, ['tam_troca']),
  item('tam_troca', 'tamanho', 'Troca por tamanho', 3, 'Troca gratuita pelo tamanho certo', 'Sem devolver o produto atual, frete expresso, 5 a 11 dias.', 'oferta', 'tam_troca', ['endereco', 'tam_decisao_1']),
  item('tam_decisao_1', 'tamanho', 'Troca por tamanho', 4, 'Rejeitou a troca e pede reembolso?', 'Caso rejeite e peça o reembolso mesmo assim.', 'decisao', null, ['troca_20']),
  item('troca_20', 'tamanho', 'Troca por tamanho', 5, 'Troca gratuita + 20% de reembolso', 'Troca sem devolução mais 20% do valor pago em dinheiro.', 'oferta', 'troca_20', ['endereco', 'tam_decisao_2']),
  item('tam_decisao_2', 'tamanho', 'Troca por tamanho', 6, 'Recusou de novo?', 'Entra na escada de reembolso pelo 40% (o 25% não é oferecido a quem já recusou troca + 20%).', 'decisao', null, ['reemb_40']),

  /* ---------------- Qualidade / não gostou ---------------- */
  item('qual_troca', 'qualidade', 'Qualidade / não gostou', 1, 'Troca por outra cor/tamanho/modelo + cupom de 15%', 'Gratuita, sem devolver a primeira remessa, frete expresso 4 a 11 dias, cupom de 15%.', 'oferta', 'qual_troca', ['endereco', 'qual_decisao_1']),
  item('qual_decisao_1', 'qualidade', 'Qualidade / não gostou', 2, 'Rejeitou a troca e pede reembolso?', 'Caso rejeite a troca e peça o reembolso mesmo assim.', 'decisao', null, ['qual_cupom_35']),
  item('qual_cupom_35', 'qualidade', 'Qualidade / não gostou', 3, 'Cupom de 35% ficando com o produto', 'Cupom de 35% para qualquer pedido; o cliente fica com o produto.', 'oferta', 'qual_cupom_35', ['dono_aceite', 'qual_decisao_2']),
  item('qual_decisao_2', 'qualidade', 'Qualidade / não gostou', 4, 'Rejeitou e pede reembolso?', 'Caso rejeite e peça o reembolso.', 'decisao', null, ['reemb_25']),
  item('reemb_25', 'qualidade', 'Escada de reembolso', 5, 'Reembolso de 25%', 'O cliente fica com o produto.', 'oferta', 'reemb_25', ['dono_aceite', 'esc_decisao_25']),
  item('esc_decisao_25', 'qualidade', 'Escada de reembolso', 6, 'Rejeitou o 25%?', 'Caso rejeite e peça reembolso maior.', 'decisao', null, ['reemb_40']),
  item('reemb_40', 'qualidade', 'Escada de reembolso', 7, 'Reembolso de 40%', 'Explicar que a devolução só seria reembolsada depois da revisão (mais de 10 dias); 40% sem devolução.', 'oferta', 'reemb_40', ['dono_aceite', 'esc_decisao_40']),
  item('esc_decisao_40', 'qualidade', 'Escada de reembolso', 8, 'Rejeitou o 40%?', 'Caso rejeite.', 'decisao', null, ['reemb_50']),
  item('reemb_50', 'qualidade', 'Escada de reembolso', 9, 'Reembolso de 50%', 'Informar o frete de devolução em dinheiro (nunca a porcentagem); 50% ficando com o produto.', 'oferta', 'reemb_50', ['dono_aceite', 'esc_decisao_50']),
  item('esc_decisao_50', 'qualidade', 'Escada de reembolso', 10, 'Rejeitou o 50%?', 'Caso rejeite.', 'decisao', null, ['reemb_60']),
  item('reemb_60', 'qualidade', 'Escada de reembolso', 11, 'Reembolso de 60%', 'Reforçar os pontos negativos da devolução; 60% ficando com o produto.', 'oferta', 'reemb_60', ['dono_aceite', 'esc_decisao_60']),
  item('esc_decisao_60', 'qualidade', 'Escada de reembolso', 12, 'Rejeitou o 60%?', 'Caso rejeite.', 'decisao', null, ['reemb_70']),
  item('reemb_70', 'qualidade', 'Escada de reembolso', 13, 'Reembolso de 70%', 'Descontado o frete de retorno, a devolução dá na mesma financeiramente; 70% ficando com o produto.', 'oferta', 'reemb_70', ['dono_aceite', 'esc_decisao_70']),
  item('esc_decisao_70', 'qualidade', 'Escada de reembolso', 14, 'Rejeitou o 70%?', 'Recusou todas as alternativas.', 'decisao', null, ['reemb_100']),
  item('reemb_100', 'qualidade', 'Escada de reembolso', 15, 'Reembolso de 100% — decisão do dono', 'Nunca é enviado pela IA: vai direto para o dono decidir.', 'humano', 'reemb_100', ['dono_aceite']),

  /* ---------------- Defeito / produto errado ---------------- */
  item('def_foto', 'defeito_errado', 'Defeito', 1, 'Pedir foto do defeito', 'Pedir foto comprovando o defeito ou dano; nada é oferecido antes.', 'coleta', 'def_foto', ['def_validacao']),
  item('def_validacao', 'defeito_errado', 'Defeito', 2, 'A foto comprova?', 'Imagem não é prova: o dono confirma se a foto mostra o defeito; se não, pede outra foto.', 'humano', null, ['def_troca', 'def_foto']),
  item('def_troca', 'defeito_errado', 'Defeito', 3, 'Troca gratuita do produto com defeito', 'Sem devolver o recebido, frete expresso, 5 a 11 dias.', 'oferta', 'def_troca', ['endereco', 'def_decisao']),
  item('def_decisao', 'defeito_errado', 'Defeito', 4, 'Rejeitou a troca e pede reembolso?', 'Segue para troca + 20% e depois a escada pelo 40%.', 'decisao', null, ['troca_20']),
  item('err_envio', 'defeito_errado', 'Produto errado', 5, 'Enviar o produto correto + cupom de 15%', 'Envio gratuito do produto correto, sem devolver o recebido, 4 a 11 dias, cupom de 15%.', 'oferta', 'err_envio', ['endereco', 'err_decisao']),
  item('err_decisao', 'defeito_errado', 'Produto errado', 6, 'Rejeitou e pede reembolso?', 'Segue pela escada da qualidade: cupom de 35% → 25% → 40% …', 'decisao', null, ['qual_cupom_35']),

  /* ---------------- Não recebeu / atraso ---------------- */
  item('nc_decisao', 'nao_recebido', 'Triagem da entrega', 1, 'Situação da entrega', 'Dentro do prazo? Atrasado? Marcado como entregue sem receber? Já chegou pedindo reembolso?', 'decisao', null, ['nc_no_prazo', 'nc_atrasado_25', 'nr_entregue_aguardar', 'nr_reenvio_30']),
  item('nc_no_prazo', 'nao_recebido', 'Só perguntou o status', 2, 'Dentro do prazo — acalmar e informar a data', 'Informar o prazo e a data provável; cancelamento/reembolso só depois do fim do prazo. Sem oferta.', 'regra', 'nc_no_prazo', ['nc_decisao']),
  item('nc_atrasado_25', 'nao_recebido', 'Só perguntou o status', 3, 'Atrasado — pedir 5 dias úteis + cupom de 25%', 'Desculpas; a loja não deixa o cliente no prejuízo; aguardar no máximo mais 5 dias úteis; cupom de 25%.', 'oferta', 'nc_atrasado_25', ['dono_aceite', 'nc_decisao_25']),
  item('nc_decisao_25', 'nao_recebido', 'Só perguntou o status', 4, 'Recusou aguardar?', 'Segue para o cupom de 40% (a etapa de 25% não é repetida).', 'decisao', null, ['nc_cupom_40']),
  item('nc_cupom_40', 'nao_recebido', 'Ainda não chegou', 5, 'Cupom de 40% para aguardar mais um pouco', 'Compensação por aguardar.', 'oferta', 'nc_cupom_40', ['dono_aceite', 'nc_decisao_40']),
  item('nc_decisao_40', 'nao_recebido', 'Ainda não chegou', 6, 'Recusou o cupom de 40%?', 'Recusou todas as alternativas.', 'decisao', null, ['reemb_100']),
  item('nr_reenvio_30', 'nao_recebido', 'Já chegou pedindo reembolso', 7, 'Reenvio expresso + cupom de 30%', 'O reembolso só depois de o pedido retornar (mais de 17 dias); reenvio 4 a 11 dias mais cupom de 30%.', 'oferta', 'nr_reenvio_30', ['endereco', 'nr_decisao_30']),
  item('nr_decisao_30', 'nao_recebido', 'Já chegou pedindo reembolso', 8, 'Recusou o reenvio + 30%?', 'Caso recuse.', 'decisao', null, ['nr_reenvio_20']),
  item('nr_entregue_aguardar', 'nao_recebido', 'Marcado como entregue', 9, 'Marcado como entregue — aguardar 2 dias', 'A transportadora às vezes marca antes; aguardar mais 2 dias e verificar com vizinhos ou portaria. Sem oferta.', 'regra', 'nr_entregue_aguardar', ['nr_decisao_entregue']),
  item('nr_decisao_entregue', 'nao_recebido', 'Marcado como entregue', 10, 'Passaram 2 dias sem o pacote?', 'Destacar no relatório e seguir para o reenvio + 35%.', 'decisao', null, ['nr_reenvio_35']),
  item('nr_reenvio_20', 'nao_recebido', 'Reenvio com reembolso', 11, 'Reenvio expresso + reembolso de 20%', 'Reenvio 4 a 11 dias mais 20% em dinheiro.', 'oferta', 'nr_reenvio_20', ['endereco', 'nr_decisao_20']),
  item('nr_decisao_20', 'nao_recebido', 'Reenvio com reembolso', 12, 'Recusou o reenvio + 20%?', 'Caso recuse.', 'decisao', null, ['nr_reenvio_35']),
  item('nr_reenvio_35', 'nao_recebido', 'Reenvio com reembolso', 13, 'Reenvio expresso + reembolso de 35%', 'Reenvio 4 a 11 dias mais 35% em dinheiro.', 'oferta', 'nr_reenvio_35', ['endereco', 'nr_decisao_35']),
  item('nr_decisao_35', 'nao_recebido', 'Reenvio com reembolso', 14, 'Recusou o reenvio + 35%?', 'Recusou todas as alternativas.', 'decisao', null, ['reemb_100']),

  /* ---------------- Cancelamento ---------------- */
  item('cancel_decisao', 'cancelamento', 'Cancelamento', 1, 'O pedido já foi processado?', 'Não processado → decisão do dono; já enviado → tratar como não recebido.', 'decisao', null, ['cancel_nao_processado', 'nc_decisao']),
  item('cancel_nao_processado', 'cancelamento', 'Cancelamento', 2, 'Cancelamento — decisão do dono', 'Pedido ainda não processado: o dono decide e responde que foi cancelado como direito do cliente.', 'humano', 'cancel_nao_processado', ['dono_aceite']),
]

/** Itens de uma jornada, na ordem do mapa. */
export const itensDaJornada = jornada => MAPA_VISUAL.filter(i => i.jornada === jornada).sort((a, b) => a.ordem - b.ordem)

/** Ids das fases do motor que o mapa referencia (para conferir contra FASES). */
export const fasesDoMapa = () => [...new Set(MAPA_VISUAL.map(i => i.fase).filter(Boolean))]

/** Problemas de consistência do mapa (lista vazia = ok). */
export function validarMapa(fases) {
  const erros = []
  const ids = new Set()
  for (const i of MAPA_VISUAL) {
    if (ids.has(i.id)) erros.push(`id duplicado: ${i.id}`)
    ids.add(i.id)
    if (!TIPOS_MAPA.includes(i.tipo)) erros.push(`${i.id}: tipo inválido ${i.tipo}`)
    if (i.fase && !fases[i.fase]) erros.push(`${i.id}: fase inexistente ${i.fase}`)
    if ((i.tipo === 'regra' || i.tipo === 'decisao') && i.fase && fases[i.fase]?.oferta) erros.push(`${i.id}: regra/decisão não pode apontar para fase com oferta`)
  }
  for (const i of MAPA_VISUAL) for (const d of i.destinos) if (!ids.has(d)) erros.push(`${i.id}: destino inexistente ${d}`)
  for (const id of Object.keys(fases)) if (!MAPA_VISUAL.some(i => i.fase === id)) erros.push(`fase do motor fora do mapa: ${id}`)
  for (const j of [...new Set(MAPA_VISUAL.map(i => i.jornada))]) {
    const ordens = itensDaJornada(j).map(i => i.ordem)
    ordens.forEach((o, k) => { if (o !== k + 1) erros.push(`${j}: ordem ${o} fora de sequência`) })
  }
  return erros
}
