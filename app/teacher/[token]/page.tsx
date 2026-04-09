'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Photo = { id: string; filename: string; storage_path: string; url: string }
type Teacher = { id: string; full_name: string; position: string; photo_id: string | null; submitted_at: string | null }

export default function TeacherPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [albumTitle, setAlbumTitle] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [done, setDone] = useState(false)
  const [lightbox, setLightbox] = useState<{photos: Photo[], index: number, teacherId?: string} | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = () => {
    fetch(`/api/teacher?token=${token}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setAlbumTitle(data.album?.title ?? '')
        setPhotos(data.photos ?? [])
        setTeachers(data.teachers ?? [])
        setLoading(false)
      })
      .catch(() => { setError('Ошибка загрузки'); setLoading(false) })
  }

  useEffect(() => { load() }, [token])

  const addTeacher = async () => {
    const res = await fetch('/api/teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'create' }),
    })
    const teacher = await res.json()
    setTeachers(prev => [...prev, { ...teacher, photo_id: null }])
    setEditingId(teacher.id)
  }

  const saveTeacher = async (t: Teacher) => {
    await fetch('/api/teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'save', teacher_id: t.id, full_name: t.full_name, position: t.position, photo_id: t.photo_id }),
    })
    setEditingId(null)
    load()
  }

  const deleteTeacher = async (id: string) => {
    if (!confirm('Удалить карточку учителя?')) return
    await fetch('/api/teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'delete', teacher_id: id }),
    })
    setTeachers(prev => prev.filter(t => t.id !== id))
  }

  const updateLocal = (id: string, field: string, value: string | null) => {
    setTeachers(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
  }

  const handleSubmit = async () => {
    // Сохранить все несохранённые
    for (const t of teachers) {
      if (!t.full_name?.trim()) { alert(`Укажите ФИО для учителя`); return }
    }
    await fetch('/api/teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'submit' }),
    })
    setDone(true)
  }

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

      {lightbox && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-white/60 text-sm">{lightbox.index + 1} / {lightbox.photos.length}</span>
            <button onClick={() => setLightbox(null)} className="text-white text-3xl w-10 h-10 flex items-center justify-center">×</button>
          </div>
          <div className="flex-1 flex items-center justify-center relative px-12">
            {lightbox.index > 0 && (
              <button onClick={() => setLightbox(prev => prev ? {...prev, index: prev.index - 1} : null)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white text-2xl">‹</button>
            )}
            <img src={lightbox.photos[lightbox.index]?.url} alt="" className="max-w-full object-contain rounded-lg" style={{maxHeight: 'calc(100vh - 220px)'}} />
            {lightbox.index < lightbox.photos.length - 1 && (
              <button onClick={() => setLightbox(prev => prev ? {...prev, index: prev.index + 1} : null)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white text-2xl">›</button>
            )}
          </div>
          {lightbox.teacherId && (
            <div className="px-4 py-2 flex justify-center">
              <button
                onClick={() => {
                  const photo = lightbox.photos[lightbox.index]
                  const t = teachers.find(t => t.id === lightbox.teacherId)
                  updateLocal(lightbox.teacherId!, 'photo_id', t?.photo_id === photo.id ? null : photo.id)
                  setLightbox(null)
                }}
                className={`px-10 py-3 rounded-xl text-sm font-medium
                  ${teachers.find(t => t.id === lightbox.teacherId)?.photo_id === lightbox.photos[lightbox.index]?.id
                    ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}`}
              >
                {teachers.find(t => t.id === lightbox.teacherId)?.photo_id === lightbox.photos[lightbox.index]?.id
                  ? '✕ Отменить' : '✓ Выбрать это фото'}
              </button>
            </div>
          )}
          <div className="flex gap-2 px-4 pb-4 overflow-x-auto justify-center flex-wrap">
            {lightbox.photos.map((p, i) => (
              <button key={p.id} onClick={() => setLightbox(prev => prev ? {...prev, index: i} : null)}
                className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all
                  ${i === lightbox.index ? 'border-blue-400' : 'border-transparent opacity-50 hover:opacity-100'}`}
              >
                <img src={p.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <p className="text-xs text-gray-400">{albumTitle}</p>
          <h1 className="text-sm font-medium text-gray-700">Данные учителей</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {done ? (
          <div className="card p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
            <h2 className="text-xl font-medium text-gray-800 mb-2">Спасибо!</h2>
            <p className="text-gray-500 text-sm">Данные учителей сохранены.</p>
          </div>
        ) : (
          <>
            <div className="card p-4">
              <p className="text-sm text-gray-500">
                Для каждого учителя выберите фото, введите ФИО и должность. Нажмите <strong>+ Добавить учителя</strong> чтобы создать новую карточку.
              </p>
            </div>

            {photos.length === 0 && (
              <div className="card p-6 text-center text-amber-600 text-sm bg-amber-50 border border-amber-100">
                Фотографии учителей ещё не загружены. Обратитесь к организатору.
              </div>
            )}

            {teachers.map((teacher, idx) => {
              const selectedPhoto = photos.find(p => p.id === teacher.photo_id)
              const isEditing = editingId === teacher.id
              return (
                <div key={teacher.id} className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-700">Учитель {idx + 1}</h3>
                    <div className="flex gap-2">
                      {!isEditing && (
                        <button onClick={() => setEditingId(teacher.id)} className="text-blue-500 text-xs hover:underline">Изменить</button>
                      )}
                      <button onClick={() => deleteTeacher(teacher.id)} className="text-red-400 text-xs hover:underline">Удалить</button>
                    </div>
                  </div>

                  {isEditing ? (
                    <>
                      <label className="block text-xs text-gray-500 mb-1">Фото</label>
                      {photos.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 mb-4">
                          {photos.map((photo, pidx) => {
                            const isSelected = teacher.photo_id === photo.id
                            return (
                              <div key={photo.id} className="relative group">
                                <div className={`relative aspect-square rounded-xl overflow-hidden border-2
                                  ${isSelected ? 'border-blue-500 shadow-md' : 'border-transparent'}`}>
                                  <img src={photo.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                                  {isSelected && (
                                    <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">✓</div>
                                  )}
                                </div>
                                <button onClick={() => updateLocal(teacher.id, 'photo_id', isSelected ? null : photo.id)}
                                  className={`absolute bottom-1 left-1 text-xs px-1.5 py-0.5 rounded-lg font-medium
                                    ${isSelected ? 'bg-blue-500 text-white' : 'bg-white/90 text-gray-700'}`}
                                >{isSelected ? '✓' : '+'}</button>
                                <button onClick={() => setLightbox({photos, index: pidx, teacherId: teacher.id})}
                                  className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded-lg">⤢</button>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <label className="block text-xs text-gray-500 mb-1">ФИО полностью</label>
                      <input className="input mb-3" placeholder="Иванова Елена Сергеевна"
                        value={teacher.full_name}
                        onChange={e => updateLocal(teacher.id, 'full_name', e.target.value)} />

                      <label className="block text-xs text-gray-500 mb-1">Должность / предмет</label>
                      <input className="input mb-4" placeholder="Классный руководитель, математика"
                        value={teacher.position}
                        onChange={e => updateLocal(teacher.id, 'position', e.target.value)} />

                      <button onClick={() => saveTeacher(teacher)} className="btn-primary w-full">
                        Сохранить карточку ✓
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-4 items-center">
                      {selectedPhoto && (
                        <img src={selectedPhoto.url} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                      )}
                      {!selectedPhoto && (
                        <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-300 text-2xl">?</div>
                      )}
                      <div>
                        <p className="font-medium text-gray-800">{teacher.full_name || <span className="text-gray-400 italic">Не заполнено</span>}</p>
                        <p className="text-sm text-gray-500">{teacher.position || '—'}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {photos.length > 0 && (
              <button onClick={addTeacher} className="btn-secondary w-full">
                + Добавить учителя
              </button>
            )}

            {teachers.length > 0 && (
              <button onClick={handleSubmit} className="btn-primary w-full">
                Сохранить всё и завершить ✓
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
