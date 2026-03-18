import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg, #0a0a0f)',
      color: 'var(--text, #e8e8f0)',
      fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Back link */}
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: 'var(--teal, #3de8b0)',
            fontSize: 14,
            cursor: 'pointer',
            padding: '4px 0',
            marginBottom: 36,
            fontFamily: "inherit",
          }}
        >
          ← Back to NEXUS
        </button>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--teal, #3de8b0)', fontFamily: "'Space Mono', monospace", letterSpacing: '-0.5px' }}>NEXUS</span>
          </div>
          <h1 style={{ fontSize: 34, fontWeight: 700, margin: '0 0 8px', color: 'var(--text, #e8e8f0)' }}>Privacy Policy</h1>
          <p style={{ color: 'var(--text-muted, #7a7a90)', fontSize: 14, margin: 0 }}>Last updated: March 2026</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          <Card>
            <h2 style={h2}>Overview</h2>
            <p style={p}>
              NEXUS is a personal dashboard application built and operated by Leon Buchmiller,
              available at{' '}
              <a href="https://nexus.lj-buchmiller.com" style={link}>nexus.lj-buchmiller.com</a>{' '}
              and as a Chrome extension ("NEXUS New Tab"). This privacy policy explains what
              data is collected, how it is used, and your rights as a user.
            </p>
          </Card>

          <Card>
            <h2 style={h2}>1. What We Collect</h2>

            <p style={labelStyle}>When you sign in with Google</p>
            <ul style={ul}>
              <li style={li}>Your Google account email address</li>
              <li style={li}>Your display name and profile photo (provided by Google OAuth)</li>
            </ul>

            <p style={labelStyle}>Dashboard usage</p>
            <ul style={ul}>
              <li style={li}>Your widget layout — which widgets you have placed, their sizes and positions</li>
              <li style={li}>Your NEXUS settings and preferences (animation, search engine, widget configuration)</li>
              <li style={li}>Content you create: notes, tasks, to-do items typed into widgets</li>
            </ul>

            <p style={labelStyle}>Third-party services (only when you explicitly connect them)</p>
            <ul style={ul}>
              <li style={li}><strong style={{ color: 'var(--text, #e8e8f0)' }}>Google Calendar / Tasks / Gmail / Drive / Docs</strong> — OAuth access token to read your data and display it in widgets</li>
              <li style={li}><strong style={{ color: 'var(--text, #e8e8f0)' }}>Spotify</strong> — OAuth access token to control playback and display currently playing track</li>
              <li style={li}><strong style={{ color: 'var(--text, #e8e8f0)' }}>Slack</strong> — OAuth access token to display messages from your workspace</li>
              <li style={li}><strong style={{ color: 'var(--text, #e8e8f0)' }}>Plaid (financial data)</strong> — If you connect a bank account, Plaid provides read-only access to account balances and transactions. We store only the Plaid access token, not the raw financial data itself</li>
            </ul>

            <p style={labelStyle}>Chrome extension</p>
            <p style={p}>
              The NEXUS New Tab Chrome extension <strong style={{ color: 'var(--text, #e8e8f0)' }}>does not collect, store, or transmit any personal data.</strong>{' '}
              Its sole function is to redirect your new tab page to the NEXUS dashboard and
              optionally pre-warm the browser's HTTP cache for faster loading.
            </p>
          </Card>

          <Card>
            <h2 style={h2}>2. How We Use It</h2>
            <ul style={ul}>
              <li style={li}>To display your personal NEXUS dashboard and power its widgets</li>
              <li style={li}>To sync your widget layout and preferences across devices and browsers</li>
              <li style={li}>To fetch and display live data from services you have connected (calendar events, emails, music playback, etc.)</li>
              <li style={li}>We do <strong style={{ color: 'var(--text, #e8e8f0)' }}>not</strong> use your data for advertising</li>
              <li style={li}>We do <strong style={{ color: 'var(--text, #e8e8f0)' }}>not</strong> build profiles or sell data to data brokers</li>
            </ul>
          </Card>

          <Card>
            <h2 style={h2}>3. What We Share</h2>
            <ul style={ul}>
              <li style={li}>We <strong style={{ color: 'var(--text, #e8e8f0)' }}>never sell</strong> your data to any third party</li>
              <li style={li}>Data is sent to third-party APIs only when you explicitly connect a service — for example, your Spotify token is used solely to communicate with Spotify's API on your behalf</li>
              <li style={li}><strong style={{ color: 'var(--text, #e8e8f0)' }}>Infrastructure providers</strong> who process data as part of hosting:
                <ul style={{ ...ul, marginTop: 8 }}>
                  <li style={li}>Supabase — database and authentication (PostgreSQL, hosted in EU/US)</li>
                  <li style={li}>Railway — backend API hosting</li>
                  <li style={li}>Cloudflare / Nginx — frontend delivery</li>
                </ul>
              </li>
            </ul>
          </Card>

          <Card>
            <h2 style={h2}>4. Data Storage</h2>
            <ul style={ul}>
              <li style={li}>Your account and layout data is stored in a Supabase PostgreSQL database</li>
              <li style={li}>All data is transmitted over HTTPS (TLS 1.2+)</li>
              <li style={li}>Authentication is handled via Supabase Auth using secure tokens — we do not store passwords</li>
              <li style={li}>Session tokens are stored in your browser's localStorage, scoped to the NEXUS origin</li>
              <li style={li}>You can delete your account and all associated data at any time by contacting us at the address below</li>
            </ul>
          </Card>

          <Card>
            <h2 style={h2}>5. Third-Party Services</h2>
            <p style={p}>NEXUS may connect to the following services depending on which widgets you use:</p>
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                ['Google', 'OAuth login, Calendar, Gmail, Tasks, Drive, Docs'],
                ['Spotify', 'Music playback control and now-playing display'],
                ['Plaid', 'Financial account balances — only if you explicitly connect a bank account'],
                ['Slack', 'Workspace message display'],
                ['Open-Meteo', 'Weather data (no personal data sent)'],
                ['Alpha Vantage / Yahoo Finance', 'Stock price data (no personal data sent)'],
                ['NewsAPI / RSS', 'News headlines (no personal data sent)'],
                ['Ergast / OpenF1', 'Formula 1 race data (no personal data sent)'],
                ['Football-Data.org', 'Football / soccer match data (no personal data sent)'],
              ].map(([name, desc]) => (
                <div key={name} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ color: 'var(--teal, #3de8b0)', fontWeight: 600, flexShrink: 0, minWidth: 160, fontSize: 14 }}>{name}</span>
                  <span style={{ color: 'var(--text-muted, #7a7a90)', fontSize: 14 }}>{desc}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 style={h2}>6. Cookies &amp; Local Storage</h2>
            <p style={p}>
              NEXUS uses browser localStorage to maintain your authentication session and
              cache widget data for fast loading. No advertising or tracking cookies are used.
              No third-party analytics scripts (e.g. Google Analytics) are included.
            </p>
          </Card>

          <Card>
            <h2 style={h2}>7. Your Rights</h2>
            <ul style={ul}>
              <li style={li}>You may disconnect any third-party integration at any time from Settings → Connections</li>
              <li style={li}>You may request deletion of your account and all associated data at any time</li>
              <li style={li}>You may request a copy of the data we hold about you</li>
            </ul>
            <p style={p}>Contact us at the address below to exercise any of these rights.</p>
          </Card>

          <Card>
            <h2 style={h2}>8. Contact</h2>
            <p style={p}>
              For privacy questions, data deletion requests, or anything else related to this policy, please contact:
            </p>
            <p style={{ ...p, color: 'var(--text, #e8e8f0)' }}>
              <a href="mailto:lj.buchmiller@gmail.com" style={link}>lj.buchmiller@gmail.com</a>
            </p>
          </Card>

        </div>

        <div style={{
          marginTop: 64,
          paddingTop: 20,
          borderTop: '1px solid var(--border, rgba(255,255,255,0.06))',
          color: 'var(--text-muted, #7a7a90)',
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <span>© {new Date().getFullYear()} NEXUS — Leon Buchmiller. All rights reserved.</span>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', color: 'var(--teal, #3de8b0)', fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
          >
            ← Back to NEXUS
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface, #111118)',
      border: '1px solid var(--border, rgba(255,255,255,0.06))',
      borderRadius: 12,
      padding: '24px 28px',
    }}>
      {children}
    </div>
  );
}

const h2: CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--text, #e8e8f0)',
  margin: '0 0 14px',
};

const p: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.75,
  color: 'var(--text-muted, #7a7a90)',
  margin: '0 0 12px',
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text, #e8e8f0)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '16px 0 6px',
};

const ul: CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: 20,
};

const li: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.75,
  color: 'var(--text-muted, #7a7a90)',
  marginBottom: 4,
};

const link: CSSProperties = {
  color: 'var(--teal, #3de8b0)',
  textDecoration: 'none',
};
