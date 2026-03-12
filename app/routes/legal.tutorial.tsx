interface TutorialStep {
  number: number;
  title: string;
  duration: string;
  description: string;
  topics: string[];
}

const tutorialSteps: TutorialStep[] = [
  {
    number: 1,
    title: "App Installation & Setup",
    duration: "3 min",
    description: "Install the app from Shopify App Store and complete initial configuration.",
    topics: ["Installing from Shopify App Store", "Granting required permissions", "Initial dashboard overview", "Connecting your first product"]
  },
  {
    number: 2,
    title: "Creating Asset Sets",
    duration: "5 min",
    description: "Learn how to create and configure asset sets for your products.",
    topics: ["What are Asset Sets?", "Creating a new asset set", "Configuring print locations", "Setting upload rules and limits"]
  },
  {
    number: 3,
    title: "3D T-Shirt Configuration",
    duration: "7 min",
    description: "Set up the 3D T-Shirt designer for your apparel products.",
    topics: ["Enabling 3D mode", "Selecting product variants", "Configuring print positions", "Setting DPI and size limits", "Testing the 3D preview"]
  },
  {
    number: 4,
    title: "Theme Integration",
    duration: "4 min",
    description: "Add the customizer blocks to your Shopify theme.",
    topics: ["Accessing Theme Editor", "Adding the DTF Transfer block", "Positioning the widget", "Mobile responsiveness", "Testing on product pages"]
  },
  {
    number: 5,
    title: "Processing Orders",
    duration: "5 min",
    description: "Handle orders with customizations and generate print files.",
    topics: ["Viewing customized orders", "Downloading customer designs", "Generating print-ready files", "Order fulfillment workflow"]
  },
  {
    number: 6,
    title: "Analytics & Reporting",
    duration: "3 min",
    description: "Track performance and understand your customization data.",
    topics: ["Dashboard metrics overview", "Conversion tracking", "Popular products and designs", "Exporting reports"]
  }
];

const styles = {
  title: { fontSize: "1.875rem", fontWeight: 700, color: "#1f2937", marginBottom: "0.5rem" },
  subtitle: { fontSize: "0.875rem", color: "#6b7280", marginBottom: "2rem" },
  divider: { height: "1px", background: "#e5e7eb", margin: "1.5rem 0" },
  section: { marginBottom: "2rem" },
  heading: { fontSize: "1.125rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.75rem" },
  card: { 
    background: "#f9fafb", 
    borderRadius: "8px", 
    padding: "1.25rem",
    border: "1px solid #e5e7eb",
    marginBottom: "1rem"
  },
  cardHeader: { display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" as const },
  badge: { 
    background: "#667eea", 
    color: "white", 
    padding: "4px 12px", 
    borderRadius: "4px", 
    fontSize: "0.75rem", 
    fontWeight: 500 
  },
  durationBadge: { 
    background: "#e5e7eb", 
    color: "#374151", 
    padding: "4px 10px", 
    borderRadius: "4px", 
    fontSize: "0.7rem", 
    fontWeight: 600 
  },
  videoPlaceholder: { 
    backgroundColor: "#1f2937", 
    borderRadius: "8px", 
    aspectRatio: "16/9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column" as const,
    gap: "0.5rem",
    minHeight: "300px",
    marginBottom: "1rem"
  },
  playBtn: { 
    width: "60px", 
    height: "60px", 
    borderRadius: "50%", 
    background: "rgba(255,255,255,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.5rem",
    color: "white"
  },
  text: { color: "#4b5563", lineHeight: 1.7 },
  subdued: { color: "#9ca3af" },
  stepCard: { display: "flex", gap: "1rem", alignItems: "flex-start" },
  stepNumber: { 
    width: "36px", 
    height: "36px", 
    borderRadius: "50%", 
    background: "#667eea",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    flexShrink: 0,
    fontSize: "0.9rem"
  },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: "1rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.25rem" },
  stepDesc: { color: "#6b7280", fontSize: "0.875rem", marginBottom: "0.5rem" },
  topicList: { display: "flex", flexWrap: "wrap" as const, gap: "0.5rem" },
  topicBadge: { 
    background: "#e5e7eb", 
    color: "#374151", 
    padding: "4px 10px", 
    borderRadius: "4px", 
    fontSize: "0.75rem" 
  },
  tipList: { paddingLeft: "1.5rem", color: "#4b5563", lineHeight: 1.8, margin: 0 },
  ctaCard: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" as const, gap: "1rem" },
  ctaText: { flex: 1 },
  ctaTitle: { fontWeight: 600, color: "#1f2937", marginBottom: "0.25rem" },
  ctaDesc: { color: "#6b7280", fontSize: "0.875rem" },
  btn: { 
    background: "#667eea", 
    color: "white", 
    padding: "10px 20px", 
    border: "none", 
    borderRadius: "6px", 
    fontWeight: 600, 
    textDecoration: "none",
    display: "inline-block",
    fontSize: "0.875rem"
  },
};

export default function Tutorial() {
  return (
    <div>
      <h1 style={styles.title}>Video Tutorial</h1>
      <p style={styles.subtitle}>Step-by-step guide to mastering Upload Studio</p>

      <div style={styles.divider} />

      {/* Main Video */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <span style={styles.badge}>Full Course</span>
          <span style={{ ...styles.subdued, fontSize: "0.875rem" }}>27 minutes total</span>
        </div>
        <h2 style={styles.heading}>Complete Setup Guide</h2>

        <div style={styles.videoPlaceholder}>
          <div style={styles.playBtn}>▶</div>
          <span style={styles.subdued}>Video coming soon...</span>
        </div>

        <p style={styles.text}>
          This comprehensive tutorial walks you through the entire setup process, 
          from installation to processing your first customized order.
        </p>
      </div>

      {/* Chapter List */}
      <section style={styles.section}>
        <h2 style={styles.heading}>Chapters</h2>

        {tutorialSteps.map((step) => (
          <div key={step.number} style={styles.card}>
            <div style={styles.stepCard}>
              <div style={styles.stepNumber}>{step.number}</div>
              <div style={styles.stepContent}>
                <div style={styles.cardHeader}>
                  <span style={styles.stepTitle}>{step.title}</span>
                  <span style={styles.durationBadge}>{step.duration}</span>
                </div>
                <p style={styles.stepDesc}>{step.description}</p>
                <div style={styles.topicList}>
                  {step.topics.map((topic, idx) => (
                    <span key={idx} style={styles.topicBadge}>{topic}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Quick Tips */}
      <div style={styles.card}>
        <h2 style={styles.heading}>Quick Tips</h2>
        <ul style={styles.tipList}>
          <li>Start with a single product to test the workflow</li>
          <li>Use high-quality 3D model files for better previews</li>
          <li>Test on mobile devices - many customers use phones</li>
          <li>Set appropriate file size limits for your print quality needs</li>
          <li>Enable email notifications for new orders</li>
        </ul>
      </div>

      {/* Support CTA */}
      <div style={styles.card}>
        <div style={styles.ctaCard}>
          <div style={styles.ctaText}>
            <div style={styles.ctaTitle}>Need personalized help?</div>
            <div style={styles.ctaDesc}>Book a free 15-minute onboarding call with our team.</div>
          </div>
          <a href="/legal/contact" style={styles.btn}>Contact Support</a>
        </div>
      </div>
    </div>
  );
}
