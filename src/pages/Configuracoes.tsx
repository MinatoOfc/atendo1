import { useState } from 'react'
import { Mail, ShoppingBag, Zap, PenLine, Database, Check, Unplug, Sparkles, Copy, AlertTriangle, Search } from 'lucide-react'
import { useStore } from '../store'
import type { Diagnostico } from '../store'

function EnvVars({ vars }: { vars: [string, string][] }) {
  const [copiado, setCopiado] = useState(false)
  const texto = vars.map(([k, v]) => `${k}=${v}`).join('\n')
  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <pre style={{
        background: '#17151f', color: '#e8e6f0', borderRadius: 10, padding: '12px 14px',
        fontSize: 12, lineHeight: 1.7, overflowX: 'auto',
      }}>{vars.map(([k, v]) => <div key={k}><span style={{ color: '#c084fc' }}>{k}</span>=<span style={{ color: '#86efac' }}>{v}</span></div>)}</pre>
      <button
        onClick={() => { navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }}
        style={{ position: 'absolute', top: 8, right: 8, color: '#a09da8', padding: 4 }}
        title="Copiar"
      >{copiado ? <Check size={14} color="#86efac" /> : <Copy size={14} />}</button>
    </div>
  )
}

export default function Configuracoes() {
  const s = useStore()
  const [email, setEmail] = useState(s.config.emailConectado ?? '')
  const [testando, setTestando] = useState(false)
  const [diag, setDiag] = useState<Diagnostico | null>(null)
  const [diagnosticando, setDiagnosticando] = useState(false)
  const [testandoIa, setTestandoIa] = useState(false)
  const status = s.integracoes.emailStatus
  const ia = s.integracoes.iaStatus

  const testarIa = async () => {
    setTestandoIa(true)
    try { await s.testarIA() } finally { setTestandoIa(false) }
  }

  const testar = async () => {
    setTestando(true)
    try { await s.testarEmail() } finally { setTestando(false) }
  }

  const diagnosticar = async () => {
    setDiagnosticando(true)
    try { setDiag(await s.diagnosticarEmail()) } finally { setDiagnosticando(false) }
  }

  const Section = ({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) => (
    <div className="card mb-16" style={{ padding: '18px 20px' }}>
      <div className="row gap-10 mb-8">
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--purple-soft)', color: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
        <div>
          <b style={{ fontSize: 14.5 }}>{title}</b>
          <div className="muted-sm">{desc}</div>
        </div>
      </div>
      <div style={{ paddingLeft: 42 }}>{children}</div>
    </div>
  )

  return (
    <div className="content-narrow" style={{ maxWidth: 760 }}>
      <h1 className="h1 mb-8" style={{ fontSize: 22 }}>Configurações</h1>
      <p className="muted mb-24">
        As integrações reais são configuradas por <b>variáveis de ambiente</b> — no Railway: seu serviço → aba <b>Variables</b>. Nenhuma senha passa por esta tela. Depois de salvar as variáveis, o Railway reinicia o app e a integração liga sozinha.
      </p>

      <Section icon={<Sparkles size={15} />} title="Inteligência artificial (Claude)" desc="Classifica cada e-mail e escreve a resposta no idioma do cliente, usando suas políticas como fonte de verdade.">
        {s.integracoes.ia ? (
          <>
            <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
              {ia?.ok === false ? (
                <span className="tag tag-reembolso"><AlertTriangle size={11} style={{ marginRight: 4 }} /> Falhando</span>
              ) : ia?.ok ? (
                <span className="tag tag-green"><Check size={11} style={{ marginRight: 4 }} /> Gerando respostas</span>
              ) : (
                <span className="tag tag-outro">Verificando…</span>
              )}
              {ia?.modelo && <span className="muted-sm">modelo {ia.modelo}</span>}
              <button className="btn btn-sm" onClick={testarIa} disabled={testandoIa}>
                {testandoIa ? 'Testando…' : 'Testar IA'}
              </button>
            </div>
            {ia?.ok === false && ia.erro && (
              <div className="card-soft" style={{ marginTop: 12, padding: '12px 14px', borderColor: '#fecaca', background: '#fef7f7' }}>
                <div className="row gap-8 mb-8" style={{ color: 'var(--red)' }}>
                  <AlertTriangle size={14} /><b style={{ fontSize: 13 }}>A IA não está respondendo — usando regras locais</b>
                </div>
                <p className="muted-sm" style={{ lineHeight: 1.6 }}>{ia.erro}</p>
                <p className="muted-sm" style={{ lineHeight: 1.6, marginTop: 8 }}>
                  Para trocar de modelo, defina <code>ATENDO_MODEL</code> no Railway (ex.: <code>claude-sonnet-5</code>, mais barato).
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="tag tag-amber">Não configurada — respostas por regras simples</span>
            <p className="muted-sm" style={{ marginTop: 10, lineHeight: 1.6 }}>
              1. Crie uma conta em <b>console.anthropic.com</b> e gere uma chave de API (custo por uso — centavos por e-mail respondido).<br />
              2. Adicione no Railway:
            </p>
            <EnvVars vars={[['ANTHROPIC_API_KEY', 'sk-ant-...sua-chave...']]} />
          </>
        )}
      </Section>

      <Section icon={<Mail size={15} />} title="E-mail de atendimento" desc="A caixa que o atendo lê (IMAP) e pela qual responde (SMTP).">
        {s.integracoes.email ? (
          <>
            <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
              {status?.ok === false ? (
                <span className="tag tag-reembolso"><AlertTriangle size={11} style={{ marginRight: 4 }} /> Login recusado</span>
              ) : status?.ok ? (
                <span className="tag tag-green"><Check size={11} style={{ marginRight: 4 }} /> Conectado</span>
              ) : (
                <span className="tag tag-outro">Verificando…</span>
              )}
              <span className="muted">{s.config.emailConectado}</span>
              {status?.ok && <span className="muted-sm">lendo a caixa a cada 60 s</span>}
              <button className="btn btn-sm" onClick={testar} disabled={testando}>
                {testando ? 'Testando…' : 'Testar conexão'}
              </button>
              <button className="btn btn-sm" onClick={diagnosticar} disabled={diagnosticando}>
                <Search size={13} /> {diagnosticando ? 'Lendo a caixa…' : 'Ver o que o atendo enxerga'}
              </button>
            </div>
            {status?.ok === false && status.erro && (
              <div className="card-soft" style={{ marginTop: 12, padding: '12px 14px', borderColor: '#fecaca', background: '#fef7f7' }}>
                <div className="row gap-8 mb-8" style={{ color: 'var(--red)' }}>
                  <AlertTriangle size={14} /><b style={{ fontSize: 13 }}>O servidor de e-mail recusou a conexão</b>
                </div>
                <p className="muted-sm" style={{ lineHeight: 1.6 }}>{status.erro}</p>
              </div>
            )}
            {diag && (
              <div className="card-soft" style={{ marginTop: 12, padding: '12px 14px' }}>
                {!diag.ok ? (
                  <p className="muted-sm" style={{ color: 'var(--red)' }}>{diag.erro}</p>
                ) : (
                  <>
                    <p className="muted-sm mb-8">
                      Caixa <b>{diag.caixa}</b> — {diag.totalNaCaixa} mensagens no total,{' '}
                      <b>{diag.encontradosNaJanela}</b> nos últimos {diag.janelaDias} dias (só essas são consideradas).
                    </p>
                    {diag.mensagens?.length ? (
                      <table className="table" style={{ fontSize: 12 }}>
                        <thead><tr><th>De</th><th>Assunto</th><th>Situação</th></tr></thead>
                        <tbody>
                          {diag.mensagens.map((m, i) => (
                            <tr key={i}>
                              <td style={{ whiteSpace: 'nowrap' }}>{m.de}</td>
                              <td>{m.assunto}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {m.respostaDoAtendo
                                  ? <span className="tag tag-outro">resposta do atendo</span>
                                  : m.virouTicket
                                    ? <span className="tag tag-green">virou ticket</span>
                                    : <span className="tag tag-amber">na fila</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="muted-sm">
                        Nenhuma mensagem nos últimos {diag.janelaDias} dias. Se você acabou de enviar o teste, confira se ele
                        caiu no spam do Gmail ou se foi entregue em outra conta.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <span className="tag tag-amber">Não configurado — e-mails de demonstração</span>
            <p className="muted-sm" style={{ marginTop: 10, lineHeight: 1.6 }}>
              Para Gmail: ative a verificação em duas etapas e gere uma <b>senha de app</b> em myaccount.google.com → Segurança → Senhas de app. Depois adicione no Railway:
            </p>
            <EnvVars vars={[
              ['EMAIL_PROVIDER', 'gmail'],
              ['EMAIL_USER', 'suporte@sualoja.com'],
              ['EMAIL_PASS', 'senha-de-app-de-16-letras'],
            ]} />
            <p className="muted-sm" style={{ marginTop: 8 }}>
              Outros provedores: <code>EMAIL_PROVIDER</code> aceita <b>outlook</b>, <b>yahoo</b> e <b>icloud</b>. Domínio próprio: troque por <code>EMAIL_IMAP_HOST</code> e <code>EMAIL_SMTP_HOST</code>.
            </p>
            <div className="row gap-8" style={{ marginTop: 12 }}>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="ou registre um e-mail só para visual (demo)"
                style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', outline: 'none', fontSize: 13 }} />
              {s.config.emailConectado ? (
                <button className="btn btn-sm" onClick={() => { s.setConfig({ emailConectado: null }); setEmail('') }}><Unplug size={13} /> Remover</button>
              ) : (
                <button className="btn btn-sm" disabled={!email.includes('@')} style={!email.includes('@') ? { opacity: 0.5 } : undefined}
                  onClick={() => s.setConfig({ emailConectado: email.trim() })}>Salvar (demo)</button>
              )}
            </div>
          </>
        )}
      </Section>

      <Section icon={<ShoppingBag size={15} />} title="Shopify" desc="Pedidos, rastreio e clientes entram sozinhos — o atendo usa esses dados nas respostas.">
        {s.integracoes.shopify ? (
          <div className="row gap-10">
            <span className="tag tag-green"><Check size={11} style={{ marginRight: 4 }} /> Conectada</span>
            <span className="muted">{s.pedidos.length} pedidos sincronizados</span>
          </div>
        ) : (
          <>
            <span className="tag tag-amber">Não configurada</span>
            <p className="muted-sm" style={{ marginTop: 10, lineHeight: 1.6 }}>
              No admin da sua loja: <b>Configurações → Apps e canais de venda → Desenvolver apps → Criar app</b>. Dê permissão de leitura em <b>Orders</b> e <b>Customers</b>, instale o app e copie o <b>Admin API access token</b>. Depois adicione no Railway:
            </p>
            <EnvVars vars={[
              ['SHOPIFY_STORE', 'sualoja.myshopify.com'],
              ['SHOPIFY_ADMIN_TOKEN', 'shpat_...seu-token...'],
            ]} />
            <div style={{ marginTop: 12 }}>
              {s.config.shopifyConectada ? (
                <div className="row gap-10">
                  <span className="tag tag-outro">Demonstração ativa</span>
                  <span className="muted-sm">{s.pedidos.length} pedidos de exemplo</span>
                  <button className="btn btn-sm" onClick={() => s.setConfig({ shopifyConectada: false })}><Unplug size={13} /> Desligar demo</button>
                </div>
              ) : (
                <button className="btn btn-sm" onClick={s.conectarShopify}>Usar dados de demonstração</button>
              )}
            </div>
          </>
        )}
      </Section>

      <Section icon={<Zap size={15} />} title="Automação" desc="Quanto o atendo pode responder sozinho, sem passar por você.">
        <div className="row spread mb-12">
          <div style={{ paddingRight: 16 }}>
            <b style={{ fontSize: 13.5 }}>Responder clientes automaticamente</b>
            <div className="muted-sm">Com isso ligado, as respostas saem sozinhas — você não precisa aprovar nada.</div>
          </div>
          <button className={'switch' + (s.config.automacaoAtiva ? ' on' : '')} onClick={() => s.setConfig({ automacaoAtiva: !s.config.automacaoAtiva })} />
        </div>

        {s.config.automacaoAtiva && !s.integracoes.ia && (
          <div className="card-soft mb-12" style={{ padding: '10px 12px', borderColor: '#fde9c0', background: '#fffbeb' }}>
            <p className="muted-sm" style={{ lineHeight: 1.6 }}>
              <AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--amber)' }} />
              A IA não está gerando as respostas agora — o que sair será o texto genérico das regras locais. Resolva a IA acima antes de deixar no automático.
            </p>
          </div>
        )}

        <div className="row gap-10 mb-12">
          <span className="muted" style={{ fontSize: 13 }}>Esperar antes de enviar:</span>
          <select value={s.config.atrasoMinutos} onChange={e => s.setConfig({ atrasoMinutos: Number(e.target.value) })}
            className="chip" style={{ cursor: 'pointer' }}>
            <option value={0}>na hora</option>
            {[1, 3, 5, 10, 20, 45].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
          <span className="muted-sm">um pequeno atraso faz a resposta parecer escrita por uma pessoa</span>
        </div>

        <div className="row spread mb-12">
          <div style={{ paddingRight: 16 }}>
            <b style={{ fontSize: 13.5 }}>Reembolsos e casos sensíveis esperam você</b>
            <div className="muted-sm">
              Reembolsos, disputas e ameaças legais vão para Atendimento humano em vez de serem respondidos sozinhos.
              {!s.config.escalarSensiveis && <b style={{ color: 'var(--red)' }}> Desligado: a IA vai responder até pedidos de reembolso por conta própria.</b>}
            </div>
          </div>
          <button className={'switch' + (s.config.escalarSensiveis ? ' on' : '')} onClick={() => s.setConfig({ escalarSensiveis: !s.config.escalarSensiveis })} />
        </div>

        <div className="row gap-10">
          <span className="muted" style={{ fontSize: 13 }}>Só responder sozinho com confiança acima de:</span>
          <select value={s.config.confiancaMinima} onChange={e => s.setConfig({ confiancaMinima: Number(e.target.value) })}
            className="chip" style={{ cursor: 'pointer' }}>
            <option value={0}>qualquer confiança</option>
            <option value={0.4}>40%</option>
            <option value={0.55}>55% (recomendado)</option>
            <option value={0.7}>70%</option>
            <option value={0.85}>85% (bem conservador)</option>
          </select>
        </div>
        <p className="muted-sm" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Abaixo desse valor a resposta espera sua aprovação. Quanto mais completa a Base de Conhecimento, mais alta a confiança da IA.
        </p>
      </Section>

      <Section icon={<PenLine size={15} />} title="Identidade" desc="Nome da loja e assinatura usada no fim de cada resposta.">
        <div className="grid-2">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nome da loja</label>
            <input value={s.config.nomeLoja} onChange={e => s.setConfig({ nomeLoja: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Assinatura</label>
            <input value={s.config.assinatura} onChange={e => s.setConfig({ assinatura: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section icon={<Database size={15} />} title="Dados" desc="Tickets, políticas e FAQs ficam salvos no servidor (arquivo em disco).">
        <button className="btn btn-danger" onClick={() => { if (confirm('Apagar todos os tickets, políticas, FAQs e conexões de demonstração?')) s.limparTudo() }}>
          Apagar todos os dados
        </button>
      </Section>
    </div>
  )
}
