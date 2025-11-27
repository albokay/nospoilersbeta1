import { Link } from 'react-router-dom'

const MOCK_SHOWS = [
  { slug: 'breaking-bad', title: 'Breaking Bad' },
  { slug: 'the-bear', title: 'The Bear' },
  { slug: 'severance', title: 'Severance' },
]

export default function Home() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Choose a show</h1>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MOCK_SHOWS.map(s => (
          <li key={s.slug}>
            <Link to={`/show/${s.slug}`} className="block border rounded-xl p-4 hover:shadow">
              {s.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
