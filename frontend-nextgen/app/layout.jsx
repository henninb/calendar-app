import './globals.css'
import AppHeader from '@/components/AppHeader'

export const metadata = {
  title: 'Calendar App',
  description: 'Calendar, tasks, grocery, and credit card tracker',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Set theme before React hydrates to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <div className="app">
          <AppHeader />
          <main>
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
