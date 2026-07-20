import { useState } from 'react'
import { LogIn, UserPlus } from 'lucide-react'
import { useStore } from '../store'

export default function Login() {
  const { entrar, registrar } = useStore()
  const [modo, setModo] = useState<'entrar' | 'registrar'>('entrar')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const falha = modo === 'entrar'
        ? await entrar(email.trim(), senha)
        : await registrar(nome.trim(), email.trim(), senha)
      if (falha) setErro(falha)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: '32px 30px' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div className="topbar-logo" style={{ fontSize: 30 }}>atendo</div>
          <p className="muted" style={{ marginTop: 8 }}>
            {modo === 'entrar' ? 'Entre para cuidar do seu atendimento.' : 'Crie sua conta — leva um minuto.'}
          </p>
        </div>

        <form onSubmit={enviar}>
          {modo === 'registrar' && (
            <div className="field">
              <label>Seu nome</label>
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Como quer ser chamado" autoFocus />
            </div>
          )}
          <div className="field">
            <label>E-mail</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com" autoFocus={modo === 'entrar'} required />
          </div>
          <div className="field">
            <label>Senha</label>
            <input type="password" value={senha} onChange={e => setSenha(e.target.value)}
              placeholder={modo === 'registrar' ? 'Mínimo de 8 caracteres' : 'Sua senha'} required minLength={modo === 'registrar' ? 8 : undefined} />
          </div>

          {erro && (
            <div className="card-soft mb-12" style={{ padding: '10px 12px', borderColor: 'var(--danger-border)', background: 'var(--danger-bg)' }}>
              <span className="muted-sm" style={{ color: 'var(--red)' }}>{erro}</span>
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={enviando}
            style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
            {modo === 'entrar' ? <LogIn size={15} /> : <UserPlus size={15} />}
            {enviando ? 'Um momento…' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <p className="muted-sm" style={{ textAlign: 'center', marginTop: 18 }}>
          {modo === 'entrar' ? (
            <>Ainda não tem conta?{' '}
              <button className="btn-ghost" style={{ padding: '2px 6px' }} onClick={() => { setModo('registrar'); setErro(null) }}>Criar conta</button>
            </>
          ) : (
            <>Já tem conta?{' '}
              <button className="btn-ghost" style={{ padding: '2px 6px' }} onClick={() => { setModo('entrar'); setErro(null) }}>Entrar</button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
