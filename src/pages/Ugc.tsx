import { Video, Check } from 'lucide-react'

export default function Ugc() {
  return (
    <div className="empty" style={{ paddingTop: 60 }}>
      <div className="empty-icon" style={{ background: '#eef2ff', color: '#6366f1' }}><Video /></div>
      <h1 className="h1" style={{ fontSize: 24, marginBottom: 12 }}>Acompanhamento de criadores UGC</h1>
      <p className="muted" style={{ maxWidth: 440, lineHeight: 1.6, marginBottom: 22 }}>
        Organize os envios para criadores de conteúdo e acompanhe cada vídeo do combinado à publicação — dentro do atendo.
      </p>
      <div style={{ textAlign: 'left', marginBottom: 26 }}>
        {[
          'Pedidos de criadores detectados por tag da Shopify',
          'Status de cada conteúdo: combinado, recebido, publicado',
          'País, seguidores, @ do Instagram e link do conteúdo',
          'Prazos de entrega dos criadores acompanhados de perto',
        ].map(f => (
          <div key={f} className="row gap-8" style={{ padding: '4px 0', fontSize: 13.5, color: 'var(--text-2)' }}>
            <Check size={15} color="var(--green)" /> {f}
          </div>
        ))}
      </div>
      <button className="btn btn-primary">Em breve nesta versão</button>
    </div>
  )
}
