import { json, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import prisma from "~/lib/prisma.server";
import { sendTicketConfirmation, sendTicketNotification } from "~/lib/email.server";

// Generate ticket number: UL-XXXXX
function generateTicketNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing chars
  let result = "UL-";
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const category = formData.get("category") as string;
  const subject = formData.get("subject") as string;
  const message = formData.get("message") as string;

  if (!name || !email || !subject || !message) {
    return json({ success: false, error: "All fields are required", ticketId: null });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return json({ success: false, error: "Please enter a valid email address", ticketId: null });
  }

  try {
    // Generate unique ticket number
    let ticketNumber = generateTicketNumber();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await prisma.supportTicket.findUnique({ where: { ticketNumber } });
      if (!existing) break;
      ticketNumber = generateTicketNumber();
      attempts++;
    }

    // Create support ticket
    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber,
        name,
        email,
        category: category || "general",
        subject,
        message,
        priority: category === "bug" ? "high" : "normal",
      },
    });

    // Send confirmation email to customer
    const confirmResult = await sendTicketConfirmation({
      ticketId: ticket.ticketNumber,
      name,
      email,
      subject,
      category: category || "general",
      message,
    });

    // Send notification to support team
    await sendTicketNotification({
      ticketId: ticket.ticketNumber,
      name,
      email,
      subject,
      category: category || "general",
      message,
    });

    // Update email sent timestamp
    if (confirmResult.success) {
      await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { emailSentAt: new Date() },
      });
    }

    console.log("[SUPPORT] Ticket created:", ticket.ticketNumber);
    return json({ success: true, error: null, ticketId: ticket.ticketNumber });
  } catch (error) {
    console.error("[SUPPORT] Error creating ticket:", error);
    return json({ success: false, error: "Failed to submit ticket. Please try again.", ticketId: null });
  }
}

const styles = {
  title: { fontSize: "1.875rem", fontWeight: 700, color: "#1f2937", marginBottom: "0.5rem" },
  subtitle: { fontSize: "0.875rem", color: "#6b7280", marginBottom: "2rem" },
  divider: { height: "1px", background: "#e5e7eb", margin: "1.5rem 0" },
  grid: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2rem" },
  card: { 
    background: "#f9fafb", 
    borderRadius: "8px", 
    padding: "1.5rem",
    border: "1px solid #e5e7eb",
    marginBottom: "1rem"
  },
  cardTitle: { fontSize: "1rem", fontWeight: 600, color: "#1f2937", marginBottom: "1rem" },
  formGroup: { marginBottom: "1rem" },
  label: { display: "block", fontWeight: 500, color: "#374151", marginBottom: "0.5rem", fontSize: "0.875rem" },
  input: { 
    width: "100%", 
    padding: "10px 14px", 
    border: "1px solid #d1d5db", 
    borderRadius: "6px", 
    fontSize: "0.9rem",
    outline: "none",
    transition: "border-color 0.2s",
    boxSizing: "border-box" as const
  },
  select: {
    width: "100%", 
    padding: "10px 14px", 
    border: "1px solid #d1d5db", 
    borderRadius: "6px", 
    fontSize: "0.9rem",
    background: "white",
    cursor: "pointer",
    boxSizing: "border-box" as const
  },
  textarea: { 
    width: "100%", 
    padding: "10px 14px", 
    border: "1px solid #d1d5db", 
    borderRadius: "6px", 
    fontSize: "0.9rem",
    minHeight: "120px",
    resize: "vertical" as const,
    fontFamily: "inherit",
    boxSizing: "border-box" as const
  },
  btn: { 
    background: "#667eea", 
    color: "white", 
    padding: "12px 24px", 
    border: "none", 
    borderRadius: "6px", 
    fontWeight: 600, 
    cursor: "pointer",
    fontSize: "0.9rem",
    width: "100%"
  },
  banner: { padding: "1rem", borderRadius: "6px", marginBottom: "1.5rem" },
  success: { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  error: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" },
  text: { color: "#4b5563", lineHeight: 1.6, marginBottom: "0.75rem" },
  strong: { fontWeight: 600, color: "#1f2937" },
  link: { color: "#667eea", textDecoration: "none" },
};

const subjectOptions = [
  { label: "General Inquiry", value: "general" },
  { label: "Technical Support", value: "support" },
  { label: "Billing Question", value: "billing" },
  { label: "Feature Request", value: "feature" },
  { label: "Bug Report", value: "bug" },
  { label: "Partnership", value: "partnership" },
  { label: "GDPR Request", value: "gdpr" },
];

export default function Contact() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Reset form on successful submission
  const formReset = actionData?.success ? true : false;

  return (
    <div>
      <h1 style={styles.title}>Contact Us</h1>
      <p style={styles.subtitle}>Have questions? We'd love to hear from you.</p>

      <div style={styles.divider} />

      {actionData?.success && actionData.ticketId && (
        <div style={{ ...styles.banner, ...styles.success }}>
          <strong>🎫 Ticket Created!</strong> Your ticket ID is <code style={{ background: "#bbf7d0", padding: "2px 6px", borderRadius: "4px" }}>{actionData.ticketId}</code>.
          <br />We've sent a confirmation to your email. Our team will respond within 24 hours.
        </div>
      )}

      {actionData?.error && (
        <div style={{ ...styles.banner, ...styles.error }}>
          <strong>Error:</strong> {actionData.error}
        </div>
      )}

      <div style={styles.grid}>
        <div>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Send us a message</h2>
            <Form method="post">
              <div style={styles.formGroup}>
                <label style={styles.label}>Your Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formReset ? "" : name}
                  onChange={(e) => setName(e.target.value)}
                  style={styles.input}
                  placeholder="John Doe"
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Email Address *</label>
                <input
                  type="email"
                  name="email"
                  value={formReset ? "" : email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={styles.input}
                  placeholder="john@example.com"
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Category</label>
                <select
                  name="category"
                  value={formReset ? "general" : category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={styles.select}
                >
                  {subjectOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Subject *</label>
                <input
                  type="text"
                  name="subject"
                  value={formReset ? "" : subject}
                  onChange={(e) => setSubject(e.target.value)}
                  style={styles.input}
                  placeholder="Brief description of your inquiry"
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Message *</label>
                <textarea
                  name="message"
                  value={formReset ? "" : message}
                  onChange={(e) => setMessage(e.target.value)}
                  style={styles.textarea}
                  placeholder="Please describe your question or issue in detail..."
                  required
                />
              </div>

              <button type="submit" style={styles.btn} disabled={isSubmitting}>
                {isSubmitting ? "Creating Ticket..." : "Submit Ticket"}
              </button>
            </Form>
          </div>
        </div>

        <div>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Direct Contact</h3>
            <p style={styles.text}>
              <span style={styles.strong}>General:</span><br />
              <a href="mailto:support@uploadstudio.app.techifyboost.com" style={styles.link}>support@uploadstudio.app.techifyboost.com</a>
            </p>
            <p style={styles.text}>
              <span style={styles.strong}>Sales:</span><br />
              <a href="mailto:sales@uploadstudio.app.techifyboost.com" style={styles.link}>sales@uploadstudio.app.techifyboost.com</a>
            </p>
            <p style={styles.text}>
              <span style={styles.strong}>Enterprise:</span><br />
              <a href="mailto:enterprise@uploadstudio.app.techifyboost.com" style={styles.link}>enterprise@uploadstudio.app.techifyboost.com</a>
            </p>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Response Times</h3>
            <p style={styles.text}><span style={styles.strong}>Free Plan:</span> 48-72 hours</p>
            <p style={styles.text}><span style={styles.strong}>Starter:</span> 24 hours</p>
            <p style={styles.text}><span style={styles.strong}>Pro:</span> 12 hours</p>
            <p style={styles.text}><span style={styles.strong}>Enterprise:</span> 4 hours</p>
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Office Hours</h3>
            <p style={styles.text}>
              Monday - Friday<br />
              9:00 AM - 6:00 PM (CET)
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .contact-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
