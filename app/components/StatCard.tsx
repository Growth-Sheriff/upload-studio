import { Badge, BlockStack, Card, Icon, InlineStack, Text } from '@shopify/polaris'
import type { ReactNode } from 'react'

type Tone = 'success' | 'critical' | 'warning' | 'info' | 'attention'

export interface StatCardProps {
  title: string
  value: string | number
  subtitle?: ReactNode
  /** Colours the value (Polaris text tones; no hard-coded hex). */
  tone?: Tone
  badge?: string
  badgeTone?: Tone
  icon?: React.FunctionComponent<React.SVGProps<SVGSVGElement>>
  action?: ReactNode
}

const VALUE_TONE: Record<Tone, 'success' | 'critical' | 'caution' | 'magic' | 'subdued'> = {
  success: 'success',
  critical: 'critical',
  warning: 'caution',
  info: 'magic',
  attention: 'caution',
}

const BADGE_TONE: Record<Tone, 'success' | 'critical' | 'warning' | 'info' | 'attention'> = {
  success: 'success',
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  attention: 'attention',
}

// One KPI tile used by the dashboard and every analytics page: label on top,
// large tabular number, optional badge / subtitle / action. Pure Polaris
// primitives so it follows the admin theme automatically.
export function StatCard({ title, value, subtitle, tone, badge, badgeTone, icon, action }: StatCardProps) {
  const formatted = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <Card padding="400">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" gap="200">
          <Text as="h3" variant="bodySm" tone="subdued" fontWeight="medium">
            {title}
          </Text>
          {badge ? <Badge tone={badgeTone ? BADGE_TONE[badgeTone] : undefined}>{badge}</Badge> : icon ? <Icon source={icon} tone="subdued" /> : null}
        </InlineStack>
        <Text as="p" variant="headingLg" fontWeight="bold" tone={tone ? VALUE_TONE[tone] : undefined} numeric>
          {formatted}
        </Text>
        {subtitle ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {subtitle}
          </Text>
        ) : null}
        {action}
      </BlockStack>
    </Card>
  )
}

export default StatCard
