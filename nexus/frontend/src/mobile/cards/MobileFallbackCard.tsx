import type { WidgetType } from '../../types';
import { WIDGET_CONFIGS } from '../../types';

interface Props { widgetType: WidgetType; }

export function MobileFallbackCard({ widgetType }: Props) {
  const cfg = WIDGET_CONFIGS.find(c => c.id === widgetType);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
      <div style={{ fontSize: 52 }}>{cfg?.icon ?? '🔧'}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{cfg?.label ?? widgetType}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Open on desktop for the full experience.
      </div>
    </div>
  );
}
