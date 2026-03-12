const styles = {
  title: { fontSize: "1.875rem", fontWeight: 700, color: "#1f2937", marginBottom: "0.5rem" },
  subtitle: { fontSize: "0.875rem", color: "#6b7280", marginBottom: "2rem" },
  divider: { height: "1px", background: "#e5e7eb", margin: "1.5rem 0" },
  section: { marginBottom: "2rem" },
  heading: { fontSize: "1.125rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.75rem" },
  text: { color: "#4b5563", lineHeight: 1.7, marginBottom: "1rem" },
  list: { paddingLeft: "1.5rem", color: "#4b5563", lineHeight: 1.8, margin: 0 },
  listItem: { marginBottom: "0.5rem" },
  btnRow: { display: "flex", flexWrap: "wrap" as const, gap: "0.75rem", marginBottom: "1.5rem" },
  btn: { 
    display: "inline-flex", 
    alignItems: "center", 
    gap: "0.5rem",
    padding: "10px 20px", 
    borderRadius: "6px", 
    textDecoration: "none", 
    fontWeight: 500, 
    fontSize: "0.875rem",
    transition: "all 0.2s",
    border: "none",
    cursor: "pointer"
  },
  btnPrimary: { background: "#667eea", color: "white" },
  btnSecondary: { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb" },
  card: { 
    background: "#f9fafb", 
    borderRadius: "8px", 
    padding: "1.25rem", 
    marginBottom: "1rem",
    border: "1px solid #e5e7eb"
  },
  cardTitle: { fontSize: "1rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.75rem" },
  itemRow: { display: "flex", gap: "0.5rem", marginBottom: "0.5rem", lineHeight: 1.6 },
  strong: { fontWeight: 600, color: "#1f2937" },
  subdued: { color: "#6b7280" },
};

const sections = [
  {
    title: "Getting Started",
    items: [
      { title: "Installation Guide", description: "How to install and set up the app" },
      { title: "Initial Configuration", description: "Configure your first product" },
      { title: "Theme Integration", description: "Add the customizer to your theme" },
    ]
  },
  {
    title: "Product Configuration",
    items: [
      { title: "Asset Sets", description: "Create and manage asset sets" },
      { title: "Print Locations", description: "Define print areas on products" },
      { title: "Size & Color Options", description: "Configure product variants" },
      { title: "T-Shirt 3D Mode", description: "Enable 3D preview for apparel" },
    ]
  },
  {
    title: "Order Management",
    items: [
      { title: "Processing Orders", description: "Handle customized orders" },
      { title: "Export Files", description: "Generate print-ready files" },
      { title: "Queue Management", description: "Manage the processing queue" },
    ]
  },
  {
    title: "API Reference",
    items: [
      { title: "REST API", description: "API endpoints documentation" },
      { title: "Webhooks", description: "Available webhook events" },
      { title: "Rate Limits", description: "API usage limits" },
    ]
  },
  {
    title: "Analytics",
    items: [
      { title: "Dashboard Overview", description: "Understanding your metrics" },
      { title: "Conversion Tracking", description: "Track customization conversions" },
      { title: "Export Reports", description: "Generate analytics reports" },
    ]
  },
];

export default function Documentation() {
  return (
    <div>
      <h1 style={styles.title}>Documentation</h1>
      <p style={styles.subtitle}>Complete guide to using Upload Studio</p>

      <div style={styles.divider} />

      <section style={styles.section}>
        <h2 style={styles.heading}>Quick Links</h2>
        <div style={styles.btnRow}>
          <a href="/app" style={{ ...styles.btn, ...styles.btnPrimary }}>
            Open App Dashboard
          </a>
          <a href="/legal/tutorial" style={{ ...styles.btn, ...styles.btnSecondary }}>
            Video Tutorial
          </a>
          <a href="/legal/changelog" style={{ ...styles.btn, ...styles.btnSecondary }}>
            View Changelog
          </a>
        </div>
      </section>

      {sections.map((section) => (
        <div key={section.title} style={styles.card}>
          <h3 style={styles.cardTitle}>{section.title}</h3>
          {section.items.map((item) => (
            <div key={item.title} style={styles.itemRow}>
              <span style={styles.strong}>{item.title}</span>
              <span style={styles.subdued}>— {item.description}</span>
            </div>
          ))}
        </div>
      ))}

      <section style={styles.section}>
        <h2 style={styles.heading}>Need More Help?</h2>
        <p style={styles.text}>Can't find what you're looking for? Our support team is here to help:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Email: <a href="mailto:support@uploadstudio.app.techifyboost.com" style={{ color: "#667eea" }}>support@uploadstudio.app.techifyboost.com</a></li>
          <li style={styles.listItem}>Response time: Within 24 hours (business days)</li>
          <li style={styles.listItem}>Enterprise customers: Priority support available</li>
        </ul>
      </section>
    </div>
  );
}
