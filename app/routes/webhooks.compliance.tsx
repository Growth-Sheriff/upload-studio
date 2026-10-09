import type { ActionFunctionArgs } from '@remix-run/node'
import { receiveComplianceRequest } from '~/lib/compliance.server'
export function action({ request }: ActionFunctionArgs) { return receiveComplianceRequest(request) }
