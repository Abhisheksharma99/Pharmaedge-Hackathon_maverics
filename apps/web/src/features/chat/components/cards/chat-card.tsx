import type { Card } from '../../api'
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
}: {
  card: Card
  sessionId: string
  /** Assets with a job card in this chat (their identity card is done). */
  startedAssets: ReadonlySet<string>
}) {
  switch (card.type) {
    case 'identity':
      return (
        <div className="max-w-[560px]">
          <IdentityCard identity={card.identity} sessionId={sessionId} crawlStarted={startedAssets.has(card.identity.id)} />
        </div>
      )
    case 'job':
      return (
        <div className="max-w-[560px]">
          <JobCard card={card} />
        </div>
      )
    case 'comparison':
      return <ComparisonCard card={card} />
    case 'timeline':
      return <TimelineCard card={card} />
    case 'canvas':
      return <CanvasCard card={card} />
    case 'story':
      return <StoryCard card={card} />
    default:
      return null
  }
}
