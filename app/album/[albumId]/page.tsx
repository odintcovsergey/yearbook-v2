'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

type Child = { id: string; full_name: string; class: string; access_token: string; submitted_at: string | null }

export default function AlbumPage() {
  const { albumId } = useParams<{ albumId: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [albumTitle, setAlbumTitle] = useState('')
  const [children, setChildren] = useState<Child[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch(`/api/album?album_id=${albumId}&_=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setAlbumTitle(data.title)
        setChildren(data.children)
        setLoading(false)
      })
      .catch(() => { setError('Ошибка загрузки'); setLoading(false) })
  }, [albumId])

  const filtered = children.filter(c =>
    c.full_name.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 text-center max-w-sm">
        <div className="text-4xl mb-4">😕</div>
        <p className="text-gray-500 text-sm">{error}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-4">
          <h1 className="text-lg font-medium text-gray-800">{albumTitle}</h1>
          <p className="text-sm text-gray-400">Выберите вашего ребёнка</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <input
          className="input mb-4 bg-white"
          placeholder="Поиск по имени..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className="space-y-2">
          {filtered.map(child => (
            <button
              key={child.id}
              onClick={() => router.push(`/${child.access_token}`)}
              className="w-full card p-4 text-left hover:border-blue-200 hover:shadow-md transition-all flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-gray-800">{child.full_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{child.class}</p>
              </div>
              {child.submitted_at
                ? <span className="badge-green text-xs">✓ Выбрано</span>
                : <span className="text-blue-400 text-sm">→</span>
              }
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-8">Ничего не найдено</p>
          )}
        </div>
      </div>
    </div>
  )
}
