import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from './UI'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Incorrect email or password')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-paper grid lg:grid-cols-[1.05fr_.95fr]">
      <div className="hidden lg:flex bg-royal-500 text-white p-12 xl:p-16 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <img src="/logo.png" alt="Good & General" className="w-[210px] brightness-0 invert" />
        </div>
        <div className="relative z-10 max-w-xl">
          <div className="text-xs uppercase tracking-[0.18em] font-semibold text-sky mb-5">Commerce operations</div>
          <div className="text-[42px] xl:text-[52px] leading-[1.02] font-medium tracking-[-0.035em]">Useful decisions.<br />Clearly modelled.</div>
          <p className="text-white/72 mt-6 max-w-md text-base leading-relaxed">Pricing, stock, approvals, live listings and monthly planning in one accountable operating system.</p>
        </div>
        <div className="relative z-10 text-xs uppercase tracking-[0.14em] text-white/55">People. Products. Possibilities.</div>
        <div className="absolute -right-24 top-24 w-80 h-80 border border-white/12 rounded-full" />
        <div className="absolute -right-6 top-40 w-48 h-48 bg-sky/10 rounded-full" />
      </div>

      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px]">
          <img src="/logo.png" alt="Good & General" className="w-[180px] lg:hidden mb-10" />
          <div className="page-eyebrow">Secure workspace</div>
          <h1 className="text-[32px] sm:text-[38px] leading-tight font-medium tracking-[-0.025em] text-ink mt-2">Sign in</h1>
          <p className="text-sm text-ink/50 mt-2 mb-8">Access the Good & General commerce operations portal.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input className="input h-11" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input h-11" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            {error && (
              <div className="panel-alert flex items-start gap-2.5 text-xs text-ink/65"><Icon name="alert" size={15} className="text-coral mt-0.5" />{error}</div>
            )}
            <button className="btn btn-primary w-full h-11 justify-center mt-2" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
              {!loading && <Icon name="arrowRight" size={15} />}
            </button>
          </form>

          <div className="mt-8 pt-5 border-t border-rule text-xs text-ink/35">Good & General · Commerce Operations</div>
        </div>
      </div>
    </div>
  )
}
