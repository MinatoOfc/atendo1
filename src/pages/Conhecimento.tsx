import { useState } from 'react'
import {
  ShieldCheck, BookOpen, Inbox as InboxIcon, Sparkles, Plus, Lightbulb, X,
  Library, Search, Trash2, Download,
} from 'lucide-react'
import { useStore } from '../store'
import { Modal, TipCard } from '../components/Shared'

export default function Conhecimento() {
  const s = useStore()
  const [modalPolitica, setModalPolitica] = useState(false)
  const [modalFaq, setModalFaq] = useState(false)
  const [pt, setPt] = useState(''); const [pc, setPc] = useState('')
  const [fq, setFq] = useState(''); const [fr, setFr] = useState('')
  const guiaFechado = s.tipsFechados.includes('guia-conhecimento')
  const ativos = s.politicas.filter(p => p.ativa).length + s.faqs.filter(f => f.ativa).length

  return (
    <div className="content-narrow">
      <div className="row spread mb-20" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="h1" style={{ fontSize: 22 }}>Base de Conhecimento</h1>
          <p className="muted" style={{ marginTop: 5 }}>
            O que o atendo sabe sobre a sua loja — políticas, prazos e FAQs que ele usa nas respostas. ({ativos} ativo{ativos !== 1 ? 's' : ''})
          </p>
        </div>
        <div className="row gap-8">
          <span className="chip">PT</span>
          <button className="btn"><Lightbulb size={14} /> Sugerir do histórico</button>
          <button className="btn"><Download size={14} /> Importar</button>
          <button className="btn btn-primary" onClick={() => setModalFaq(true)}><Plus size={14} /> Novo artigo</button>
        </div>
      </div>

      {!guiaFechado && (
        <div className="card-purple mb-24" style={{ padding: '16px 18px' }}>
          <div className="row spread mb-12">
            <div className="row gap-10">
              <Lightbulb size={16} color="var(--purple)" />
              <div>
                <b style={{ fontSize: 14 }}>Deixe o atendo pronto para responder tudo</b>
                <div className="muted-sm">Quatro passos para as melhores respostas automáticas.</div>
              </div>
            </div>
            <button onClick={() => s.fecharTip('guia-conhecimento')} style={{ color: 'var(--text-3)' }}><X size={16} /></button>
          </div>
          <div className="grid-2">
            {[
              { icon: <ShieldCheck size={14} />, t: '1. Cadastre suas políticas', d: 'Prazos de envio e entrega, trocas, devoluções, reembolsos, alfândega. São a fonte de verdade — o atendo nunca inventa uma regra.' },
              { icon: <Library size={14} />, t: '2. Instale a biblioteca e-commerce', d: 'Dúvidas prontas de e-commerce. Depois revise e ajuste com os dados reais da sua loja.' },
              { icon: <InboxIcon size={14} />, t: '3. Aprenda com o histórico', d: 'Em "Sugerir do histórico", o atendo lê os e-mails antigos e extrai as dúvidas mais comuns já com a resposta que você deu.' },
              { icon: <BookOpen size={14} />, t: '4. Quanto mais completo, melhor', d: 'Cada política e FAQ ativa deixa as respostas mais precisas. O atendo também aprende sozinho com as respostas que você escreve à mão.' },
            ].map(c => (
              <div key={c.t} className="card-soft" style={{ padding: 14 }}>
                <div className="row gap-8 mb-8" style={{ color: 'var(--purple)' }}>{c.icon}<b style={{ fontSize: 13, color: 'var(--text)' }}>{c.t}</b></div>
                <p className="muted-sm" style={{ lineHeight: 1.55 }}>{c.d}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Políticas */}
      <div className="row spread mb-8">
        <div className="row gap-8">
          <ShieldCheck size={16} color="var(--purple)" />
          <b style={{ fontSize: 15 }}>Políticas da loja</b>
          <span className="muted-sm">{s.politicas.length}</span>
        </div>
        <button className="btn" onClick={() => setModalPolitica(true)}><Plus size={14} /> Adicionar política</button>
      </div>
      <p className="muted-sm mb-12">Prazos, trocas, reembolsos — o atendo cita estas regras em toda resposta.</p>
      {s.politicas.length === 0 ? (
        <div className="mb-24" style={{ border: '1.5px dashed var(--border)', borderRadius: 14, padding: '30px 20px', textAlign: 'center' }}>
          <p className="muted-sm mb-12">Nenhuma política ainda. Comece pela de trocas ou prazos de entrega.</p>
          <button className="btn btn-sm" onClick={s.preencherPoliticas}><Sparkles size={13} /> Preencher com sugestões</button>
        </div>
      ) : (
        <div className="mb-24">
          {s.politicas.map(p => (
            <div key={p.id} className="kb-item">
              <button className={'switch' + (p.ativa ? ' on' : '')} onClick={() => s.togglePolitica(p.id)} title={p.ativa ? 'Ativa' : 'Inativa'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="title">{p.titulo}</div>
                <div className="sub">{p.conteudo}</div>
              </div>
              <button onClick={() => s.removerPolitica(p.id)} style={{ color: 'var(--text-3)' }} title="Remover"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {/* FAQs */}
      <div className="row spread mb-8" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="row gap-8">
          <BookOpen size={16} color="var(--purple)" />
          <b style={{ fontSize: 15 }}>Perguntas frequentes</b>
          <span className="muted-sm">{s.faqs.length}</span>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={s.instalarBiblioteca}><Library size={14} /> Biblioteca e-commerce</button>
          <button className="btn" onClick={() => { s.preencherPoliticas(); s.instalarBiblioteca() }}><Sparkles size={14} /> Preencher com atendo</button>
          <button className="btn"><Search size={14} /> Buscar nos e-mails</button>
          <button className="btn" onClick={() => setModalFaq(true)}><Plus size={14} /> Nova</button>
        </div>
      </div>
      <p className="muted-sm mb-12">As dúvidas que os clientes mandam de verdade — e como o atendo deve responder cada uma.</p>
      {s.faqs.length === 0 ? (
        <div style={{ border: '1.5px dashed var(--border)', borderRadius: 14, padding: '30px 20px', textAlign: 'center' }}>
          <p className="muted-sm">Nada aqui ainda. Instale a biblioteca de e-commerce ou clique em "Buscar nos e-mails" para o atendo achar as dúvidas dos seus clientes.</p>
        </div>
      ) : (
        s.faqs.map(f => (
          <div key={f.id} className="kb-item">
            <button className={'switch' + (f.ativa ? ' on' : '')} onClick={() => s.toggleFaq(f.id)} title={f.ativa ? 'Ativa' : 'Inativa'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="title">{f.pergunta}</div>
              <div className="sub">{f.resposta}</div>
            </div>
            <button onClick={() => s.removerFaq(f.id)} style={{ color: 'var(--text-3)' }} title="Remover"><Trash2 size={15} /></button>
          </div>
        ))
      )}

      {modalPolitica && (
        <Modal title="Adicionar política" onClose={() => setModalPolitica(false)}>
          <div className="field"><label>Título</label><input value={pt} onChange={e => setPt(e.target.value)} placeholder="ex.: Política de trocas" autoFocus /></div>
          <div className="field"><label>Conteúdo</label><textarea value={pc} onChange={e => setPc(e.target.value)} placeholder="Descreva a regra exatamente como o atendo deve comunicá-la ao cliente…" /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!pt.trim() || !pc.trim()} style={!pt.trim() || !pc.trim() ? { opacity: 0.5 } : undefined}
              onClick={() => { s.addPolitica(pt.trim(), pc.trim()); setPt(''); setPc(''); setModalPolitica(false) }}>
              Salvar política
            </button>
          </div>
        </Modal>
      )}

      {modalFaq && (
        <Modal title="Nova pergunta frequente" onClose={() => setModalFaq(false)}>
          <div className="field"><label>Pergunta</label><input value={fq} onChange={e => setFq(e.target.value)} placeholder="ex.: Qual o prazo de entrega?" autoFocus /></div>
          <div className="field"><label>Resposta</label><textarea value={fr} onChange={e => setFr(e.target.value)} placeholder="Como o atendo deve responder…" /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!fq.trim() || !fr.trim()} style={!fq.trim() || !fr.trim() ? { opacity: 0.5 } : undefined}
              onClick={() => { s.addFaq(fq.trim(), fr.trim()); setFq(''); setFr(''); setModalFaq(false) }}>
              Salvar artigo
            </button>
          </div>
        </Modal>
      )}

      <TipCard
        id="tip-conhecimento"
        title="Ensine o atendo a responder como sua marca"
        text="Adicione políticas, FAQs e instruções para que as respostas geradas sejam mais precisas e consistentes."
        items={['Importe políticas', 'Crie artigos por categoria', 'Marque artigos ativos', 'Atualize respostas frequentes']}
        action={{ label: 'Criar artigo', onClick: () => setModalFaq(true) }}
      />
    </div>
  )
}
