import { useState } from 'react'
import { Link2, Check, Copy, X } from 'lucide-react'
import { useStore } from '../store'

/** Link externo do pipeline: somente leitura, token longo e revogável. */
export function LinkPipeline({ compacto = false }: { compacto?: boolean }) {
  const s = useStore()
  const [copiado, setCopiado] = useState(false)
  const url = s.pipelineLink ? window.location.origin + s.pipelineLink : null
  return (
    <div className="card mb-16" style={{ padding: 16 }}>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row gap-8"><Link2 size={14} color="var(--purple)" /><b style={{ fontSize: 13.5 }}>Pipeline em link externo</b></div>
        {!url && <button className="btn btn-sm btn-primary" onClick={() => s.configurarPipelineLink('gerar')}><Link2 size={13} /> Gerar link externo</button>}
      </div>
      {url && (
        <div className="row gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <input readOnly value={url} onFocus={e => e.currentTarget.select()}
            style={{ flex: 1, minWidth: 220, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, background: 'var(--panel-soft)', color: 'var(--text-2)' }} />
          <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(url); setCopiado(true); window.setTimeout(() => setCopiado(false), 2500) }}>
            {copiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar link</>}
          </button>
          <button className="btn btn-sm" title="Troca o token: o endereço antigo para de funcionar na hora" onClick={() => s.configurarPipelineLink('novo')}>Gerar novo link</button>
          <button className="btn btn-sm btn-danger" title="O link para de funcionar imediatamente" onClick={() => s.configurarPipelineLink('revogar')}><X size={13} /> Revogar link</button>
        </div>
      )}
      {!compacto && <p className="muted-sm" style={{ marginTop: 8, lineHeight: 1.5, marginBottom: 0 }}>
        Página "Pipeline completo" com as mesmas jornadas, fases, indicadores e filtros da Central, calculados no servidor sobre os dados reais.
        Somente leitura: não aprova, não envia, não altera fases nem pedidos, e não mostra nome, e-mail, endereço ou texto das conversas.
        Revogar ou gerar novo link derruba o endereço antigo na hora.
      </p>}
      {compacto && <p className="muted-sm" style={{ marginTop: 8, marginBottom: 0 }}>Como o link do relatório manual: abre sem login, é somente leitura, não mostra dados pessoais e pode ser revogado na hora.</p>}
    </div>
  )
}
