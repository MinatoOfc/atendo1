/**
 * Regra única de "produto informado" (mapa: "O CLIENTE TEM QUE INFORMAR QUAIS
 * PRODUTOS SEMPRE, NÃO PROSSEGUIR SEM ESSA INFO").
 *
 * Só conta quando o CLIENTE informou (marca produtosInformados === true, gravada
 * apenas quando uma citação dele casou com um item real do pedido) E existe
 * produto na lista. Texto em produtosAfetados sem a marca — preenchimento antigo
 * pelo catálogo, estado migrado, dado manual — NÃO é prova. Usada pelo motor,
 * pela Central, pelas rotas do servidor e pelo laço de envio automático.
 */
export const produtoFoiInformado = an => an?.produtosInformados === true && (an?.produtosAfetados?.length ?? 0) > 0
