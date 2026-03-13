import { useObsidian } from '../../hooks/useObsidian';
import { useServiceState } from '../../store/useStore';
import { useWidgetReady } from '../../hooks/useWidgetReady';

function parseListItems(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => line.trim().startsWith('- ') || line.trim().startsWith('* '))
    .map((line) => line.trim().replace(/^[-*]\s+/, ''));
}

interface ObsidianWidgetProps {
  onClose: () => void;
}

export function ObsidianWidget({ onClose: _onClose }: ObsidianWidgetProps) {
  const { content } = useObsidian();
  const { isConnected, neverConnected, isStale } = useServiceState('obsidian');

  // Obsidian has no cache — mark ready immediately so it never blocks the reveal
  useWidgetReady('obsidian', true);

  if (neverConnected) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-3 text-center gap-2">
        <span style={{ fontSize: '24px' }}>🔮</span>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not connected</p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Install Local REST API plugin in Obsidian
        </p>
      </div>
    );
  }

  const items = parseListItems(content);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 pt-2 pb-1 flex-shrink-0 flex items-center justify-between">
        <p className="font-mono text-xs truncate" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
          Shopping/Groceries.md
        </p>
        {isStale && !isConnected && (
          <span className="text-xs font-mono" style={{ color: '#f59e0b', opacity: 0.6, fontSize: '10px' }}>
            ↻ reconnecting
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto nexus-scroll px-2 pb-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <span style={{ fontSize: '20px' }}>📝</span>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Empty list</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {items.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-1.5 rounded-md animate-fade-in"
                style={{ background: 'rgba(139, 92, 246, 0.06)', border: '1px solid rgba(139, 92, 246, 0.1)' }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: '#8b5cf6' }}
                />
                <span className="text-xs" style={{ color: 'var(--text)', fontSize: '12px' }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
