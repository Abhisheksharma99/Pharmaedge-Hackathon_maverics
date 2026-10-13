import { FlaskConical, Landmark, Megaphone, Stamp, type LucideIcon } from 'lucide-react'
import type { EventCategory } from '../api'

/** Label, icon and tone of each event category (badges, icons, filters). */
export const CATEGORY_META: Record<EventCategory, { label: string; icon: LucideIcon; tone: string }> = {
  regulatory: { label: 'Regulatory', icon: Landmark, tone: 'bg-primary-soft text-primary' },
  clinical: { label: 'Clinical', icon: FlaskConical, tone: 'bg-success-soft text-success' },
  company: { label: 'Company', icon: Megaphone, tone: 'bg-orange-soft text-orange' },
  ip: { label: 'Patents', icon: Stamp, tone: 'bg-violet-soft text-violet' },
}
