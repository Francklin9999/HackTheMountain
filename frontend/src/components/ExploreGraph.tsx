import { hapticTap } from '../utils/haptic'

interface RelatedArtist {
  id: string
  name: string
  relation: string
}

interface Props {
  related: RelatedArtist[]
  onSelect: (id: string) => void
}

export default function ExploreGraph({ related, onSelect }: Props) {
  return (
    <div className="explore-graph">
      <p className="explore-graph__label">Related artists</p>

      <div className="explore-graph__timeline">
        <div className="explore-graph__line" />

        <div className="explore-graph__items">
          {related.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="explore-graph__item"
              onClick={() => {
                hapticTap()
                onSelect(entry.id)
              }}
            >
              <span className="explore-graph__dot" aria-hidden="true" />

              <div className="explore-graph__copy">
                <p className="explore-graph__name">{entry.name}</p>
                <p className="explore-graph__relation">{entry.relation}</p>
              </div>

              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
