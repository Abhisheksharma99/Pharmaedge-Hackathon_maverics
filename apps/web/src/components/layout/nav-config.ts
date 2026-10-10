import {
  Activity,
  Building2,
  CalendarDays,
  Home,
  Route,
  Search,
  Settings,
  Sparkle,
  Upload,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** false → the section shows a "coming soon" page and a "Soon" tag in the nav. */
  ready: boolean
  /** One line shown on the coming-soon page (under the title when `detail` is set, else in the card). */
  summary: string
  /** Longer coming-soon copy shown in the card. */
  detail?: string
  /**
   * Asset-scoped section: links to this tab of the last asset viewed
   * (or to Asset Search when none has been opened yet).
   */
  assetTab?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Sidebar structure from the PharmaEdge redesign (Workspace / Intelligence / Data). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Home', to: '/', icon: Home, ready: true, summary: '' },
      {
        label: 'Asset Search',
        to: '/assets',
        icon: Search,
        ready: true,
        summary: 'Every tracked asset journey, with company, indications, status and latest updates.',
      },
      {
        label: 'Asset AI',
        to: '/chat',
        icon: Sparkle,
        ready: true,
        summary: 'Ask questions across your assets and add new ones by chatting.',
      },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      {
        label: 'Asset Journey',
        to: '/assets',
        icon: Route,
        ready: true,
        summary: 'The dated journey of an asset: approvals, trials, publications, filings and milestones.',
        assetTab: 'overview',
      },
      {
        label: 'Company IR',
        to: '/assets',
        icon: Building2,
        ready: true,
        summary: 'Press releases and documents from the companies behind your assets.',
        assetTab: 'company-ir',
      },
      {
        label: 'Conferences',
        to: '/assets',
        icon: CalendarDays,
        ready: true,
        summary: 'Conference abstracts (ERS, ATS, CHEST) for tracked assets.',
        assetTab: 'conferences',
      },
    ],
  },
  {
    label: 'Data',
    items: [
      {
        label: 'Uploads',
        to: '/uploads',
        icon: Upload,
        ready: false,
        summary: 'Add your own documents to an asset journey.',
        detail: 'Drop PDFs, slide decks and internal reports onto an asset. They’ll be triaged and dated like any other source, and cited by Asset AI.',
      },
      {
        label: 'Crawl jobs',
        to: '/jobs',
        icon: Activity,
        ready: true,
        summary: 'Progress of data collection for each asset, step by step, with what was kept and why.',
      },
    ],
  },
]

export const SETTINGS_ITEM: NavItem = {
  label: 'Settings',
  to: '/settings',
  icon: Settings,
  ready: true,
  summary: '',
}

export const NOT_READY_ITEMS = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.ready)
