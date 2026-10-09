import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { authenticate } from '~/shopify.server'
import { Page, Card } from '@shopify/polaris'
import { PublicLegalContent } from '~/components/PublicLegalContent'
import { getPublicLegalOperator } from '~/lib/publicLegal.server'
export async function loader({ request }: LoaderFunctionArgs) { await authenticate.admin(request); return json({ publicLegalOperator: getPublicLegalOperator() }) }
export default function Dpa() { return <Page><Card><PublicLegalContent section="dpa" /></Card></Page> }
