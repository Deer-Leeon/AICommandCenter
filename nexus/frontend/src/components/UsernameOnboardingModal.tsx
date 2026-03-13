import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api';

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

interface UsernameOnboardingModalProps {
  displayName: string;
  onComplete: () => void;
}

export function UsernameOnboardingModal({ displayName, onComplete }: UsernameOnboardingModalProps) {
  const [value, setValue] = useState('');
  const [checkStatus, setCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Lowercase on change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    setCheckStatus('idle');
  }, []);

  // Debounced availability check (400ms)
  useEffect(() => {
    if (value.length < 3) {
      setCheckStatus('idle');
      return;
    }
    if (!USERNAME_REGEX.test(value)) {
      setCheckStatus('invalid');
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCheckStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/profiles/check?username=${encodeURIComponent(value)}`);
        const d = await res.json() as { available: boolean; reason?: string };
        setCheckStatus(d.available ? 'available' : (d.reason === 'invalid_format' ? 'invalid' : 'taken'));
      } catch {
        setCheckStatus('idle');
      }
      debounceRef.current = undefined;
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  const canConfirm = value.length >= 3 && USERNAME_REGEX.test(value) && checkStatus === 'available' && !saving;

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/api/profiles/me/username', {
        method: 'PATCH',
        body: JSON.stringify({ username: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      onComplete();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [canConfirm, value, onComplete]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,10,15,0.6)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div
        style={{
          width: 'min(420px, 92vw)',
          padding: 32,
          borderRadius: 16,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          Welcome, {displayName || 'there'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
          Choose your NEXUS username — this is how others will find you
        </p>

        <div style={{ marginBottom: 16 }}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            placeholder="username"
            autoComplete="username"
            maxLength={20}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            style={{
              width: '100%',
              padding: '12px 14px',
              fontSize: 15,
              fontFamily: "'Roboto Mono', monospace",
              color: 'var(--text)',
              background: 'var(--surface2)',
              border: `1px solid ${checkStatus === 'taken' || checkStatus === 'invalid' ? 'rgba(239,68,68,0.4)' : checkStatus === 'available' ? 'rgba(61,232,176,0.4)' : 'var(--border)'}`,
              borderRadius: 10,
              outline: 'none',
            }}
          />

          <div style={{ marginTop: 8, minHeight: 20, fontSize: 12, fontFamily: "'Roboto Mono', monospace" }}>
            {checkStatus === 'checking' && (
              <span style={{ color: 'var(--text-faint)' }}>Checking…</span>
            )}
            {checkStatus === 'available' && (
              <span style={{ color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>✓</span> Available
              </span>
            )}
            {checkStatus === 'taken' && (
              <span style={{ color: 'var(--color-danger)' }}>Already taken</span>
            )}
            {checkStatus === 'invalid' && value.length >= 3 && (
              <span style={{ color: 'var(--color-danger)' }}>Only letters, numbers, and underscores</span>
            )}
            {checkStatus === 'invalid' && value.length > 0 && value.length < 3 && (
              <span style={{ color: 'var(--text-faint)' }}>3–20 characters</span>
            )}
          </div>
        </div>

        {saveError && (
          <p style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 12 }}>{saveError}</p>
        )}

        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          style={{
            width: '100%',
            padding: '12px 20px',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'inherit',
            color: canConfirm ? '#0a0a0f' : 'var(--text-faint)',
            background: canConfirm ? 'var(--teal)' : 'var(--surface2)',
            border: 'none',
            borderRadius: 10,
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Confirm username'}
        </button>
      </div>
    </div>
  );
}
