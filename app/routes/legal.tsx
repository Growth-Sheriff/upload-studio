import { Link, Outlet } from '@remix-run/react'
import { json } from '@remix-run/node'
import { getPublicLegalOperator } from '~/lib/publicLegal.server'
export function loader() { return json({ publicLegalOperator: getPublicLegalOperator() }) }
export default function LegalLayout() {
  return <div style={{ maxWidth: '850px', margin: 'auto', padding: '2rem', fontFamily: 'system-ui, sans-serif', color: '#202223' }}>
    <header><Link to="/app">Auto Gang Sheet Upload</Link></header>
    <nav aria-label="Policies and support" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBlock: '1.5rem' }}>
      <Link to="/legal/privacy">Privacy</Link><Link to="/legal/terms">Terms</Link><Link to="/legal/dpa">Data processing</Link><Link to="/legal/gdpr">Privacy requests</Link><Link to="/legal/docs">Help</Link><Link to="/legal/contact">Support</Link>
    </nav>
    <main><Outlet /></main>
  </div>
}
