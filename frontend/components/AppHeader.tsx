'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/calendar',     label: '📅 Calendar' },
  { href: '/upcoming',     label: '📋 Upcoming' },
  { href: '/credit-cards', label: '💳 Credit Cards' },
  { href: '/tasks',        label: '✅ Tasks' },
  { href: '/grocery',      label: '🛒 Grocery' },
  { href: '/config',       label: '⚙️ Config' },
]

export default function AppHeader() {
  const pathname = usePathname()
  const [darkMode, setDarkMode] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    const dark = saved !== null ? saved === 'dark' : true
    setDarkMode(dark)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
    localStorage.setItem('theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  return (
    <header>
      <h1>📅 Calendar App</h1>
      <nav>
        {TABS.map(t => (
          <Link
            key={t.href}
            href={t.href}
            className={pathname === t.href ? 'active' : ''}
            title={`Switch to ${t.label} view`}
          >
            {t.label}
          </Link>
        ))}
        <button
          onClick={() => setDarkMode(d => !d)}
          title="Toggle dark/light mode"
          className="ml-2"
        >
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
      </nav>
    </header>
  )
}
