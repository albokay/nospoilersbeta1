import { useParams, Link } from 'react-router-dom'
import StickyShowBanner from '@/components/StickyShowBanner'

// Temporary mock posts — swap with Supabase later
const MOCK = {
  'breaking-bad': {
    title: 'Breaking Bad',
    seasons: [
      { n: 1, episodes: 7 },
      { n: 2, episodes: 13 },
      { n: 3, episodes: 13 },
    ],
    posts: [
      { id: 'p1', season: 1, episode: 1, author: 'ChemTeach', text: 'Pilot thoughts (no spoilers beyond S1E1)…' },
      { id: 'p2', season: 1, episode: 2, author: 'RVNomad', text: 'Reactions to the second cook.' },
      { id: 'p3', season: 2, episode: 1, author: 'Aztek', text: 'Season two opener impressions.' },
    ]
  },
  'the-bear': { title: 'The Bear', seasons: [{ n: 1, episodes: 8 }], posts: [] },
  'severance': { title: 'Severance', seasons: [{ n: 1, episodes: 9 }], posts: [] },
} as const

export default function ShowPage() {
  const { slug } = useParams()
  const data = (MOCK as any)[slug!]
  if (!data) return <div>Show not found.</div>

  return (
    <section>
      {/* Sticky banner at the very top of the Show page */}
      <StickyShowBanner title={data.title} />

      <div className="py-4 space-y-6">
        <h1 className="text-xl font-semibold">{data.title}</h1>

        <div className="flex flex-wrap gap-2">
          {data.seasons.map(s => (
            <Link key={s.n} to={`?s=${s.n}`} className="text-sm border rounded-full px-3 py-1 hover:bg-mist">
              Season {s.n}
            </Link>
          ))}
        </div>

        <div className="space-y-3">
          {data.posts.length === 0 && (
            <p className="text-gray-600 text-sm">
              No posts yet. Be the first to start a spoiler-safe thread.
            </p>
          )}
          {data.posts.map(p => (
            <article key={p.id} className="border rounded-xl p-4">
              <div className="text-xs text-gray-500">S{p.season} • E{p.episode} • by {p.author}</div>
              <div className="mt-1">{p.text}</div>
              <div className="mt-3">
                <Link to={`?s=${p.season}&e=${p.episode}`} className="text-sm underline">
                  View only up through this episode
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
