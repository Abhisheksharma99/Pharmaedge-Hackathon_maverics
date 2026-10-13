import { useOutletContext } from 'react-router'
import type { AssetDetail } from '../api'

export const ASSET_TABS = [
  { path: 'overview', label: 'Overview' },
  { path: 'analytics', label: 'Analytics' },
  { path: 'evidence', label: 'Evidence' },
  { path: 'clinical', label: 'Clinical' },
  { path: 'regulatory', label: 'Regulatory' },
  { path: 'publications', label: 'Publications' },
  { path: 'conferences', label: 'Conferences' },
  { path: 'documents', label: 'Documents' },
  { path: 'company-ir', label: 'Company IR' },
  { path: 'patents', label: 'Patents' },
  { path: 'market', label: 'Market' },
  { path: 'competitors', label: 'Competitors' },
  { path: 'canvas', label: 'Canvas' },
] as const

/** Tabs get the loaded asset from the layout instead of refetching. */
export function useAssetContext(): AssetDetail {
  return useOutletContext<AssetDetail>()
}
