'use client'
import { useState, useEffect, useCallback } from 'react'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface AlbumStat {
  album_id: string
  title: string
  city: string
  year: number
  deadline: string | null
  total: number
  submitted: number
  in_progress: number
  not_started: number
}

interface DailyPoint {
  date: string
  submitted: number
  started: number
}

interface Summary {
  total: number
  submitted: number
  in_progress: number
  not_started: number
}

// ─── Хелперы ──────────────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  if (!total) return 0
  return Math.round(n / total * 100)
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function daysLeft(deadline: string | null) {
  if (!deadline) return null
  const diff = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000)
  return diff
}

// ─── Компонент ────────────────────────────────────────────────────────────────

export default function AnalyticsModal({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [albums, setAlbums] = useState<AlbumStat[]>([])
  const [daily, setDaily] = useState<DailyPoint[]>([])
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumStat | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDaily, setLoadingDaily] = useState(false)
  const [backdropStart, setBackdropStart] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/tenant?action=analytics')
    const data = await res.json()
    setSummary(data.summary ?? null)
    setAlbums(data.albums ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadDaily = useCallback(async (album: AlbumStat) => {
    setSelectedAlbum(album)
    setLoadingDaily(true)
    const res = await fetch(`/api/tenant?action=analytics&album_id=${album.album_id}`)
    const data = await res.json()
    setDaily(data.daily ?? [])
    setLoadingDaily(false)
  }, [])

  // Авто-выбираем первый альбом для графика
  useEffect(() => {
    if (albums.length > 0 && !selectedAlbum) {
      loadDaily(albums[0])
    }
  }, [albums, selectedAlbum, loadDaily])

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-6 pb-6 px-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) setBackdropStart(true) }}
      onMouseUp={e => { if (backdropStart && e.target === e.currentTarget) onClose(); setBackdropStart(false) }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl">
        {/* Шапка */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Аналитика</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">Загрузка...</div>
        ) : (
          <div className="p-6 space-y-6">

            {/* Сводка по всем альбомам */}
            {summary && summary.total > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Все альбомы в работе
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard label="Всего учеников" value={summary.total} color="gray" />
                  <SummaryCard label="Завершили" value={summary.submitted} total={summary.total} color="green" />
                  <SummaryCard label="В процессе" value={summary.in_progress} total={summary.total} color="blue" />
                  <SummaryCard label="Не начали" value={summary.not_started} total={summary.total} color="amber" />
                </div>
                {/* Общая полоса прогресса */}
                <div className="mt-3 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                  <div className="bg-green-500 h-full transition-all" style={{ width: `${pct(summary.submitted, summary.total)}%` }} />
                  <div className="bg-blue-400 h-full transition-all" style={{ width: `${pct(summary.in_progress, summary.total)}%` }} />
                  <div className="bg-amber-300 h-full transition-all" style={{ width: `${pct(summary.not_started, summary.total)}%` }} />
                </div>
                <div className="flex gap-4 mt-1.5 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />Завершили {pct(summary.submitted, summary.total)}%</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />В процессе {pct(summary.in_progress, summary.total)}%</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-300" />Не начали {pct(summary.not_started, summary.total)}%</span>
                </div>
              </div>
            )}

            {/* Таблица альбомов */}
            {albums.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  По альбомам
                </h3>
                <div className="space-y-2">
                  {albums.map(a => {
                    const days = daysLeft(a.deadline)
                    const isSelected = selectedAlbum?.album_id === a.album_id
                    return (
                      <button
                        key={a.album_id}
                        onClick={() => loadDaily(a)}
                        className={`w-full text-left rounded-xl p-4 border-2 transition-all ${
                          isSelected ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4 mb-2.5">
                          <div>
                            <span className="font-semibold text-gray-900 text-sm">{a.title}</span>
                            {a.city && <span className="text-gray-400 text-sm"> · {a.city}</span>}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {days !== null && (
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                days < 0 ? 'bg-red-100 text-red-600' :
                                days <= 3 ? 'bg-amber-100 text-amber-700' :
                                'bg-gray-100 text-gray-500'
                              }`}>
                                {days < 0 ? `просрочен ${Math.abs(days)}д` : `${days}д до дедлайна`}
                              </span>
                            )}
                            <span className="text-xs text-gray-400">{a.total} уч.</span>
                          </div>
                        </div>

                        {/* Прогресс-бар */}
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                          <div className="bg-green-500 h-full" style={{ width: `${pct(a.submitted, a.total)}%` }} />
                          <div className="bg-blue-400 h-full" style={{ width: `${pct(a.in_progress, a.total)}%` }} />
                          <div className="bg-amber-300 h-full" style={{ width: `${pct(a.not_started, a.total)}%` }} />
                        </div>

                        <div className="flex gap-4 mt-1.5 text-xs">
                          <span className="text-green-600 font-medium">{a.submitted} завершили ({pct(a.submitted, a.total)}%)</span>
                          <span className="text-blue-500">{a.in_progress} в процессе</span>
                          <span className="text-amber-600">{a.not_started} не начали</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* График динамики */}
            {selectedAlbum && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Динамика — {selectedAlbum.title}
                </h3>
                <p className="text-xs text-gray-400 mb-3">Кликните на другой альбом выше чтобы переключить</p>
                {loadingDaily ? (
                  <div className="h-40 flex items-center justify-center text-gray-300 text-sm">Загрузка графика...</div>
                ) : daily.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-gray-300 text-sm bg-gray-50 rounded-xl">
                    Пока нет активности
                  </div>
                ) : (
                  <DailyChart daily={daily} />
                )}
              </div>
            )}

            {albums.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <p className="text-lg mb-1">Нет активных альбомов</p>
                <p className="text-sm">Создайте альбом и добавьте учеников</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Карточка итоговой статистики ─────────────────────────────────────────────

function SummaryCard({ label, value, total, color }: {
  label: string
  value: number
  total?: number
  color: 'gray' | 'green' | 'blue' | 'amber'
}) {
  const colors = {
    gray: 'bg-gray-50 text-gray-900',
    green: 'bg-green-50 text-green-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-0.5 opacity-70">{label}</p>
      {total !== undefined && (
        <p className="text-xs font-medium mt-1 opacity-80">{pct(value, total)}%</p>
      )}
    </div>
  )
}

// ─── График динамики (SVG) ────────────────────────────────────────────────────

function DailyChart({ daily }: { daily: DailyPoint[] }) {
  const maxVal = Math.max(...daily.map(d => Math.max(d.submitted, d.started)), 1)
  const W = 700
  const H = 160
  const PAD = { top: 16, right: 16, bottom: 32, left: 32 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const x = (i: number) => PAD.left + (i / (daily.length - 1 || 1)) * chartW
  const y = (v: number) => PAD.top + chartH - (v / maxVal) * chartH

  // Сглаженная линия через cubic bezier
  const line = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return `M ${points[0]?.x} ${points[0]?.y}`
    return points.map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`
      const prev = points[i - 1]
      const cpx = (prev.x + p.x) / 2
      return `C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`
    }).join(' ')
  }

  const submittedPts = daily.map((d, i) => ({ x: x(i), y: y(d.submitted) }))
  const startedPts = daily.map((d, i) => ({ x: x(i), y: y(d.started) }))

  // Область под линией (для submitted)
  const areaPath = daily.length < 2 ? '' :
    line(submittedPts) +
    ` L ${submittedPts[submittedPts.length - 1].x} ${PAD.top + chartH}` +
    ` L ${submittedPts[0].x} ${PAD.top + chartH} Z`

  // Y-gridlines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: PAD.top + chartH * (1 - f),
    label: Math.round(maxVal * f),
  }))

  return (
    <div className="bg-gray-50 rounded-xl p-4 overflow-x-auto">
      <div className="flex gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-green-500 rounded" />
          Завершили
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-blue-400 rounded border-t border-dashed border-blue-400" />
          Открыли
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {gridLines.map(gl => (
          <g key={gl.y}>
            <line x1={PAD.left} y1={gl.y} x2={W - PAD.right} y2={gl.y}
              stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD.left - 4} y={gl.y + 4} textAnchor="end"
              fontSize="9" fill="#9ca3af">{gl.label || ''}</text>
          </g>
        ))}

        {/* Область под submitted */}
        {daily.length >= 2 && (
          <path d={areaPath} fill="url(#areaGrad)" />
        )}

        {/* Линия started (пунктир) */}
        {daily.length >= 2 && (
          <path d={line(startedPts)}
            fill="none" stroke="#60a5fa" strokeWidth="2"
            strokeDasharray="4 3" strokeLinecap="round" />
        )}

        {/* Линия submitted */}
        {daily.length >= 2 && (
          <path d={line(submittedPts)}
            fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
        )}

        {/* Точки и подписи дат */}
        {daily.map((d, i) => {
          const showLabel = daily.length <= 14 || i % Math.ceil(daily.length / 14) === 0 || i === daily.length - 1
          return (
            <g key={d.date}>
              {/* Точка submitted */}
              <circle cx={x(i)} cy={y(d.submitted)} r="3.5" fill="#22c55e" />
              {d.submitted > 0 && (
                <text x={x(i)} y={y(d.submitted) - 6} textAnchor="middle"
                  fontSize="9" fill="#16a34a" fontWeight="600">{d.submitted}</text>
              )}
              {/* Точка started */}
              {d.started > 0 && (
                <circle cx={x(i)} cy={y(d.started)} r="2.5" fill="#60a5fa" />
              )}
              {/* Подпись даты */}
              {showLabel && (
                <text x={x(i)} y={H - 4} textAnchor="middle"
                  fontSize="9" fill="#9ca3af">
                  {formatDate(d.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
