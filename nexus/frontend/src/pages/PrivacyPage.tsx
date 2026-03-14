export default function PrivacyPage() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#0a0a0f',
      color: '#e0e0e8',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '60px 24px',
      overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: '#3de8b0', letterSpacing: '-0.5px' }}>NEXUS</span>
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px', color: '#fff' }}>Privacy Policy</h1>
          <p style={{ color: '#7a7a90', fontSize: 14, margin: 0 }}>Last updated: March 14, 2026</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>

          <section>
            <h2 style={h2}>Overview</h2>
            <p style={p}>
              NEXUS is a personal dashboard application built and operated by Leon Buchmiller,
              available at{' '}
              <a href="https://nexus.lj-buchmiller.com" style={link}>nexus.lj-buchmiller.com</a> and
              as a Chrome extension ("NEXUS New Tab"). This privacy policy explains what data is
              collected, how it is used, and your rights.
            </p>
          </section>

          <section>
            <h2 style={h2}>Chrome Extension</h2>
            <p style={p}>
              The NEXUS New Tab Chrome extension <strong style={{ color: '#fff' }}>does not collect, store, or transmit any user data.</strong> Its
              sole function is to redirect your new tab page to the NEXUS dashboard and optionally
              pre-warm the browser's HTTP cache for faster loading. No personal information,
              browsing history, or usage data is gathered by the extension itself.
            </p>
          </section>

          <section>
            <h2 style={h2}>Account Data</h2>
            <p style={p}>
              When you create a NEXUS account, we collect:
            </p>
            <ul style={ul}>
              <li style={li}>Email address</li>
              <li style={li}>Display name and username (provided during sign-up or via Google OAuth)</li>
              <li style={li}>Profile information provided by Google if you sign in with Google (name, email, profile picture)</li>
            </ul>
            <p style={p}>
              This information is used solely to identify your account and personalise your dashboard.
              This data is never sold or shared with third parties.
            </p>
          </section>

          <section>
            <h2 style={h2}>Dashboard & Widget Data</h2>
            <p style={p}>
              NEXUS stores your widget layout and preferences in a secure database so your dashboard
              syncs across devices. This includes widget positions, sizes, and configuration — no
              content of external services (calendar events, messages, financial data) is stored
              permanently. That data is fetched live from the respective services on your behalf
              and cached temporarily (minutes to hours) to reduce API usage.
            </p>
          </section>

          <section>
            <h2 style={h2}>Third-Party Integrations</h2>
            <p style={p}>
              NEXUS optionally integrates with third-party services including Google Calendar,
              Spotify, Slack, and Plaid. When you connect these services, we store the access
              tokens required to fetch data on your behalf. These tokens are stored securely and
              are only used to fulfil requests you initiate. You can disconnect any integration
              at any time from the dashboard settings.
            </p>
          </section>

          <section>
            <h2 style={h2}>Cookies & Local Storage</h2>
            <p style={p}>
              NEXUS uses browser local storage and cookies to maintain your authentication
              session and cache widget data for fast loading. No advertising or tracking cookies
              are used.
            </p>
          </section>

          <section>
            <h2 style={h2}>Data Security</h2>
            <p style={p}>
              All data is transmitted over HTTPS. Authentication is handled by Supabase, which
              follows industry-standard security practices. We do not store passwords — authentication
              is handled via secure tokens.
            </p>
          </section>

          <section>
            <h2 style={h2}>Your Rights</h2>
            <p style={p}>
              You may request deletion of your account and all associated data at any time by
              reaching out via the contact below. Upon deletion, all personal data will be
              permanently removed.
            </p>
          </section>

          <section>
            <h2 style={h2}>Contact</h2>
            <p style={p}>
              For any privacy-related questions or data deletion requests, please contact us at{' '}
              <a href="mailto:lj.buchmiller@gmail.com" style={link}>lj.buchmiller@gmail.com</a>.
            </p>
          </section>

        </div>

        <div style={{ marginTop: 64, paddingTop: 24, borderTop: '1px solid #1e1e2e', color: '#7a7a90', fontSize: 13 }}>
          © {new Date().getFullYear()} NEXUS. All rights reserved.
        </div>
      </div>
    </div>
  );
}

const h2: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#fff',
  margin: '0 0 12px',
};

const p: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.7,
  color: '#b0b0c0',
  margin: '0 0 12px',
};

const ul: React.CSSProperties = {
  margin: '8px 0 12px',
  paddingLeft: 20,
};

const li: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.7,
  color: '#b0b0c0',
  marginBottom: 4,
};

const link: React.CSSProperties = {
  color: '#3de8b0',
  textDecoration: 'none',
};
