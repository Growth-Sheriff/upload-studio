const styles = {
  title: { fontSize: "1.875rem", fontWeight: 700, color: "#1f2937", marginBottom: "0.5rem" },
  subtitle: { fontSize: "0.875rem", color: "#6b7280", marginBottom: "2rem" },
  divider: { height: "1px", background: "#e5e7eb", margin: "1.5rem 0" },
  section: { marginBottom: "2rem" },
  heading: { fontSize: "1.125rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.75rem" },
  text: { color: "#4b5563", lineHeight: 1.7, marginBottom: "1rem" },
  list: { paddingLeft: "1.5rem", color: "#4b5563", lineHeight: 1.8 },
  listItem: { marginBottom: "0.5rem" },
};

export default function PrivacyPolicy() {
  return (
    <div>
      <h1 style={styles.title}>Privacy Policy</h1>
      <p style={styles.subtitle}>
        Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>
      
      <div style={styles.divider} />

      <section style={styles.section}>
        <h2 style={styles.heading}>1. Introduction</h2>
        <p style={styles.text}>
          Upload Studio ("we," "our," or "us") is committed to protecting your privacy. 
          This Privacy Policy explains how we collect, use, disclose, and safeguard your information when 
          you use our Shopify application.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>2. Information We Collect</h2>
        <p style={styles.text}>We collect information that you provide directly to us:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Store information (shop domain, email, name)</li>
          <li style={styles.listItem}>Product configuration data</li>
          <li style={styles.listItem}>Uploaded design files and images</li>
          <li style={styles.listItem}>Order customization data</li>
          <li style={styles.listItem}>Usage analytics (page views, feature usage)</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>3. How We Use Your Information</h2>
        <p style={styles.text}>We use the collected information to:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Provide and maintain our application services</li>
          <li style={styles.listItem}>Process and store product customizations</li>
          <li style={styles.listItem}>Generate print-ready files for your orders</li>
          <li style={styles.listItem}>Improve our application features and user experience</li>
          <li style={styles.listItem}>Send important notifications about your account</li>
          <li style={styles.listItem}>Provide customer support</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>4. Data Storage and Security</h2>
        <p style={styles.text}>Your data is stored securely using industry-standard practices:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>All data is encrypted in transit (TLS 1.3)</li>
          <li style={styles.listItem}>Files are stored in Cloudflare R2 with encryption at rest</li>
          <li style={styles.listItem}>Database is PostgreSQL with row-level security</li>
          <li style={styles.listItem}>Regular security audits and updates</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>5. Data Sharing</h2>
        <p style={styles.text}>We do not sell, trade, or rent your personal information. We may share data with:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Shopify (as required for app functionality)</li>
          <li style={styles.listItem}>Cloud storage providers (Cloudflare R2)</li>
          <li style={styles.listItem}>Analytics services (anonymized data only)</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>6. Data Retention</h2>
        <p style={styles.text}>We retain your data for as long as your account is active or as needed to provide services:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Upload files: 90 days after order completion</li>
          <li style={styles.listItem}>Configuration data: Until app uninstallation</li>
          <li style={styles.listItem}>Analytics data: 12 months (anonymized)</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>7. Your Rights</h2>
        <p style={styles.text}>You have the right to:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Access your personal data</li>
          <li style={styles.listItem}>Request data correction or deletion</li>
          <li style={styles.listItem}>Export your data in a portable format</li>
          <li style={styles.listItem}>Withdraw consent at any time</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>8. Contact Us</h2>
        <p style={styles.text}>If you have questions about this Privacy Policy, please contact us:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Email: <a href="mailto:privacy@uploadstudio.app.techifyboost.com" style={{ color: "#667eea" }}>privacy@uploadstudio.app.techifyboost.com</a></li>
          <li style={styles.listItem}>Website: <a href="https://uploadstudio.app.techifyboost.com" style={{ color: "#667eea" }}>uploadstudio.app.techifyboost.com</a></li>
        </ul>
      </section>
    </div>
  );
}
