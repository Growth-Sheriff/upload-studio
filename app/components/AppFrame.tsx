




import { Link, Outlet, useLocation } from '@remix-run/react'
import { Frame, Navigation, Text, TopBar } from '@shopify/polaris'
import {
  ChartVerticalFilledIcon,
  ChatIcon,
  CreditCardIcon,
  HomeIcon,
  ImageIcon,
  ListBulletedIcon,
  OrderIcon,
  PaintBrushFlatIcon,
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


  const navigationMarkup = (
    <Navigation location={location.pathname}>

      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e1e3e5' }}>
        <Text variant="headingMd" as="h1">
          🎨 Custom Upload
        </Text>
        <Text variant="bodySm" as="p" tone="subdued">
          Products Design
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
        ]}
      />


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
            label: 'Support',
            icon: ChatIcon,
            selected: isSelected('/app/support'),
          },
        ]}
      />


    </Navigation>
  )


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
