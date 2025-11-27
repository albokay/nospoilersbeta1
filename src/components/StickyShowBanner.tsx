import { Link, useParams } from 'react-router-dom'

interface Props {
  title: string
  season?: number
  episode?: number
  onBack?: () => void
}

export default function StickyShowBanner({ title, season, episode, onBack }: Props) {
  const { slug } = useParams()

  return (
    // Sits right under a 48px site header (h-12). If your header is different, adjust top-12.
    <div className="sticky top-12 z-40 bg-white/80 backdrop-blur border-b">
      <div className="max-w-5xl mx-auto px-0 py-2 flex items-center justify-between">
        <div className="px-4">
          <div className="text-xs uppercase tracking-wider text-gray-500">Show</div>
          <div className="font-semibold text-lg leading-tight">{title}</div>
          <div className="text-sm text-gray-600">
            {season ? `Season ${season}` : 'All seasons'}
            {episode ? ` • Episode ${episode}` : ''}
          </div>
        </div>

        <div className="px-4">
          {/* If onBack is provided, use a button; else fall back to a Link */}
          {onBack ? (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1 text-sm border rounded-full px-3 py-1 hover:bg-mist"
            >
              ← Back to {title}
            </button>
          ) : (
            <Link
              to={`/show/${slug}`}
              className="inline-flex items-center gap-1 text-sm border rounded-full px-3 py-1 hover:bg-mist"
            >
              ← Back to {title}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
