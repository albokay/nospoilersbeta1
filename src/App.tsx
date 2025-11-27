import { Outlet, Link } from 'react-router-dom'

export default function App() {
  return (
    <div className="min-h-screen">
      {/* Site header (fixed height 48px = h-12) */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <Link to="/" className="font-semibold tracking-tight">No-Spoilers</Link>
          <nav className="text-sm">
            <Link to="/" className="hover:underline">Home</Link>
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
