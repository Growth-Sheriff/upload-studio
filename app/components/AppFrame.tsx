/**
 * Custom Upload for Products Design - Admin Panel Frame
 * Polaris Frame with Navigation sidebar
 */

import { Link, Outlet, useLocation } from '@remix-run/react'
import { Frame, Navigation, Text, TopBar } from '@shopify/polaris'
import {
  ChartVerticalFilledIcon,
  ChatIcon,
  CreditCardIcon,
  ExportIcon,
  HomeIcon,
  ImageIcon,
  KeyIcon,
  ListBulletedIcon,
  OrderIcon,
  PaintBrushFlatIcon,
  PersonIcon,
  ProductIcon,
  SettingsIcon,
} from '@shopify/polaris-icons'
import { useCallback, useState } from 'react'

interface AppFrameProps {
  shop: string
  pendingUploads?: number
  pendingQueue?: number
}

export function AppFrame({ shop, pendingUploads = 0, pendingQueue = 0 }: AppFrameProps) {
  const location = useLocation()
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

  // Navigation structure
  const navigationMarkup = (
    <Navigation location={location.pathname}>
      {/* Logo / Brand */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e1e3e5' }}>
        <Text variant="headingMd" as="h1">
          🎨 Custom Upload
        </Text>
        <Text variant="bodySm" as="p" tone="subdued">
          Products Design
        </Text>
      </div>

      {/* Analytics Section */}
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
              {
                url: '/app/analytics',
                label: 'Overview',
              },
              {
                url: '/app/analytics/attribution',
                label: 'Attribution',
              },
              {
                url: '/app/analytics/visitors',
                label: 'Visitors',
              },
              {
                url: '/app/analytics/insights',
                label: 'AI Insights',
              },
              {
                url: '/app/analytics/cohorts',
                label: 'Cohorts',
              },
            ],
          },
        ]}
      />

      {/* Manage Section */}
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
          },
          {
            url: '/app/asset-sets',
            label: 'Asset Sets',
            icon: ImageIcon,
            selected: isSelected('/app/asset-sets'),
          },
          {
            url: '/app/queue',
            label: 'Production Queue',
            icon: ListBulletedIcon,
            selected: isSelected('/app/queue'),
            badge: pendingQueue > 0 ? String(pendingQueue) : undefined,
          },
          {
            url: '/app/exports',
            label: 'Exports',
            icon: ExportIcon,
            selected: isSelected('/app/exports'),
          },
        ]}
      />

      {/* Settings Section */}
      <Navigation.Section
        title="Settings"
        separator
        items={[
          {
            url: '/app/settings',
            label: 'General',
            icon: SettingsIcon,
            selected: isSelected('/app/settings'),
          },
          {
            url: '/app/api-keys',
            label: 'API Keys',
            icon: KeyIcon,
            selected: isSelected('/app/api-keys'),
          },
          {
            url: '/app/team',
            label: 'Team',
            icon: PersonIcon,
            selected: isSelected('/app/team'),
          },
          {
            url: '/app/billing',
            label: 'Billing',
            icon: CreditCardIcon,
            selected: isSelected('/app/billing'),
          },
          {
            url: '/app/customer-pricing',
            label: 'Customer Pricing',
            icon: CreditCardIcon,
            selected: isSelected('/app/customer-pricing'),
          },
          {
            url: '/app/white-label',
            label: 'Branding',
            icon: PaintBrushFlatIcon,
            selected: isSelected('/app/white-label'),
          },
          {
            url: '/app/support',
            label: 'Support Tickets',
            icon: ChatIcon,
            selected: isSelected('/app/support'),
          },
        ]}
      />

      {/* Resources Section */}
      <Navigation.Section
        title="Resources"
        separator
        items={[
          {
            url: '/app/support',
            label: 'Contact Us',
            icon: ChatIcon,
            selected: isSelected('/app/support'),
          },
        ]}
      />
    </Navigation>
  )

  // Footer markup - displayed at bottom of main content area
  const footerMarkup = (
    <div
      style={{
        padding: '16px 24px',
        borderTop: '1px solid #e1e3e5',
        background: '#f6f6f7',
        textAlign: 'center',
      }}
    >
      <Text variant="bodySm" as="p" tone="subdued">
        PRO Plan • v1.0.0
      </Text>
      <div
        style={{
          marginTop: '8px',
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <Link
          to="/app/legal/privacy"
          style={{ fontSize: '12px', color: '#6d7175', textDecoration: 'none' }}
        >
          Privacy
        </Link>
        <span style={{ color: '#c9cccf' }}>•</span>
        <Link
          to="/app/legal/terms"
          style={{ fontSize: '12px', color: '#6d7175', textDecoration: 'none' }}
        >
          Terms
        </Link>
        <span style={{ color: '#c9cccf' }}>•</span>
        <Link
          to="/app/legal/gdpr"
          style={{ fontSize: '12px', color: '#6d7175', textDecoration: 'none' }}
        >
          GDPR
        </Link>
        <span style={{ color: '#c9cccf' }}>•</span>
        <Link
          to="/app/legal/docs"
          style={{ fontSize: '12px', color: '#6d7175', textDecoration: 'none' }}
        >
          Docs
        </Link>
        <span style={{ color: '#c9cccf' }}>•</span>
        <Link
          to="/app/legal/changelog"
          style={{ fontSize: '12px', color: '#6d7175', textDecoration: 'none' }}
        >
          Changelog
        </Link>
      </div>
    </div>
  )

  // TopBar for mobile
  const topBarMarkup = (
    <TopBar showNavigationToggle onNavigationToggle={toggleMobileNavigationActive} />
  )

  return (
    <Frame
      navigation={navigationMarkup}
      topBar={topBarMarkup}
      showMobileNavigation={mobileNavigationActive}
      onNavigationDismiss={toggleMobileNavigationActive}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <div style={{ flex: 1 }}>
          <Outlet />
        </div>
        {footerMarkup}
      </div>
    </Frame>
  )
}

export default AppFrame
