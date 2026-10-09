import type { LoaderFunctionArgs } from '@remix-run/node'
import { authenticate } from '~/shopify.server'
import { Page, Card } from '@shopify/polaris'
import { PublicLegalContent } from '~/components/PublicLegalContent'
export async function loader({ request }: LoaderFunctionArgs) { await authenticate.admin(request); return null }
export default function Docs() { return <Page><Card><PublicLegalContent section="docs" /></Card></Page> }
