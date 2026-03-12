const styles = {
  title: { fontSize: "1.875rem", fontWeight: 700, color: "#1f2937", marginBottom: "0.5rem" },
  subtitle: { fontSize: "0.875rem", color: "#6b7280", marginBottom: "2rem" },
  divider: { height: "1px", background: "#e5e7eb", margin: "1.5rem 0" },
  section: { marginBottom: "2rem" },
  heading: { fontSize: "1.125rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.75rem" },
  text: { color: "#4b5563", lineHeight: 1.7, marginBottom: "1rem" },
  list: { paddingLeft: "1.5rem", color: "#4b5563", lineHeight: 1.8 },
  listItem: { marginBottom: "0.5rem" },
  strong: { fontWeight: 600, color: "#1f2937" },
};

export default function TermsOfService() {
  return (
    <div>
      <h1 style={styles.title}>Terms of Service</h1>
      <p style={styles.subtitle}>
        Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <div style={styles.divider} />

      <section style={styles.section}>
        <h2 style={styles.heading}>1. Acceptance of Terms</h2>
        <p style={styles.text}>
          By installing and using Upload Studio ("the App"), you agree to be bound by these 
          Terms of Service. If you do not agree to these terms, please do not use the App.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>2. Description of Service</h2>
        <p style={styles.text}>Upload Studio is a Shopify application that provides:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>3D product visualization and customization</li>
          <li style={styles.listItem}>Design upload and placement tools</li>
          <li style={styles.listItem}>Print-ready file generation (DTF, sublimation, etc.)</li>
          <li style={styles.listItem}>Order management with customization data</li>
          <li style={styles.listItem}>White-label branding options</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>3. Account Registration</h2>
        <p style={styles.text}>
          To use the App, you must have an active Shopify store. By installing the App, you authorize 
          us to access your Shopify store data as required to provide our services.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>4. Subscription and Billing</h2>
        <p style={styles.text}>The App offers multiple subscription tiers:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}><span style={styles.strong}>Free:</span> Basic features, limited uploads</li>
          <li style={styles.listItem}><span style={styles.strong}>Starter ($19/mo):</span> Extended limits, priority support</li>
          <li style={styles.listItem}><span style={styles.strong}>Pro ($49/mo):</span> Advanced features, API access</li>
          <li style={styles.listItem}><span style={styles.strong}>Enterprise:</span> Custom pricing - White-label, dedicated support</li>
        </ul>
        <p style={styles.text}>
          Billing is processed through Shopify's billing system. You may cancel at any time through 
          your Shopify admin panel.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>5. User Content</h2>
        <p style={styles.text}>You are responsible for all content uploaded through the App. You represent that:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>You own or have rights to use all uploaded content</li>
          <li style={styles.listItem}>Content does not infringe on third-party rights</li>
          <li style={styles.listItem}>Content is not illegal, harmful, or offensive</li>
        </ul>
        <p style={styles.text}>We reserve the right to remove content that violates these terms.</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>6. Intellectual Property</h2>
        <p style={styles.text}>
          The App, including its code, design, and documentation, is owned by us and protected by 
          intellectual property laws. You may not copy, modify, or distribute any part of the App 
          without our written permission.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>7. Limitation of Liability</h2>
        <p style={styles.text}>The App is provided "as is" without warranties of any kind. We are not liable for:</p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Data loss or service interruptions</li>
          <li style={styles.listItem}>Inaccurate output or print quality issues</li>
          <li style={styles.listItem}>Third-party service failures</li>
          <li style={styles.listItem}>Indirect or consequential damages</li>
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>8. Termination</h2>
        <p style={styles.text}>
          We may suspend or terminate your access to the App if you violate these terms. Upon 
          termination, your data will be handled according to our Privacy Policy and GDPR requirements.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>9. Changes to Terms</h2>
        <p style={styles.text}>
          We may update these terms from time to time. Continued use of the App after changes 
          constitutes acceptance of the updated terms.
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>10. Contact</h2>
        <p style={styles.text}>
          For questions about these terms, contact us at{" "}
          <a href="mailto:legal@uploadstudio.app.techifyboost.com" style={{ color: "#667eea" }}>legal@uploadstudio.app.techifyboost.com</a>
        </p>
      </section>
    </div>
  );
}
