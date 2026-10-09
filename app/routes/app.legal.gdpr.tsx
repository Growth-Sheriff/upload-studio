import type { LoaderFunctionArgs } from '@remix-run/node'
import { authenticate } from '~/shopify.server'
import { Page, Card, Button, BlockStack } from '@shopify/polaris'
import { PublicLegalContent } from '~/components/PublicLegalContent'
export async function loader({ request }: LoaderFunctionArgs) { await authenticate.admin(request); return null }
export default function Gdpr() { return <Page><Card><BlockStack gap="400"><Button url="/app/privacy">Manage privacy requests</Button><PublicLegalContent section="gdpr" /></BlockStack></Card></Page> }
