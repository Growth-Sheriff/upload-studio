import { Link, Outlet, useLocation, useNavigation } from '@remix-run/react'
import { Box, Frame, Loading, Navigation, Text } from '@shopify/polaris'
import {
  ChartVerticalFilledIcon,
  ChatIcon,
  CreditCardIcon,
  HomeIcon,
  ListBulletedIcon,
  MenuIcon,
  OrderIcon,
  PaintBrushFlatIcon,
  ProductIcon,
} from '@shopify/polaris-icons'
import { useCallback, useState, type ReactNode } from 'react'

interface AppFrameProps {
  shop: string
  pendingUploads?: number
  pendingQueue?: number
  /** Rendered inside the content column (never under the sidebar). */
  notice?: ReactNode
}

// Embedded Polaris frame: no TopBar (Shopify admin already has one; the
// Polaris TopBar rendered as an empty dark strip), brand block + footer in
// the sidebar, page content in the right column with a mobile menu toggle.
export function AppFrame({ shop, pendingUploads = 0, pendingQueue = 0, notice }: AppFrameProps) {
  const location = useLocation()
  // Remix navigation is client-side and single-click; page loaders can take a
  // moment, so the frame shows Polaris' progress bar until the new route
  // renders instead of leaving the click without feedback.
  const navigation = useNavigation()
  const [mobileNavigationActive, setMobileNavigationActive] = useState(false)

  const toggleMobileNavigationActive = useCallback(
    () => setMobileNavigationActive((active) => !active),
    []
  )

  const isSelected = (path: string) => {
    if (path === '/app') {
      return location.pathname === '/app' || location.pathname === '/app/'
    }
    return location.pathname.startsWith(path)
  }

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <div className="us-brand">
        <span className="us-brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M12 16V5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="m7.5 9.5 4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 15.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </span>
        <Text variant="headingMd" as="h1">
          Upload Studio
        </Text>
      </div>

      <Navigation.Section
        title="Analytics"
        items={[
          {
            url: '/app',
            label: 'Dashboard',
            icon: HomeIcon,
            selected: isSelected('/app') && !location.pathname.includes('/app/'),
          },
          {
            url: '/app/analytics/orders',
            label: 'Orders',
            icon: OrderIcon,
            selected: isSelected('/app/analytics/orders'),
          },
          {
            url: '/app/analytics',
            label: 'Reports',
            icon: ChartVerticalFilledIcon,
            selected: isSelected('/app/analytics') && !isSelected('/app/analytics/orders'),
            subNavigationItems: [
              { url: '/app/analytics', label: 'Overview' },
              { url: '/app/analytics/attribution', label: 'Attribution' },
              { url: '/app/analytics/visitors', label: 'Visitors' },
              { url: '/app/analytics/insights', label: 'AI Insights' },
              { url: '/app/analytics/cohorts', label: 'Cohorts' },
            ],
          },
        ]}
      />

      <Navigation.Section
        title="Manage"
        items={[
          {
            url: '/app/uploads',
            label: 'Uploads',
            icon: OrderIcon,
            selected: isSelected('/app/uploads'),
            badge: pendingUploads > 0 ? String(pendingUploads) : undefined,
          },
          {
            url: '/app/products',
            label: 'Products',
            icon: ProductIcon,
            selected: isSelected('/app/products'),
            subNavigationItems: [
              { url: '/app/products', label: 'All products' },
              { url: '/app/customer-pricing', label: 'Customer Special Pricing' },
            ],
          },
          {
            url: '/app/queue',
            label: 'Production Queue',
            icon: ListBulletedIcon,
            selected: isSelected('/app/queue'),
            badge: pendingQueue > 0 ? String(pendingQueue) : undefined,
          },
        ]}
      />

      <Navigation.Section
        title="Settings"
        separator
        items={[
          {
            url: '/app/billing',
            label: 'Billing',
            icon: CreditCardIcon,
            selected: isSelected('/app/billing'),
          },
          {
            url: '/app/white-label',
            label: 'Branding',
            icon: PaintBrushFlatIcon,
            selected: isSelected('/app/white-label'),
          },
          {
            url: '/app/support',
            label: 'Support',
            icon: ChatIcon,
            selected: isSelected('/app/support'),
          },
        ]}
      />

      <div className="us-sidebar-footer">
        <span className="us-sidebar-footer__by">by</span>
        <span className="us-sidebar-footer__brand">Techify Boost</span>
        <nav className="us-sidebar-footer__links" aria-label="Legal">
          <Link to="/app/legal/privacy">Privacy</Link>
          <Link to="/app/legal/terms">Terms</Link>
          <Link to="/app/legal/gdpr">GDPR</Link>
          <Link to="/app/legal/docs">Docs</Link>
          <Link to="/app/legal/changelog">Changelog</Link>
        </nav>
      </div>
    </Navigation>
  )

  return (
    <Frame
      navigation={navigationMarkup}
      showMobileNavigation={mobileNavigationActive}
      onNavigationDismiss={toggleMobileNavigationActive}
    >
      {navigation.state !== 'idle' ? <Loading /> : null}
      <div className="us-content">
        <button
          type="button"
          className="us-mobile-menu"
          onClick={toggleMobileNavigationActive}
          aria-label="Open navigation"
        >
          <MenuIcon />
          <span>Menu</span>
        </button>
        {notice ? (
          <Box paddingBlockStart="400" paddingInline="400">
            {notice}
          </Box>
        ) : null}
        <div className="us-content__page">
          <Outlet />
        </div>
      </div>
    </Frame>
  )
}

export default AppFrame
