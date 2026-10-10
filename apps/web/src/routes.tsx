import { Navigate, type RouteObject } from 'react-router'
import { AppLayout } from '@/components/layout/app-layout'
import { ComingSoon } from '@/components/layout/coming-soon'
import { NOT_READY_ITEMS } from '@/components/layout/nav-config'
import { Page } from '@/components/layout/page'
import { AssetLayout } from '@/features/assets/pages/asset-layout'
import { AssetSearchPage } from '@/features/assets/pages/asset-search-page'
import {
  ClinicalTab,
  CompanyIrTab,
  CompetitorsTab,
  DocumentsTab,
  EvidenceTab,
  OverviewTab,
  ConferencesTab,
  PatentsTab,
  PublicationsTab,
  RegulatoryTab,
} from '@/features/assets/pages/tabs'
import { MarketTab } from '@/features/assets/pages/market-tab'
import { LoginPage } from '@/features/auth/login-page'
import { CanvasTab } from '@/features/canvas/canvas-tab'
import { ChatPage } from '@/features/chat/chat-page'
import { JobPage, JobsPage } from '@/features/jobs/jobs-pages'
import { ProtectedRoute, RoleRoute } from '@/features/auth/route-guards'
import { HomePage } from '@/features/home/home-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { UsersPage } from '@/features/settings/users-page'

function NotFound() {
  return (
    <Page title="Page not found">
      <p className="text-text-secondary">This page doesn't exist. Use the navigation to find what you need.</p>
    </Page>
  )
}

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: '/assets', element: <AssetSearchPage /> },
          {
            path: '/assets/:assetId',
            element: <AssetLayout />,
            children: [
              { index: true, element: <Navigate to="overview" replace /> },
              { path: 'overview', element: <OverviewTab /> },
              { path: 'evidence', element: <EvidenceTab /> },
              { path: 'clinical', element: <ClinicalTab /> },
              { path: 'regulatory', element: <RegulatoryTab /> },
              { path: 'publications', element: <PublicationsTab /> },
              { path: 'conferences', element: <ConferencesTab /> },
              { path: 'documents', element: <DocumentsTab /> },
              { path: 'company-ir', element: <CompanyIrTab /> },
              { path: 'patents', element: <PatentsTab /> },
              { path: 'market', element: <MarketTab /> },
              { path: 'competitors', element: <CompetitorsTab /> },
              { path: 'canvas', element: <CanvasTab /> },
              { path: 'canvas/:canvasId', element: <CanvasTab /> },
              { path: 'canvas/story/:storyId', element: <CanvasTab /> },
            ],
          },
          { path: '/chat', element: <ChatPage /> },
          { path: '/chat/:sessionId', element: <ChatPage /> },
          { path: '/jobs', element: <JobsPage /> },
          { path: '/jobs/:jobId', element: <JobPage /> },
          ...NOT_READY_ITEMS.map((item) => ({ path: item.to, element: <ComingSoon item={item} /> })),
          { path: '/settings', element: <SettingsPage /> },
          {
            element: <RoleRoute roles={['admin']} />,
            children: [{ path: '/settings/users', element: <UsersPage /> }],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]
