interface ChangelogEntry {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  changes: {
    category: "feature" | "fix" | "improvement" | "security" | "breaking";
    description: string;
  }[];
}

const changelog: ChangelogEntry[] = [
  {
    version: "1.2.0",
    date: "2025-06-10",
    type: "minor",
    changes: [
      { category: "feature", description: "Corporate legal pages redesign with professional styling" },
      { category: "improvement", description: "Removed decorative elements for cleaner interface" },
      { category: "feature", description: "Comprehensive changelog with full version history" },
      { category: "improvement", description: "Enhanced documentation structure" },
    ]
  },
  {
    version: "1.1.0",
    date: "2025-06-09",
    type: "minor",
    changes: [
      { category: "feature", description: "Legal pages module: Privacy Policy, Terms of Service, GDPR compliance" },
      { category: "feature", description: "Documentation hub with quick links and search" },
      { category: "feature", description: "Contact form with subject categorization" },
      { category: "feature", description: "Video tutorial page structure" },
      { category: "improvement", description: "Nested routing under /legal/* path" },
    ]
  },
  {
    version: "1.0.0",
    date: "2025-06-01",
    type: "major",
    changes: [
      { category: "feature", description: "Production release of 3D T-Shirt Designer" },
      { category: "feature", description: "Multi-location print support: front, back, left sleeve, right sleeve" },
      { category: "feature", description: "Three.js / React Three Fiber 3D rendering engine" },
      { category: "feature", description: "DTF/Sublimation print-ready file export" },
      { category: "feature", description: "Asset Sets management for product configuration" },
      { category: "feature", description: "Shopify GraphQL API 2025-10 integration" },
      { category: "feature", description: "Multi-tenant architecture with shop_id isolation" },
      { category: "feature", description: "Cloudflare R2 direct-to-storage uploads with signed URLs" },
      { category: "security", description: "GDPR-compliant data handling and webhook support" },
    ]
  },
  {
    version: "0.9.0",
    date: "2025-05-20",
    type: "minor",
    changes: [
      { category: "feature", description: "Order webhooks: orders/create, orders/paid, orders/cancelled, orders/fulfilled" },
      { category: "feature", description: "Product webhooks: products/update, products/delete" },
      { category: "feature", description: "App uninstall webhook with cleanup logic" },
      { category: "feature", description: "Queue management system for background processing" },
      { category: "improvement", description: "Webhook verification and retry mechanism" },
    ]
  },
  {
    version: "0.8.0",
    date: "2025-05-10",
    type: "minor",
    changes: [
      { category: "feature", description: "Analytics dashboard with real-time metrics" },
      { category: "feature", description: "Conversion tracking for customization flow" },
      { category: "feature", description: "Export functionality for print queue" },
      { category: "improvement", description: "Dashboard performance optimizations" },
    ]
  },
  {
    version: "0.7.0",
    date: "2025-04-28",
    type: "minor",
    changes: [
      { category: "feature", description: "Team management with role-based access control (RBAC)" },
      { category: "feature", description: "API key generation for external integrations" },
      { category: "feature", description: "White-label configuration options" },
      { category: "security", description: "Session management improvements" },
    ]
  },
  {
    version: "0.6.0",
    date: "2025-04-15",
    type: "minor",
    changes: [
      { category: "feature", description: "Billing integration with Shopify subscriptions" },
      { category: "feature", description: "Subscription tiers: Free, Starter ($19/mo), Pro ($49/mo), Enterprise" },
      { category: "feature", description: "Usage-based quotas and limits" },
      { category: "improvement", description: "Plan upgrade/downgrade flow" },
    ]
  },
  {
    version: "0.5.0",
    date: "2025-04-01",
    type: "minor",
    changes: [
      { category: "feature", description: "Upload intent system with preflight validation" },
      { category: "feature", description: "Resumable uploads for files larger than 5MB" },
      { category: "feature", description: "File type validation and DPI checking" },
      { category: "feature", description: "Upload status tracking with progress indicators" },
      { category: "improvement", description: "Rate limiting on upload endpoints" },
    ]
  },
  {
    version: "0.4.0",
    date: "2025-03-18",
    type: "minor",
    changes: [
      { category: "feature", description: "Asset Sets CRUD operations" },
      { category: "feature", description: "Print location configuration per asset set" },
      { category: "feature", description: "Product assignment to asset sets" },
      { category: "improvement", description: "Prisma schema for tenant-isolated data" },
    ]
  },
  {
    version: "0.3.0",
    date: "2025-03-05",
    type: "minor",
    changes: [
      { category: "feature", description: "Shopify theme extension with app blocks" },
      { category: "feature", description: "DTF Transfer customizer block for product pages" },
      { category: "feature", description: "Localization support: English, Turkish, German, Spanish" },
      { category: "improvement", description: "Mobile-responsive design system" },
    ]
  },
  {
    version: "0.2.0",
    date: "2025-02-20",
    type: "minor",
    changes: [
      { category: "feature", description: "Shopify OAuth authentication flow" },
      { category: "feature", description: "App Bridge navigation integration" },
      { category: "feature", description: "Session storage with Prisma" },
      { category: "security", description: "HMAC validation for embedded app requests" },
    ]
  },
  {
    version: "0.1.0",
    date: "2025-02-10",
    type: "minor",
    changes: [
      { category: "feature", description: "Initial project setup with Remix v2.15 and Vite" },
      { category: "feature", description: "PostgreSQL 16 database with Prisma ORM" },
      { category: "feature", description: "Redis 7 for caching and job queues" },
      { category: "feature", description: "Caddy reverse proxy with automatic SSL" },
      { category: "feature", description: "TypeScript strict mode configuration" },
      { category: "feature", description: "BullMQ worker architecture for background jobs" },
    ]
  },
];

const styles = {
  title: { fontSize: "1.875rem", fontWeight: 700, color: "#1f2937", marginBottom: "0.5rem" },
  subtitle: { fontSize: "0.875rem", color: "#6b7280", marginBottom: "2rem" },
  divider: { height: "1px", background: "#e5e7eb", margin: "1.5rem 0" },
  versionCard: {
    background: "#f9fafb",
    borderRadius: "8px",
    padding: "1.25rem",
    border: "1px solid #e5e7eb",
    marginBottom: "1rem"
  },
  versionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1rem",
    flexWrap: "wrap" as const
  },
  versionNumber: { fontSize: "1.125rem", fontWeight: 700, color: "#1f2937", fontFamily: "monospace" },
  date: { fontSize: "0.875rem", color: "#6b7280" },
  typeBadge: {
    padding: "3px 8px",
    borderRadius: "4px",
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase" as const
  },
  typeMajor: { background: "#fef3c7", color: "#92400e" },
  typeMinor: { background: "#dbeafe", color: "#1e40af" },
  typePatch: { background: "#d1fae5", color: "#065f46" },
  changeList: { listStyle: "none", padding: 0, margin: 0 },
  changeItem: {
    display: "flex",
    gap: "0.75rem",
    marginBottom: "0.5rem",
    fontSize: "0.875rem",
    lineHeight: 1.6
  },
  categoryBadge: {
    padding: "2px 8px",
    borderRadius: "3px",
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    flexShrink: 0
  },
  categoryFeature: { background: "#dbeafe", color: "#1e40af" },
  categoryFix: { background: "#fce7f3", color: "#9d174d" },
  categoryImprovement: { background: "#e0e7ff", color: "#3730a3" },
  categorySecurity: { background: "#fef3c7", color: "#92400e" },
  categoryBreaking: { background: "#fee2e2", color: "#991b1b" },
  changeText: { color: "#4b5563" },
  statsCard: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1rem",
    marginBottom: "1.5rem"
  },
  statBox: {
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "1rem",
    textAlign: "center" as const
  },
  statNumber: { fontSize: "1.5rem", fontWeight: 700, color: "#667eea" },
  statLabel: { fontSize: "0.75rem", color: "#6b7280", marginTop: "0.25rem" },
};

const getCategoryStyle = (category: string) => {
  switch (category) {
    case "feature": return styles.categoryFeature;
    case "fix": return styles.categoryFix;
    case "improvement": return styles.categoryImprovement;
    case "security": return styles.categorySecurity;
    case "breaking": return styles.categoryBreaking;
    default: return styles.categoryFeature;
  }
};

const getTypeStyle = (type: string) => {
  switch (type) {
    case "major": return styles.typeMajor;
    case "minor": return styles.typeMinor;
    case "patch": return styles.typePatch;
    default: return styles.typeMinor;
  }
};

export default function Changelog() {
  const totalChanges = changelog.reduce((acc, entry) => acc + entry.changes.length, 0);
  const features = changelog.reduce((acc, entry) =>
    acc + entry.changes.filter(c => c.category === "feature").length, 0);
  const improvements = changelog.reduce((acc, entry) =>
    acc + entry.changes.filter(c => c.category === "improvement").length, 0);
  const securityFixes = changelog.reduce((acc, entry) =>
    acc + entry.changes.filter(c => c.category === "security").length, 0);

  return (
    <div>
      <h1 style={styles.title}>Changelog</h1>
      <p style={styles.subtitle}>Version history and release notes</p>

      <div style={styles.divider} />


      <div style={styles.statsCard}>
        <div style={styles.statBox}>
          <div style={styles.statNumber}>{changelog.length}</div>
          <div style={styles.statLabel}>Releases</div>
        </div>
        <div style={styles.statBox}>
          <div style={styles.statNumber}>{features}</div>
          <div style={styles.statLabel}>Features</div>
        </div>
        <div style={styles.statBox}>
          <div style={styles.statNumber}>{improvements}</div>
          <div style={styles.statLabel}>Improvements</div>
        </div>
        <div style={styles.statBox}>
          <div style={styles.statNumber}>{securityFixes}</div>
          <div style={styles.statLabel}>Security Updates</div>
        </div>
      </div>


      {changelog.map((entry) => (
        <div key={entry.version} style={styles.versionCard}>
          <div style={styles.versionHeader}>
            <span style={styles.versionNumber}>v{entry.version}</span>
            <span style={{ ...styles.typeBadge, ...getTypeStyle(entry.type) }}>{entry.type}</span>
            <span style={styles.date}>{entry.date}</span>
          </div>

          <ul style={styles.changeList}>
            {entry.changes.map((change, idx) => (
              <li key={idx} style={styles.changeItem}>
                <span style={{ ...styles.categoryBadge, ...getCategoryStyle(change.category) }}>
                  {change.category}
                </span>
                <span style={styles.changeText}>{change.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <style>{`
        @media (max-width: 640px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
