'use client'
import dynamic from 'next/dynamic'

const CalendarView = dynamic(() => import('@/components/CalendarView'), { ssr: false })

export default function CalendarPage() {
  return <CalendarView />
}
