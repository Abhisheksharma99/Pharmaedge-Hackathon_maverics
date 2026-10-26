import { lazy, type ComponentType } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { AppLayout } from '@/components/layout/app-layout'
import { ComingSoon } from '@/components/layout/coming-soon'
import { LazyPage, NotFound } from '@/components/layout/lazy-page'
import { NOT_READY_ITEMS } from '@/components/layout/nav-config'
import { LoginPage } from '@/features/auth/login-page'
import { ProtectedRoute, RoleRoute } from '@/features/auth/route-guards'

/**
 * The shell (login, guards, layout, sidebar) is eager; every page is its own chunk, loaded on first visit.
 * Each lazy element has its own Suspense, so the layout (and an asset's header and tabs) stays on screen while
 * the page behind it loads.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return <LazyPage component={lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))} />
}

const tabs = () => import('@/features/assets/pages/tabs')
const jobs = () => import('@/features/jobs/jobs-pages')

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: page(() => import('@/features/home/home-page'), 'HomePage') },
          { path: '/assets', element: page(() => import('@/features/assets/pages/asset-search-page'), 'AssetSearchPage') },
          {
            path: '/assets/:assetId',
            element: page(() => import('@/features/assets/pages/asset-layout'), 'AssetLayout'),
            children: [
              { index: true, element: <Navigate to="overview" replace /> },
              { path: 'overview', element: page(tabs, 'OverviewTab') },
              { path: 'analytics', element: page(() => import('@/features/analytics/analytics-tab'), 'AnalyticsTab') },
              { path: 'evidence', element: page(tabs, 'EvidenceTab') },
              { path: 'clinical', element: page(tabs, 'ClinicalTab') },
              { path: 'regulatory', element: page(tabs, 'RegulatoryTab') },
              { path: 'publications', element: page(tabs, 'PublicationsTab') },
              { path: 'conferences', element: page(tabs, 'ConferencesTab') },
              { path: 'documents', element: page(tabs, 'DocumentsTab') },
              { path: 'company-ir', element: page(tabs, 'CompanyIrTab') },
              { path: 'patents', element: page(tabs, 'PatentsTab') },
              { path: 'market', element: page(() => import('@/features/assets/pages/market-tab'), 'MarketTab') },
              { path: 'competitors', element: page(tabs, 'CompetitorsTab') },
              { path: 'canvas', element: page(() => import('@/features/canvas/canvas-tab'), 'CanvasTab') },
              { path: 'canvas/:canvasId', element: page(() => import('@/features/canvas/canvas-tab'), 'CanvasTab') },
              { path: 'canvas/story/:storyId', element: page(() => import('@/features/canvas/canvas-tab'), 'CanvasTab') },
            ],
          },
          { path: '/journey', element: page(() => import('@/features/journey/journey-page'), 'JourneyPage') },
          { path: '/journey/compare', element: page(() => import('@/features/journey/compare/compare-page'), 'ComparePage') },
          { path: '/journey/:assetId', element: page(() => import('@/features/journey/journey-page'), 'JourneyPage') },
          { path: '/chat', element: page(() => import('@/features/chat/chat-page'), 'ChatPage') },
          { path: '/chat/:sessionId', element: page(() => import('@/features/chat/chat-page'), 'ChatPage') },
          { path: '/jobs', element: page(jobs, 'JobsPage') },
          { path: '/jobs/:jobId', element: page(jobs, 'JobPage') },
          ...NOT_READY_ITEMS.map((item) => ({ path: item.to, element: <ComingSoon item={item} /> })),
          { path: '/settings', element: page(() => import('@/features/settings/settings-page'), 'SettingsPage') },
          {
            element: <RoleRoute roles={['admin']} />,
            children: [{ path: '/settings/users', element: page(() => import('@/features/settings/users-page'), 'UsersPage') }],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]
