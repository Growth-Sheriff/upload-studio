import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { NavLink, Outlet, useLocation } from "@remix-run/react";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  return json({});
}

const navigationItems = [
  { label: "Privacy Policy", url: "/legal/privacy", slug: "privacy" },
  { label: "Terms of Service", url: "/legal/terms", slug: "terms" },
  { label: "GDPR Compliance", url: "/legal/gdpr", slug: "gdpr" },
  { label: "Documentation", url: "/legal/docs", slug: "docs" },
  { label: "Contact", url: "/legal/contact", slug: "contact" },
  { label: "Changelog", url: "/legal/changelog", slug: "changelog" },
  { label: "Tutorial", url: "/legal/tutorial", slug: "tutorial" },
];

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  a { text-decoration: none; }
  .legal-nav-item:hover { background: rgba(102, 126, 234, 0.08) !important; }
  .legal-footer-link:hover { color: white !important; }
  @media (max-width: 900px) {
    .legal-container { flex-direction: column !important; }
    .legal-sidebar { width: 100% !important; }
  }
`;

export default function LegalLayout() {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      
      {/* Header */}
      <header style={{
        background: "rgba(255,255,255,0.1)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(255,255,255,0.2)",
        padding: "1rem 2rem",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: "1400px",
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "white" }}>
            <span style={{ fontSize: "1.25rem", fontWeight: 700 }}>Upload Studio</span>
          </div>
          <a href="/app" style={{
            color: "white",
            background: "rgba(255,255,255,0.2)",
            padding: "0.625rem 1.25rem",
            borderRadius: "8px",
            fontSize: "0.875rem",
            fontWeight: 600,
            transition: "all 0.2s",
          }}>
            Open Dashboard
          </a>
        </div>
      </header>

      {/* Main Container */}
      <div className="legal-container" style={{
        flex: 1,
        display: "flex",
        maxWidth: "1400px",
        margin: "0 auto",
        width: "100%",
        padding: "2rem",
        gap: "2rem",
      }}>
        {/* Sidebar */}
        <aside className="legal-sidebar" style={{ width: "280px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <nav style={{
            background: "rgba(255,255,255,0.98)",
            borderRadius: "16px",
            padding: "1rem",
            boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}>
            {navigationItems.map((item) => {
              const isActive = currentPath.includes(item.slug);
              return (
                <NavLink
                  key={item.slug}
                  to={item.url}
                  className="legal-nav-item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0.875rem 1rem",
                    borderRadius: "8px",
                    color: isActive ? "white" : "#374151",
                    fontSize: "0.9rem",
                    fontWeight: isActive ? 600 : 500,
                    background: isActive ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "transparent",
                    boxShadow: isActive ? "0 4px 12px rgba(102, 126, 234, 0.3)" : "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div style={{
            background: "rgba(255,255,255,0.98)",
            borderRadius: "16px",
            padding: "1.25rem",
            boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
          }}>
            <div style={{ fontWeight: 600, color: "#1f2937", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
              Need Help?
            </div>
            <div style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "1rem", lineHeight: 1.5 }}>
              Our support team is ready to assist you with any questions.
            </div>
            <a href="mailto:support@uploadstudio.app.techifyboost.com" style={{
              display: "inline-block",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              fontSize: "0.8rem",
              fontWeight: 600,
            }}>
              Contact Support
            </a>
          </div>
        </aside>

        {/* Main Content */}
        <main style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            background: "rgba(255,255,255,0.99)",
            borderRadius: "20px",
            padding: "2.5rem",
            boxShadow: "0 25px 50px rgba(0,0,0,0.15)",
            minHeight: "calc(100vh - 280px)",
          }}>
            <Outlet />
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer style={{
        background: "rgba(0,0,0,0.2)",
        backdropFilter: "blur(10px)",
        padding: "2rem",
        marginTop: "auto",
      }}>
        <div style={{
          maxWidth: "1400px",
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}>
          <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.875rem" }}>
            © {new Date().getFullYear()} Upload Studio. All rights reserved.
          </div>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            <a href="/legal/privacy" className="legal-footer-link" style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>Privacy</a>
            <a href="/legal/terms" className="legal-footer-link" style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>Terms</a>
            <a href="/legal/gdpr" className="legal-footer-link" style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>GDPR</a>
            <a href="/legal/contact" className="legal-footer-link" style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem" }}>Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
