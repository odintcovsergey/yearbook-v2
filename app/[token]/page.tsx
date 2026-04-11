'use client'

import { useEffect, useState, useCallback, memo } from 'react'
import { useParams } from 'next/navigation'
import type { Photo } from '@/types'

type StepId = 1 | 2 | 3 | 4 | 5 | 6

const STEPS = [
  { id: 1, label: 'Портрет' },
  { id: 2, label: 'Обложка' },
  { id: 4, label: 'Фото' },
  { id: 3, label: 'Текст' },
  { id: 5, label: 'Контакт' },
  { id: 6, label: 'Готово' },
]

export default function ParentPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const [childName, setChildName] = useState('')
  const [albumTitle, setAlbumTitle] = useState('')
  const [albumDeadline, setAlbumDeadline] = useState<string | null>(null)
  const [coverMode, setCoverMode] = useState<string>('none')
  const [coverPrice, setCoverPrice] = useState(0)
  const [groupEnabled, setGroupEnabled] = useState(true)
  const [groupMin, setGroupMin] = useState(2)
  const [groupMax, setGroupMax] = useState(2)
  const [groupExclusive, setGroupExclusive] = useState(true)
  const [textEnabled, setTextEnabled] = useState(true)
  const [textMaxChars, setTextMaxChars] = useState(500)
  const [portraits, setPortraits] = useState<Photo[]>([])
  const [groups, setGroups] = useState<Photo[]>([])

  const [step, setStep] = useState<StepId>(1)
  const [parentName, setParentName] = useState('')
  const [phone, setPhone] = useState('')
  const [referral, setReferral] = useState('')
  const [portraitPage, setPortraitPage] = useState<string | null>(null)
  const [coverOption, setCoverOption] = useState<'none' | 'same' | 'other'>('none')
  const [portraitCover, setPortraitCover] = useState<string | null>(null)
  const [studentText, setStudentText] = useState('')
  const [groupPhotos, setGroupPhotos] = useState<string[]>([])

  const [lightbox, setLightbox] = useState<{ photos: Photo[], index: number, onSelect?: (id: string) => void | Promise<void> } | null>(null)

  useEffect(() => {
    fetch(`/api/child?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setChildName(data.child.full_name)
        setAlbumTitle(data.album?.title ?? '')
        setAlbumDeadline(data.album?.deadline ?? null)
        setCoverMode(data.album?.cover_mode ?? 'none')
        setCoverPrice(data.album?.cover_price ?? 0)
        setGroupEnabled(data.album?.group_enabled ?? true)
        setGroupMin(data.album?.group_min ?? 2)
        setGroupMax(data.album?.group_max ?? 2)
        setGroupExclusive(data.album?.group_exclusive ?? true)
        setTextEnabled(data.album?.text_enabled ?? true)
        setTextMaxChars(data.album?.text_max_chars ?? 500)
        setPortraits(data.portraits)
        setGroups(data.groups)

        const ex = data.existing
        if (ex.contact) { setParentName(ex.contact.parent_name); setPhone(ex.contact.phone) }
        if (ex.referral) setReferral(ex.referral)
        if (ex.text) setStudentText(ex.text)
        if (ex.cover) { setCoverOption(ex.cover.cover_option); setPortraitCover(ex.cover.photo_id) }
        const pg = ex.selections.find((s: any) => s.selection_type === 'portrait_page')
        if (pg) setPortraitPage(pg.photo_id)
        const gr = ex.selections.filter((s: any) => s.selection_type === 'group').map((s: any) => s.photo_id)
        if (gr.length) setGroupPhotos(gr)

        if (data.child.submitted_at) setDone(true)
        setLoading(false)

        if (!data.child.submitted_at) {
          fetch(`/api/draft?token=${token}`)
            .then(r => r.json())
            .then(draft => {
              if (!draft) return
              if (draft.studentText) setStudentText(draft.studentText)
              if (draft.coverOption) setCoverOption(draft.coverOption)
              if (draft.portraitCover) setPortraitCover(draft.portraitCover)
              if (draft.portraitPage) setPortraitPage(draft.portraitPage)
              if (draft.groupPhotos?.length) setGroupPhotos(draft.groupPhotos)
              if (draft.step) setStep(draft.step)
            })
            .catch(() => {})
        }
      })
      .catch(() => { setError('Не удалось загрузить данные.'); setLoading(false) })
  }, [token])

  const saveDraft = useCallback(async (data: object) => {
    try {
      await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, data }),
      })
    } catch (e) {}
  }, [token])

  const lockPhoto = useCallback(async (photoId: string) => {
    const res = await fetch('/api/select', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, photoId, action: 'lock' }),
    })
    return res.ok
  }, [token])

  const unlockPhoto = useCallback(async (photoId: string) => {
    await fetch('/api/select', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, photoId, action: 'unlock' }),
    })
  }, [token])

  const toggleGroup = useCallback((id: string) => {
    if (done) return
    if (groupPhotos.includes(id)) {
      setGroupPhotos(prev => prev.filter(p => p !== id))
      if (groupExclusive) setTimeout(() => unlockPhoto(id), 0)
    } else {
      if (groupPhotos.length >= groupMax) return
      setGroupPhotos(prev => [...prev, id])
      if (groupExclusive) {
        setTimeout(async () => {
          const ok = await lockPhoto(id)
          if (!ok) {
            setGroupPhotos(prev => prev.filter(p => p !== id))
            setGroups(prev => prev.map(p => p.id === id ? { ...p, locked: true } : p))
          }
        }, 0)
      }
    }
  }, [done, groupPhotos, groupExclusive, groupMax, lockPhoto, unlockPhoto])

  const togglePortrait = useCallback((id: string) => {
    if (done) return
    if (portraitPage === id) {
      setPortraitPage(null)
      setTimeout(() => unlockPhoto(id), 0)
    } else {
      const prev = portraitPage
      setPortraitPage(id)
      setTimeout(async () => {
        if (prev) unlockPhoto(prev)
        const ok = await lockPhoto(id)
        if (!ok) {
          setPortraitPage(prev ?? null)
          setPortraits(p => p.map(ph => ph.id === id ? { ...ph, locked: true } : ph))
        }
      }, 0)
    }
  }, [done, portraitPage, lockPhoto, unlockPhoto])

  const handleSubmit = async () => {
    setSaving(true)
    const res = await fetch('/api/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, parentName, phone, portraitPage, coverOption, portraitCover, studentText, groupPhotos, referral }),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) {
      // Определить на какой шаг вернуть
      if (data.error.includes('портрет')) setStep(1)
      else if (data.error.includes('друзьями') || data.error.includes('фото с друзьями')) setStep(4)
      else if (data.error.includes('занят')) setStep(4)
      setSubmitError(data.error)
      return
    }
    setDone(true)
    setStep(6)
  }

  const effectiveSteps = STEPS.filter(s => !(s.id === 2 && coverMode === 'none') && !(s.id === 4 && !groupEnabled) && !(s.id === 3 && !textEnabled))
  const totalSteps = effectiveSteps.length
  const currentIdx = effectiveSteps.findIndex(s => s.id === step)
  const progress = ((currentIdx + 1) / totalSteps) * 100

  const goNext = () => {
    const next = effectiveSteps[currentIdx + 1]
    if (next) {
      setSubmitError('')
      setStep(next.id as StepId)
      saveDraft({ studentText, coverOption, portraitCover, portraitPage, groupPhotos, step: next.id })
    }
  }
  const goPrev = () => {
    const prev = effectiveSteps[currentIdx - 1]
    if (prev) setStep(prev.id as StepId)
  }

  if (loading) return <LoadingScreen />
  if (error && !done) return <ErrorScreen message={error} />

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50">

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={i => setLightbox(prev => prev ? { ...prev, index: i } : null)}
          onSelect={lightbox.onSelect}
          selected={[...(portraitPage ? [portraitPage] : []), ...groupPhotos]}
        />
      )}

      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">{albumTitle}</p>
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-sm font-medium text-gray-700">{childName}</h1>
            <span className="text-xs text-gray-400">{currentIdx + 1} / {totalSteps}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${done ? 100 : progress}%` }} />
          </div>
        </div>
      </div>

      {/* Предупреждение о дедлайне */}
      {albumDeadline && (() => {
        const dl = new Date(albumDeadline)
        const days = Math.ceil((dl.getTime() - Date.now()) / 86400000)
        if (days >= 0 && days <= 3) return (
          <div className={`px-4 py-3 text-sm font-medium text-center ${days === 0 ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-900'}`}>
            {days === 0
              ? '⚠️ Сегодня последний день для выбора фотографий!'
              : days === 1
              ? '⏰ Завтра истекает срок выбора фотографий'
              : `⏰ До конца выбора фотографий осталось ${days} дня`}
          </div>
        )
        return null
      })()}

      <div className="max-w-6xl mx-auto px-4 py-6">

        {step === 1 && (
          <StepCard wide title="Портрет для личной страницы" subtitle="Это фото появится на вашей личной странице в альбоме. Нажмите на фото чтобы увидеть крупнее.">
            <div className="flex items-center gap-3 mb-4">
              <span className={`badge-${portraitPage ? 'green' : 'blue'}`}>Выбрано: {portraitPage ? 1 : 0} / 1</span>
              <span className="text-xs text-gray-400">{portraits.filter(p => !p.locked).length} из {portraits.length} доступно</span>
            </div>
            {!portraitPage && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-sm text-blue-700">
                👆 Нажмите на фото чтобы выбрать — нужно выбрать <strong>1 фото</strong>
              </div>
            )}
            {portraitPage && (
              <div className="sticky top-16 z-10 bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-4 text-sm text-green-700 shadow-sm">
                ✅ Отлично! Портрет выбран — можно двигаться дальше
              </div>
            )}
            <PhotoGrid
              photos={portraits}
              selected={portraitPage ? [portraitPage] : []}
              limit={1}
              onToggle={togglePortrait}
              onLightbox={(idx) => setLightbox({
                photos: portraits,
                index: idx,
                onSelect: togglePortrait,
              })}
            />
            <div className="flex items-center justify-between mt-4">
              <button className="btn-ghost" onClick={goPrev}>← Назад</button>
            </div>
          </StepCard>
        )}
        {step === 1 && (
          <div className="sticky bottom-0 bg-white border-t border-gray-100 shadow-lg px-4 py-3 flex justify-end">
            <button className="btn-primary px-8" onClick={goNext} disabled={!portraitPage}>Далее →</button>
          </div>
        )}

        {step === 2 && coverMode !== 'none' && (
          <StepCard wide title="Портрет для обложки" subtitle="Выберите вариант оформления обложки">
            <div className="space-y-3 mb-6">
              {coverMode !== 'required' && (
                <RadioCard active={coverOption === 'none'} onClick={() => setCoverOption('none')} label="Без портрета на обложке" sub="Включено в стоимость" />
              )}
              <RadioCard active={coverOption === 'same'} onClick={() => setCoverOption('same')} label="Тот же портрет что на странице" sub="Бесплатно" />
              {portraits.length > 1 && (
                <RadioCard active={coverOption === 'other'} onClick={() => setCoverOption('other')} label="Другой портрет на обложку" sub={coverPrice > 0 ? `+ ${coverPrice} ₽` : 'Бесплатно'} paid={coverPrice > 0} />
              )}
            </div>
            {coverOption === 'other' && (
              <div className="mb-6">
                <p className="text-sm text-gray-500 mb-3">Выберите портрет для обложки:</p>
                <PhotoGrid
                  photos={portraits.filter(p => p.id !== portraitPage)}
                  selected={portraitCover ? [portraitCover] : []}
                  limit={1}
                  onToggle={(id) => setPortraitCover(prev => prev === id ? null : id)}
                  onLightbox={(idx) => setLightbox({
                    photos: portraits.filter(p => p.id !== portraitPage),
                    index: idx,
                    onSelect: (id) => setPortraitCover(prev => prev === id ? null : id),
                  })}
                  small
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <button className="btn-ghost" onClick={goPrev}>← Назад</button>
            </div>
          </StepCard>
        )}
        {step === 2 && coverMode !== 'none' && (
          <div className="sticky bottom-0 bg-white border-t border-gray-100 shadow-lg px-4 py-3 flex justify-end">
            <button className="btn-primary px-8" onClick={goNext} disabled={coverOption === 'other' && !portraitCover}>Далее →</button>
          </div>
        )}

        {step === 3 && (
          <StepCard title="Текст от ученика" subtitle="Цитата, пожелание или любимая фраза">
            <textarea className="input resize-none h-36 mb-1" placeholder="«Спасибо всем за эти годы!»" maxLength={textMaxChars} value={studentText} onChange={e => setStudentText(e.target.value)} />
            <div className="text-right text-xs text-gray-400 mb-2">
              <span className={studentText.length > textMaxChars * 0.9 ? 'text-amber-500' : ''}>{studentText.length}</span> / {textMaxChars}
            </div>
            <p className="text-xs text-gray-400 mb-6">Необязательно.</p>
            <div className="flex items-center justify-between">
              <button className="btn-ghost" onClick={goPrev}>← Назад</button>
              <button className="btn-primary" onClick={goNext}>Далее →</button>
            </div>
          </StepCard>
        )}

        {step === 4 && (
          <StepCard wide title="Фото с друзьями" subtitle="Эти фото разместятся рядом с вашим портретом на личной странице.">
            <div className="flex items-center gap-3 mb-4">
              <span className={`badge-${groupPhotos.length >= groupMin && groupPhotos.length <= groupMax ? 'green' : 'blue'}`}>
                Выбрано: {groupPhotos.length} / {groupMax}
              </span>
              <span className="text-xs text-gray-400">{groups.filter(g => !g.locked).length} из {groups.length} доступно</span>
            </div>
            {groupPhotos.length === 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-sm text-blue-700">
                👆 Нажмите на фото чтобы выбрать — нужно {groupMin === groupMax ? <>ровно <strong>{groupMin} фото</strong></> : <>от <strong>{groupMin}</strong> до <strong>{groupMax} фото</strong></>}
              </div>
            )}
            {groupPhotos.length > 0 && groupPhotos.length < groupMin && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
                👆 Выбрано {groupPhotos.length} из {groupMin} — добавьте ещё {groupMin - groupPhotos.length}
              </div>
            )}
            {groupPhotos.length >= groupMin && groupPhotos.length <= groupMax && (
              <div className="sticky top-16 z-10 bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-4 text-sm text-green-700 shadow-sm">
                ✅ Отлично! Все фото выбраны — можно двигаться дальше
              </div>
            )}
            <PhotoGrid
              photos={groups}
              selected={groupPhotos}
              limit={groupMax}
              onToggle={toggleGroup}
              onLightbox={(idx) => setLightbox({
                photos: groups,
                index: idx,
                onSelect: toggleGroup,
              })}
            />
            <div className="flex items-center justify-between mt-4">
              <button className="btn-ghost" onClick={goPrev}>← Назад</button>
            </div>
          </StepCard>
        )}
        {step === 4 && (
          <div className="sticky bottom-0 bg-white border-t border-gray-100 shadow-lg px-4 py-3 flex justify-end">
            <button className="btn-primary px-8" onClick={goNext} disabled={groupPhotos.length < groupMin || groupPhotos.length > groupMax}>Далее →</button>
          </div>
        )}

        {step === 5 && (
          <StepCard title="Ваш номер телефона" subtitle="Сообщим когда альбом будет готов к получению">
            <label className="block text-sm text-gray-500 mb-1">Ваше имя</label>
            <input className="input mb-4" placeholder="Иванова Елена Сергеевна" value={parentName} onChange={e => setParentName(e.target.value)} />
            <label className="block text-sm text-gray-500 mb-1">Номер телефона</label>
            <input className="input mb-1" type="tel" placeholder="+7 (999) 123-45-67" value={phone} onChange={e => setPhone(e.target.value)} />
            <p className="text-xs text-gray-400 mb-6">Используется только для связи по альбому. Никакой рекламы.</p>

            {/* Реферальный блок */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-6">
              <p className="text-sm font-medium text-blue-800 mb-1">🎁 Получите скидку 50%</p>
              <p className="text-sm text-blue-700 mb-3">
                Если ваши знакомые тоже закажут выпускной альбом — вы получите скидку 50% на свой.
                Оставьте их имя и телефон, и мы свяжемся с ними сами.
              </p>
              <label className="block text-xs text-blue-600 mb-1">Имя и телефон знакомых (необязательно)</label>
              <textarea
                className="input resize-none h-24 text-sm"
                placeholder={"Иванова Мария, +7 999 123-45-67\nПетров Алексей, +7 912 456-78-90"}
                value={referral}
                onChange={e => setReferral(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <button className="btn-ghost" onClick={goPrev}>← Назад</button>
              <button className="btn-primary" onClick={goNext} disabled={!phone.trim()}>Далее →</button>
            </div>
          </StepCard>
        )}

        {step === 6 && !done && (
          <StepCard title="Проверьте выбор" subtitle="После подтверждения изменить нельзя">
            <div className="space-y-5 mb-6">
              {/* Портрет */}
              <div className="py-2 border-b border-gray-100">
                <span className="text-xs text-gray-400 block mb-2">Портрет</span>
                {portraitPage ? (() => { const p = portraits.find(ph => ph.id === portraitPage); return p ? (
                  <img src={p.thumb || p.url} alt="" className="w-24 h-24 object-cover rounded-xl cursor-pointer border-2 border-blue-200"
                    onClick={() => setLightbox({ photos: portraits, index: portraits.indexOf(p), onSelect: undefined })} />
                ) : <span className="text-sm text-gray-400">—</span> })() : <span className="text-sm text-gray-400">—</span>}
              </div>
              {/* Обложка */}
              {coverMode !== 'none' && (
                <div className="py-2 border-b border-gray-100">
                  <span className="text-xs text-gray-400 block mb-2">Обложка</span>
                  {coverOption === 'none' && <span className="text-sm text-gray-700">Без портрета</span>}
                  {coverOption === 'same' && <span className="text-sm text-gray-700">Тот же портрет (бесплатно)</span>}
                  {coverOption === 'other' && (
                    <div className="flex items-center gap-3">
                      {portraitCover ? (() => { const p = portraits.find(ph => ph.id === portraitCover); return p ? (
                        <img src={p.thumb || p.url} alt="" className="w-24 h-24 object-cover rounded-xl cursor-pointer border-2 border-blue-200"
                          onClick={() => setLightbox({ photos: portraits, index: portraits.indexOf(p), onSelect: undefined })} />
                      ) : null })() : null}
                      <span className="text-sm text-green-600 font-medium">+{coverPrice} ₽</span>
                    </div>
                  )}
                </div>
              )}
              {/* Фото с друзьями */}
              {groupEnabled && (
                <div className="py-2 border-b border-gray-100">
                  <span className="text-xs text-gray-400 block mb-2">Фото с друзьями</span>
                  <div className="flex gap-2 flex-wrap">
                    {groupPhotos.map(id => { const p = groups.find(g => g.id === id); return p ? (
                      <img key={id} src={p.thumb || p.url} alt="" className="w-24 h-24 object-cover rounded-xl cursor-pointer border-2 border-blue-200"
                        onClick={() => setLightbox({ photos: groups, index: groups.indexOf(p), onSelect: undefined })} />
                    ) : null })}
                    {groupPhotos.length === 0 && <span className="text-sm text-gray-400">—</span>}
                  </div>
                </div>
              )}
              {/* Текст */}
              {textEnabled && <SummaryRow label="Текст" value={studentText || '(не заполнен)'} multiline />}
              <SummaryRow label="Телефон" value={phone} />
            </div>
            {submitError && <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-sm mb-4">{submitError}</div>}
            <div className="flex items-center justify-between">
              <button className="btn-ghost" onClick={goPrev}>← Изменить</button>
              <button className="btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? 'Сохраняю...' : 'Подтвердить ✓'}</button>
            </div>
          </StepCard>
        )}

        {done && (
          <div className="card p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
            <h2 className="text-xl font-medium text-gray-800 mb-2">Спасибо!</h2>
            <p className="text-gray-500 text-sm">Выбор для <strong>{childName}</strong> сохранён.<br />Сообщим когда альбом будет готов.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Lightbox({ photos, index, onClose, onNavigate, onSelect, selected }: {
  photos: Photo[]
  index: number
  onClose: () => void
  onNavigate: (i: number) => void
  onSelect?: (id: string) => void | Promise<void>
  selected: string[]
}) {
  const photo = photos[index]
  if (!photo) return null
  const isSelected = selected.includes(photo.id)
  const isLocked = (photo.locked ?? false) && !isSelected

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onNavigate(Math.min(index + 1, photos.length - 1))
      if (e.key === 'ArrowLeft') onNavigate(Math.max(index - 1, 0))
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [index, photos.length, onNavigate, onClose])

  // Свайп на телефоне
  const touchStart = useState<number | null>(null)
  const handleTouchStart = (e: React.TouchEvent) => { (touchStart as any)[1](e.touches[0].clientX) }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = (touchStart as any)[0]
    if (start === null) return
    const diff = start - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) {
      if (diff > 0) onNavigate(Math.min(index + 1, photos.length - 1))
      else onNavigate(Math.max(index - 1, 0))
    }
    ;(touchStart as any)[1](null)
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-white/60 text-sm">{index + 1} / {photos.length}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white text-3xl leading-none w-10 h-10 flex items-center justify-center">×</button>
      </div>

      <div className="flex-1 flex items-center justify-center relative px-4">
        {index > 0 && (
          <button onClick={() => onNavigate(index - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white text-2xl z-10">‹</button>
        )}
        <img src={photo.url} alt="" className={`max-w-full object-contain rounded-lg ${isLocked ? 'opacity-40' : ''}`} style={{maxHeight: 'calc(100vh - 220px)'}} />
        {index < photos.length - 1 && (
          <button onClick={() => onNavigate(index + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white text-2xl z-10">›</button>
        )}
      </div>

      <div className="px-4 py-3 flex items-center justify-center">
        {isLocked ? (
          <div className="text-white/40 text-sm px-6 py-3">🔒 Уже выбрано другим</div>
        ) : onSelect ? (
          <button
            onClick={() => { onSelect(photo.id); onClose() }}
            className={`px-10 py-3 rounded-xl text-sm font-medium transition-all
              ${isSelected ? 'bg-green-500 text-white' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
          >
            {isSelected ? '✓ Выбрано' : '✓ Выбрать это фото'}
          </button>
        ) : null}
      </div>

      <div className="flex gap-2 px-4 pb-4 overflow-x-auto scroll-smooth" style={{scrollSnapType:'x mandatory', WebkitOverflowScrolling:'touch'}}>
        {photos.map((p, i) => (
          <button key={p.id} onClick={() => onNavigate(i)}
            style={{scrollSnapAlign:'start'}}
            className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all
              ${i === index ? 'border-blue-400' : 'border-transparent opacity-50 hover:opacity-100'}
              ${p.locked && !selected.includes(p.id) ? 'opacity-20' : ''}`}
          >
            <img src={p.url} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}

const PhotoThumb = memo(function PhotoThumb({ photo, isSelected, isLocked, canSelect, onLightbox, onToggle, selIndex }: {
  photo: Photo; isSelected: boolean; isLocked: boolean; canSelect: boolean
  onLightbox: () => void; onToggle?: () => void; selIndex: number
}) {
  return (
    <div className="relative group photo-thumb">
      <div style={{willChange: 'transform'}} className={`w-full aspect-square rounded-xl overflow-hidden border-2 relative
        ${isSelected ? 'border-blue-500 shadow-md' : 'border-transparent'}
        ${isLocked ? 'opacity-30' : ''}`}
      >
        <img src={photo.thumb || photo.url} alt="" className="w-full h-full object-cover" loading="lazy" onError={e => { (e.target as HTMLElement).closest('.photo-thumb')?.classList.add('hidden') }} />
        {isSelected && (
          <div className="absolute top-2 right-2 w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-medium shadow">
            {selIndex + 1}
          </div>
        )}
        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/30 rounded-xl">
            <span className="text-2xl">🔒</span>
          </div>
        )}
      </div>
      {!isLocked && onToggle && (
        <button onClick={onToggle} disabled={!canSelect}
          className={`absolute bottom-2 left-2 text-xs px-2 py-1 rounded-lg font-medium transition-all
            ${isSelected ? 'bg-blue-500 text-white' : canSelect ? 'bg-white/90 text-gray-700' : 'bg-white/50 text-gray-400 cursor-not-allowed'}`}
        >
          {isSelected ? '✓' : '+'}
        </button>
      )}
      <button onClick={onLightbox}
        className="absolute bottom-2 right-2 bg-black/60 text-white text-sm w-8 h-8 flex items-center justify-center rounded-xl hover:bg-black/80 transition-all"
      >
        ⤢
      </button>
    </div>
  )
})

const PAGE_SIZE = 40

function PhotoGrid({ photos, selected, limit, onLightbox, onToggle, small = false }: {
  photos: Photo[]
  selected: string[]
  limit: number
  onLightbox: (index: number) => void
  onToggle?: (id: string) => void
  small?: boolean
}) {
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(photos.length / PAGE_SIZE)
  const start = page * PAGE_SIZE
  const pagePhotos = photos.slice(start, start + PAGE_SIZE)

  if (!photos.length) return <p className="text-gray-400 text-sm text-center py-8">Нет доступных фотографий</p>
  const cols = 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
  return (
    <div>
      <div className={`grid ${cols} gap-3`}>
        {pagePhotos.map((photo, idx) => {
          const isSelected = selected.includes(photo.id)
          const isLocked = (photo.locked ?? false) && !isSelected
          const canSelect = !isLocked && (isSelected || selected.length < limit || limit === 1)
          return (
            <PhotoThumb
              key={photo.id}
              photo={photo}
              isSelected={isSelected}
              isLocked={isLocked}
              canSelect={canSelect}
              selIndex={selected.indexOf(photo.id)}
              onLightbox={() => onLightbox(start + idx)}
              onToggle={onToggle ? () => onToggle(photo.id) : undefined}
            />
          )
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <button onClick={() => { setPage(p => Math.max(0, p - 1)); window.scrollTo(0, 0) }}
            disabled={page === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
            ← Назад
          </button>
          <span className="text-sm text-gray-500">{page + 1} / {totalPages}</span>
          <button onClick={() => { setPage(p => Math.min(totalPages - 1, p + 1)); window.scrollTo(0, 0) }}
            disabled={page === totalPages - 1}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
            Вперёд →
          </button>
        </div>
      )}
    </div>
  )
}

function StepCard({ title, subtitle, children, wide = false }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`card p-5 ${wide ? '' : 'max-w-2xl mx-auto w-full'}`}>
      <h2 className="text-lg font-medium text-gray-800 mb-1">{title}</h2>
      <p className="text-sm text-gray-400 mb-5">{subtitle}</p>
      {children}
    </div>
  )
}

function RadioCard({ active, onClick, label, sub, paid }: { active: boolean; onClick: () => void; label: string; sub: string; paid?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center gap-3 ${active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${active ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
        {active && <div className="w-2 h-2 rounded-full bg-white" />}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className={`text-xs mt-0.5 ${paid ? 'text-green-600 font-medium' : 'text-gray-400'}`}>{sub}</p>
      </div>
    </button>
  )
}

function SummaryRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="flex gap-3 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-gray-700 flex-1 break-words min-w-0 ${multiline ? 'whitespace-pre-wrap' : ''}`}>{value}</span>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card p-8 text-center max-w-sm">
        <div className="text-4xl mb-4">😕</div>
        <p className="text-sm text-gray-700 font-medium mb-2">Что-то пошло не так</p>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <button onClick={() => window.history.back()} className="btn-secondary w-full mb-3">
          ← Вернуться назад
        </button>
        <button onClick={() => window.location.reload()} className="btn-primary w-full">
          Попробовать снова
        </button>
      </div>
    </div>
  )
}
