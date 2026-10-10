import type { Card, OpenRecord } from '../../api'
import { CanvasCard } from './canvas-card'
import { ComparisonCard } from './comparison-card'
import { IdentityCard } from './identity-card'
import { JobCard } from './job-card'
import { StoryCard } from './story-card'
import { TimelineCard } from './timeline-card'

/** Renders one card attached to an answer. */
export function ChatCard({
  card,
  sessionId,
  startedAssets,
  onOpenRecord,
}: {
  card: Card
  sessionId: string
  /** Assets with a job card in this chat (their identity card is done). */
  startedAssets: ReadonlySet<string>
  onOpenRecord: (r: OpenRecord) => void
}) {
  switch (card.type) {
    case 'identity':
      return <IdentityCard identity={card.identity} sessionId={sessionId} crawlStarted={startedAssets.has(card.identity.id)} />
    case 'job':
      return <JobCard card={card} />
    case 'comparison':
      return <ComparisonCard card={card} />
    case 'timeline':
      return <TimelineCard card={card} onOpenRecord={onOpenRecord} />
    case 'canvas':
      return <CanvasCard card={card} />
    case 'story':
      return <StoryCard card={card} />
    default:
      return null
  }
}
