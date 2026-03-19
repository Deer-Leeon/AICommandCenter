const SLACK_APP_SCHEME = 'slack://';
const SLACK_APP_STORE  = 'https://apps.apple.com/app/slack/id618783545';

function openSlack() {
  window.location.href = SLACK_APP_SCHEME;
  const t = setTimeout(() => {
    if (!document.hidden) window.open(SLACK_APP_STORE, '_blank');
  }, 1500);
  document.addEventListener('visibilitychange', () => clearTimeout(t), { once: true });
}

function SlackLogo({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 270 270" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <path d="M99.4 151.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9 5.8-12.9 12.9-12.9h12.9v12.9z" fill="#E01E5A"/>
      <path d="M105.9 151.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9v-32.3z" fill="#E01E5A"/>
      <path d="M118.8 99.4c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9 12.9 5.8 12.9 12.9v12.9h-12.9z" fill="#36C5F0"/>
      <path d="M118.8 105.9c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H86.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0"/>
      <path d="M170.6 118.8c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9h-12.9v-12.9z" fill="#2EB67D"/>
      <path d="M164.1 118.8c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V86.5c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D"/>
      <path d="M151.2 170.6c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9v-12.9h12.9z" fill="#ECB22E"/>
      <path d="M151.2 164.1c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9h-32.3z" fill="#ECB22E"/>
    </svg>
  );
}

export function MobileSlackCard() {
  return (
    <div
      onPointerDown={openSlack}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        background: 'linear-gradient(135deg, #1a0f2e 0%, #0d1117 100%)',
        padding: '24px 20px',
        textAlign: 'center',
      }}
    >
      <SlackLogo size={56} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>Slack</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
          Tap to open your workspace
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#4A154B',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 999,
        padding: '11px 24px',
        fontSize: 14, fontWeight: 700, color: '#fff',
        boxShadow: '0 4px 20px rgba(74,21,75,0.5)',
      }}>
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15,3 21,3 21,9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Open Slack
      </div>
    </div>
  );
}
