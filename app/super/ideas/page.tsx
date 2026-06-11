'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Lightbulb, Check, X, Mail, Phone, Copy, Loader2, ThumbsUp } from 'lucide-react'
import { api } from '@/lib/api-client'

// ============================================================
// Модерация идей (суперадмин).
//
// Очередь pending → Одобрить / Отклонить. Управление опубликованными
// → пометить «Сделали» / скрыть. У каждой идеи — карточка автора с
// контактами (имя, email, телефон, организация), чтобы выйти на автора.
// ============================================================

type Author = {
  full_name: string | null
  email: string | null
  phone: string | null
  org: string | null
}

type AdminIdea = {
  id: string
  title: string | null
  body: string
  status: string
  votes_count: number
  created_at: string
  published_at: string | null
  done_at: string | null
  author: Author
}

type AdminData = {
  pending: AdminIdea[]
  published: AdminIdea[]
  done: AdminIdea[]
  counts: { pending: number; published: number; done: number }
}

type AuthData = {
  authenticated: boolean
  user?: { role: string }
  isLegacy?: boolean
}

export default function SuperIdeasPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [data, setData] = useState<AdminData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // id идеи в процессе действия
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) { router.push('/login'); return }
        if (d.user?.role !== 'superadmin') { router.push('/app'); return }
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api('/api/ideas?action=admin')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Не удалось загрузить идеи')
      setData(d)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Ошибка загрузки', 'err')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (authChecked) load() }, [authChecked, load])

  const act = async (idea: AdminIdea, action: string, okText: string) => {
    setBusy(idea.id)
    try {
      const res = await api('/api/ideas', {
        method: 'POST',
        body: JSON.stringify({ action, idea_id: idea.id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Не удалось выполнить действие')
      notify(okText, 'ok')
      await load()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Ошибка', 'err')
    } finally {
      setBusy(null)
    }
  }

  const copyPhone = (phone: string) => {
    navigator.clipboard?.writeText(phone).then(
      () => notify('Телефон скопирован', 'ok'),
      () => notify('Не удалось скопировать', 'err'),
    )
  }

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Проверка авторизации…</div>
  }

  return (
    <div className="min-h-screen p-6">
      {msg && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-lg ${
          msg.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.push('/super')} className="text-sm text-muted-foreground hover:text-foreground mb-2">← Назад</button>
        <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2"><Lightbulb size={22} /> Модерация идей</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Новые идеи приходят на премодерацию и не видны партнёрам, пока вы их не одобрите.
          У каждой идеи виден автор с контактами — чтобы связаться и обсудить.
        </p>

        {/* Счётчики */}
        {data && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <StatCard label="На модерации" value={data.counts.pending} accent="amber" />
            <StatCard label="Опубликовано" value={data.counts.published} accent="brand" />
            <StatCard label="Сделали" value={data.counts.done} accent="green" />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={24} className="animate-spin" /></div>
        ) : data ? (
          <div className="space-y-10">
            {/* Очередь модерации */}
            <Section title="На модерации" empty="Новых идей нет.">
              {data.pending.map(idea => (
                <IdeaCard key={idea.id} idea={idea} busy={busy === idea.id} onCopyPhone={copyPhone}>
                  <button onClick={() => act(idea, 'approve', 'Идея опубликована')} disabled={busy === idea.id}
                    className="btn-primary"><Check size={16} /> Одобрить</button>
                  <button onClick={() => act(idea, 'reject', 'Идея отклонена')} disabled={busy === idea.id}
                    className="btn-secondary text-red-600"><X size={16} /> Отклонить</button>
                </IdeaCard>
              ))}
            </Section>

            {/* Опубликованные */}
            <Section title="Опубликованные" empty="Пока ничего не опубликовано.">
              {data.published.map(idea => (
                <IdeaCard key={idea.id} idea={idea} busy={busy === idea.id} onCopyPhone={copyPhone}>
                  <button onClick={() => act(idea, 'mark_done', 'Помечено как «Сделали»')} disabled={busy === idea.id}
                    className="btn-primary"><Check size={16} /> Сделали</button>
                  <button onClick={() => act(idea, 'hide', 'Идея скрыта')} disabled={busy === idea.id}
                    className="btn-secondary text-red-600"><X size={16} /> Скрыть</button>
                </IdeaCard>
              ))}
            </Section>

            {/* Сделали */}
            <Section title="Сделали" empty="Реализованных идей пока нет.">
              {data.done.map(idea => (
                <IdeaCard key={idea.id} idea={idea} busy={busy === idea.id} onCopyPhone={copyPhone}>
                  <button onClick={() => act(idea, 'hide', 'Идея скрыта')} disabled={busy === idea.id}
                    className="btn-secondary text-red-600"><X size={16} /> Скрыть</button>
                </IdeaCard>
              ))}
            </Section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: 'amber' | 'brand' | 'green' }) {
  const color = accent === 'amber' ? 'text-amber-600' : accent === 'green' ? 'text-green-600' : 'text-brand-600'
  return (
    <div className="card p-4">
      <div className={`text-3xl font-semibold ${color}`}>{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  )
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  const isEmpty = items.flat().filter(Boolean).length === 0
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h2>
      {isEmpty ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="space-y-3">{children}</div>}
    </section>
  )
}

function IdeaCard({
  idea, busy, onCopyPhone, children,
}: {
  idea: AdminIdea
  busy: boolean
  onCopyPhone: (phone: string) => void
  children: React.ReactNode
}) {
  const a = idea.author
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {idea.title && <p className="font-medium mb-0.5">{idea.title}</p>}
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">{idea.body}</p>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground shrink-0" title="Голосов">
          <ThumbsUp size={15} /> <span className="text-sm font-semibold">{idea.votes_count}</span>
        </div>
      </div>

      {/* Карточка автора — кто предложил, как связаться */}
      <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="font-medium">{a.full_name ?? '— без имени'}</span>
        {a.org && <span className="text-muted-foreground">· {a.org}</span>}
        {a.email && (
          <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
            <Mail size={14} /> {a.email}
          </a>
        )}
        {a.phone && (
          <button onClick={() => onCopyPhone(a.phone!)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <Phone size={14} /> {a.phone} <Copy size={13} />
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        {busy ? <Loader2 size={18} className="animate-spin text-muted-foreground" /> : children}
      </div>
    </div>
  )
}
