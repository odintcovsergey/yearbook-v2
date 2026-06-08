'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function ReferralPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [referrerName, setReferrerName] = useState('')
  const [program, setProgram] = useState<{
    reward_text: string | null
    description: string | null
    image_url: string | null
  } | null>(null)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [school, setSchool] = useState('')
  const [className, setClassName] = useState('')

  useEffect(() => {
    fetch(`/api/referral?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setReferrerName(data.referrerName ?? '')
        setProgram(data.program ?? null)
        setLoading(false)
      })
      .catch(() => { setError('Ошибка загрузки'); setLoading(false) })
  }, [token])

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim() || !city.trim()) return
    setSending(true)
    const res = await fetch('/api/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name: name.trim(), phone: phone.trim(), city: city.trim(), school: school.trim(), class_name: className.trim() }),
    })
    setSending(false)
    if (res.ok) setSent(true)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
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
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50">
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">📸</div>
          <h1 className="text-2xl font-semibold text-gray-800 mb-2">Выпускные альбомы</h1>
          <p className="text-gray-500 text-sm">Красивые фотоальбомы для детских садов и школ</p>
        </div>

        {sent ? (
          <div className="card p-8 text-center">
            <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
            <h2 className="text-xl font-medium text-gray-800 mb-2">Заявка отправлена!</h2>
            <p className="text-gray-500 text-sm">Мы свяжемся с вами в ближайшее время, чтобы обсудить детали.</p>
          </div>
        ) : (
          <>
            {/* Referrer badge — имя того, кто рекомендует, показываем всегда. */}
            {referrerName && (
              <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4 mb-6 text-center">
                <p className="text-sm text-brand-700">
                  Вас рекомендует <strong>{referrerName}</strong>
                </p>
              </div>
            )}

            {program ? (
              /* Награда реферала из программы: картинка + текст + условия.
                 Картинку показываем целиком (по ширине), без обрезки. */
              <div className="card overflow-hidden mb-6">
                {program.image_url && (
                  <img
                    src={program.image_url}
                    alt=""
                    className="max-h-80 w-auto max-w-full mx-auto block"
                  />
                )}
                <div className="p-5">
                  {program.reward_text && (
                    <p className="text-lg font-semibold text-gray-800 mb-2">🎁 {program.reward_text}</p>
                  )}
                  {program.description && (
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{program.description}</p>
                  )}
                </div>
              </div>
            ) : (
              /* Дефолтный блок «Что вы получите» (программа не назначена). */
              <div className="card p-5 mb-6">
                <h2 className="text-base font-medium text-gray-800 mb-3">Что вы получите</h2>
                <div className="space-y-3">
                  <div className="flex gap-3 items-start">
                    <span className="text-lg">🎨</span>
                    <p className="text-sm text-gray-600">Профессиональная фотосъёмка и вёрстка альбома</p>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="text-lg">📱</span>
                    <p className="text-sm text-gray-600">Удобная онлайн-система — родители сами выбирают фото</p>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="text-lg">📖</span>
                    <p className="text-sm text-gray-600">Готовый альбом в твёрдой обложке с индивидуальным дизайном</p>
                  </div>
                </div>
              </div>
            )}

            {/* Form */}
            <div className="card p-5">
              <h2 className="text-base font-medium text-gray-800 mb-1">Оставить заявку</h2>
              <p className="text-sm text-gray-500 mb-4">Заполните форму — мы свяжемся с вами и расскажем подробности</p>

              <label className="block text-xs text-gray-500 mb-1">Ваше имя *</label>
              <input className="input mb-3" placeholder="Иванова Елена" value={name} onChange={e => setName(e.target.value)} />

              <label className="block text-xs text-gray-500 mb-1">Телефон *</label>
              <input className="input mb-3" type="tel" placeholder="+7 (999) 123-45-67" value={phone} onChange={e => setPhone(e.target.value)} />

              <label className="block text-xs text-gray-500 mb-1">Город *</label>
              <input className="input mb-3" placeholder="Москва, Казань, Новосибирск..." value={city} onChange={e => setCity(e.target.value)} />

              <label className="block text-xs text-gray-500 mb-1">Школа / детский сад</label>
              <input className="input mb-3" placeholder="Название учреждения" value={school} onChange={e => setSchool(e.target.value)} />

              <label className="block text-xs text-gray-500 mb-1">Класс / группа</label>
              <input className="input mb-5" placeholder="4-А, подготовительная группа..." value={className} onChange={e => setClassName(e.target.value)} />

              <button className="btn-primary w-full" onClick={handleSubmit} disabled={!name.trim() || !phone.trim() || !city.trim() || sending}>
                {sending ? 'Отправляю...' : 'Отправить заявку'}
              </button>

              <p className="text-xs text-gray-400 mt-3 text-center">
                Нажимая «Отправить заявку», вы даёте согласие на обработку персональных данных в соответствии с{' '}
                <a href="/privacy" target="_blank" className="text-brand-600 hover:underline">Политикой конфиденциальности</a>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
