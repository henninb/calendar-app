'use client'
import dynamic from 'next/dynamic'

const CalendarActions = dynamic(() => import('@/components/CalendarActions'), { ssr: false })
const CalendarView    = dynamic(() => import('@/components/CalendarView'),    { ssr: false })

export default function CalendarPage() {
  return (
    <>
      <CalendarActions />
      <CalendarView />
    </>
  )
}
