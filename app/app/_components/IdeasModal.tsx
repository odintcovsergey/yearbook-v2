'use client'

import { useState, useEffect, useCallback } from 'react'
import { ThumbsUp, Lightbulb, Search, X, Plus, Loader2, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api-client'

// ============================================================
// Модалка «Идеи и предложения» (кабинет партнёра).
//
// Глобальная лента сообщества: предложить идею, голосовать за чужие,
// видеть рейтинг и статусы. Авторы анонимны (API не отдаёт автора).
// Новая идея уходит на премодерацию (status='pending') и в ленте не
// видна, пока суперадмин не одобрит.
//
// Вкладки: Голосование (опубликованные по голосам) · Сделали (done) ·
// Мои голоса (за что голосовал я). Поиск по тексту.
// ============================================================

type Idea = {
  id: string
  title: string | null
  body: string
  status: string
  votes_count: number
  created_at: string
  voted: boolean
}

type Tab = 'voting' | 'done' | 'mine_votes'

const TABS: { key: Tab; label: string }[] = [
  { key: 'voting', label: 'Голосование' },
  { key: 'done', label: 'Сделали' },
  { key: 'mine_votes', label: 'Мои голоса' },
]

type Props = {
  onClose: () => void
  onNotify: (text: string) => void
  onError: (text: string) => void
}

export default function IdeasModal({ onClose, onNotify, onError }: Props) {
  const [tab, setTab] = useState<Tab>('voting')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [newText, setNewText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // После успешной отправки показываем заметное подтверждение прямо в окне
  // (а не только мелькающий тост): идея ушла на модерацию.
  const [justSubmitted, setJustSubmitted] = useState(false)

  const openForm = () => { setShowForm(true); setJustSubmitted(false) }
  const closeForm = () => { setShowForm(false); setJustSubmitted(false); setNewText('') }

  // Дебаунс поиска — не дёргаем API на каждую букву.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ action: 'list', tab })
      if (debounced) params.set('q', debounced)
      const res = await api(`/api/ideas?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Не удалось загрузить идеи')
      setIdeas(data.ideas ?? [])
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка загрузки')
      setIdeas([])
    } finally {
      setLoading(false)
    }
  }, [tab, debounced, onError])

  useEffect(() => { load() }, [load])

  // Голос / снятие — оптимистично, с откатом при ошибке.
  const toggleVote = async (idea: Idea) => {
    const wantVote = !idea.voted
    const prev = ideas
    setIdeas(list => list.map(i =>
      i.id === idea.id
        ? { ...i, voted: wantVote, votes_count: i.votes_count + (wantVote ? 1 : -1) }
        : i,
    ))
    try {
      const res = await api('/api/ideas', {
        method: 'POST',
        body: JSON.stringify({ action: wantVote ? 'vote' : 'unvote', idea_id: idea.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Не удалось проголосовать')
      // Подменяем счётчик на серверный (на случай гонки).
      setIdeas(list => list.map(i =>
        i.id === idea.id ? { ...i, voted: wantVote, votes_count: data.votes_count ?? i.votes_count } : i,
      ))
    } catch (e) {
      setIdeas(prev) // откат
      onError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const submitIdea = async () => {
    const text = newText.trim()
    if (text.length < 10) { onError('Опишите идею подробнее (минимум 10 символов)'); return }
    setSubmitting(true)
    try {
      const res = await api('/api/ideas', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', body: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Не удалось отправить идею')
      onNotify(data.message ?? 'Идея отправлена на модерацию')
      setNewText('')
      setJustSubmitted(true) // показываем подтверждение в окне
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
              <Lightbulb size={20} className="text-brand-600" /> Идеи и предложения
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Предложите идею для развития сервиса — мы обязательно рассмотрим её реализацию.
              Голосуйте за идеи других, чтобы поднять важные выше.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={openForm} className="btn-primary">
              <Plus size={16} /> Добавить идею
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Подтверждение после отправки */}
        {showForm && justSubmitted && (
          <div className="px-6 py-5 border-b border-border bg-green-50">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={22} className="text-green-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-green-800">Спасибо! Идея отправлена на модерацию.</p>
                <p className="text-sm text-green-700 mt-1">
                  Мы проверим её вручную, и после одобрения она появится в разделе «Голосование» —
                  партнёры смогут за неё голосовать. Сейчас в общей ленте её ещё нет, это нормально.
                </p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setJustSubmitted(false) }} className="btn-secondary">
                    Предложить ещё
                  </button>
                  <button onClick={closeForm} className="btn-primary">Понятно</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Форма добавления */}
        {showForm && !justSubmitted && (
          <div className="px-6 py-4 border-b border-border bg-muted/40">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="Что хотелось бы улучшить или добавить? Опишите идею своими словами…"
              rows={3}
              maxLength={2000}
              className="input w-full resize-none"
              autoFocus
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-muted-foreground">
                Идея появится в ленте только после проверки модератором.
              </span>
              <div className="flex gap-2">
                <button onClick={closeForm} className="btn-secondary">
                  Отмена
                </button>
                <button onClick={submitIdea} disabled={submitting} className="btn-primary">
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Отправить'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Вкладки + поиск */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-muted rounded-xl p-1">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  tab === t.key ? 'bg-card shadow text-brand-700' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по тексту…"
              className="input w-full pl-9"
            />
          </div>
        </div>

        {/* Лента */}
        <div className="overflow-y-auto px-6 py-4 flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : ideas.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {tab === 'mine_votes'
                ? 'Вы пока не голосовали ни за одну идею.'
                : debounced
                  ? 'Ничего не нашлось по запросу.'
                  : tab === 'done'
                    ? 'Здесь появятся реализованные идеи.'
                    : 'Пока нет идей в голосовании. Будьте первым — нажмите «Добавить идею».'}
            </div>
          ) : (
            <ul className="space-y-3">
              {ideas.map(idea => (
                <li key={idea.id} className="card p-4 flex items-start gap-4">
                  <button
                    onClick={() => toggleVote(idea)}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-colors shrink-0 ${
                      idea.voted
                        ? 'bg-brand-50 border-brand-300 text-brand-700'
                        : 'bg-card border-border text-muted-foreground hover:border-brand-300 hover:text-brand-600'
                    }`}
                    title={idea.voted ? 'Снять голос' : 'Проголосовать'}
                  >
                    <ThumbsUp size={18} className={idea.voted ? 'fill-current' : ''} />
                    <span className="text-sm font-semibold">{idea.votes_count}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    {idea.title && <p className="font-medium mb-0.5">{idea.title}</p>}
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words">{idea.body}</p>
                    {idea.status === 'done' && (
                      <span className="inline-block mt-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                        ✓ Сделали
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
