import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { apiFetch } from '../../lib/api';
import type { PlaidAccount, PlaidTransaction, PlaidHolding } from '../../types';
import { wcRead, wcWrite, wcIsStale, WC_KEY, WC_TTL, awaitPrefetchOrFetch } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';

interface Props {
  onClose: () => void;
}

type Tab = 'accounts' | 'transactions' | 'investments';

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatCurrency(amount: number | null, currency = 'USD'): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00'); // avoid UTC off-by-one
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const isSame = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSame(date, today)) return 'Today';
  if (isSame(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function humanCategory(cat: string | null): string {
  if (!cat) return '';
  return cat.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function accountTypeIcon(type: string, subtype: string | null): string {
  const sub = (subtype ?? '').toLowerCase();
  if (sub.includes('checking')) return '🏦';
  if (sub.includes('savings')) return '🏛';
  if (type === 'investment' || sub.includes('brokerage') || sub.includes('401')) return '📈';
  if (type === 'credit') return '💳';
  return '💰';
}

// ── Connect button (inner component to isolate usePlaidLink hook) ─────────────
// usePlaidLink must receive a valid token string; this component is only rendered
// once we have a link token, so it is never called with an empty string.

function PlaidLinkButton({
  linkToken,
  onSuccess,
  onExit,
}: {
  linkToken: string;
  onSuccess: (publicToken: string) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token) => onSuccess(public_token),
    onExit,
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return null; // auto-opens; no visible button needed
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'accounts', label: 'Accounts' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'investments', label: 'Investments' },
  ];
  return (
    <div
      className="flex flex-shrink-0 gap-1 px-3 pt-2 pb-1"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="font-mono px-2.5 py-1 rounded-lg text-xs transition-all"
          style={{
            background: active === t.id ? 'rgba(0,177,64,0.12)' : 'transparent',
            color: active === t.id ? '#00b140' : 'var(--text-faint)',
            border: `1px solid ${active === t.id ? 'rgba(0,177,64,0.25)' : 'transparent'}`,
            cursor: 'pointer',
            fontWeight: active === t.id ? 600 : 400,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function PlaidWidget({ onClose: _onClose }: Props) {
  const [tab, setTab] = useState<Tab>('accounts');

  // Connection state
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loading, setLoading] = useState(
    () => wcRead(WC_KEY.PLAID_ACCOUNTS) === null,
  );
  // Signal reveal orchestrator: ready immediately on cache hit, else after first load
  useWidgetReady('plaid', !loading);
  const [isStale, setIsStale] = useState(
    () => wcIsStale(WC_KEY.PLAID_ACCOUNTS, WC_TTL.PLAID),
  );
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetchingToken, setFetchingToken] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type PlaidAccountsCache = { accounts: PlaidAccount[]; institutionName: string };
  // Data — pre-populated from localStorage so the widget renders without a skeleton
  const [institutionName, setInstitutionName] = useState(
    () => wcRead<PlaidAccountsCache>(WC_KEY.PLAID_ACCOUNTS)?.data.institutionName ?? 'My Bank',
  );
  const [accounts, setAccounts] = useState<PlaidAccount[]>(
    () => wcRead<PlaidAccountsCache>(WC_KEY.PLAID_ACCOUNTS)?.data.accounts ?? [],
  );
  const [transactions, setTransactions] = useState<PlaidTransaction[]>(
    () => wcRead<PlaidTransaction[]>(WC_KEY.PLAID_TXNS)?.data ?? [],
  );
  const [holdings, setHoldings] = useState<PlaidHolding[]>([]);
  const [totalPortfolio, setTotalPortfolio] = useState(0);
  const [_loadingTab, setLoadingTab] = useState<Tab | null>(null);

  // ── Data loaders ────────────────────────────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    setLoadingTab('accounts');
    try {
      const res = await awaitPrefetchOrFetch('/api/plaid/accounts', () => apiFetch('/api/plaid/accounts'));
      if (!res.ok) throw new Error('Failed to load accounts');
      const data = await res.json() as { accounts: PlaidAccount[]; institutionName: string; needsAuth?: boolean };
      if (data.needsAuth) { setNeedsAuth(true); return; }
      setAccounts(data.accounts);
      setInstitutionName(data.institutionName ?? 'My Bank');
      wcWrite(WC_KEY.PLAID_ACCOUNTS, { accounts: data.accounts, institutionName: data.institutionName ?? 'My Bank' });
      setNeedsAuth(false);
      setIsStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts');
    } finally {
      setLoadingTab(null);
      setLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    // Don't skip even if cache-seeded — always refresh from server on first tab visit
    // (cache just prevents skeleton; we still want fresh data)
    setLoadingTab('transactions');
    try {
      const res = await apiFetch('/api/plaid/transactions');
      if (!res.ok) throw new Error('Failed to load transactions');
      const data = await res.json() as { transactions: PlaidTransaction[] };
      setTransactions(data.transactions);
      wcWrite(WC_KEY.PLAID_TXNS, data.transactions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions');
    } finally {
      setLoadingTab(null);
    }
  }, [transactions.length]);

  const loadInvestments = useCallback(async () => {
    if (holdings.length) return; // already loaded
    setLoadingTab('investments');
    try {
      const res = await apiFetch('/api/plaid/investments');
      if (!res.ok) throw new Error('Failed to load investments');
      const data = await res.json() as { holdings: PlaidHolding[]; totalValue: number };
      setHoldings(data.holdings);
      setTotalPortfolio(data.totalValue);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load investments');
    } finally {
      setLoadingTab(null);
    }
  }, [holdings.length]);

  // Initial load
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Lazy-load tab data on first switch
  useEffect(() => {
    if (needsAuth || loading) return;
    if (tab === 'transactions') loadTransactions();
    if (tab === 'investments') loadInvestments();
  }, [tab, needsAuth, loading, loadTransactions, loadInvestments]);

  // ── Plaid Link handlers ─────────────────────────────────────────────────────

  const handleConnectClick = async () => {
    setFetchingToken(true);
    setError(null);
    try {
      const res = await apiFetch('/api/plaid/link-token', { method: 'POST' });
      const data = await res.json() as { link_token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLinkToken(data.link_token!);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open bank connection');
    } finally {
      setFetchingToken(false);
    }
  };

  const handlePlaidSuccess = async (publicToken: string) => {
    setExchanging(true);
    setLinkToken(null);
    try {
      const res = await apiFetch('/api/plaid/exchange-token', {
        method: 'POST',
        body: JSON.stringify({ public_token: publicToken }),
      });
      if (!res.ok) throw new Error('Token exchange failed');
      // Reset and reload
      setAccounts([]);
      setTransactions([]);
      setHoldings([]);
      setLoading(true);
      loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect bank');
    } finally {
      setExchanging(false);
    }
  };

  const handlePlaidExit = () => setLinkToken(null);

  // ── Connect screen ──────────────────────────────────────────────────────────

  if (needsAuth) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-5 text-center">
        {/* Render hidden PlaidLinkButton when link token is ready */}
        {linkToken && (
          <PlaidLinkButton
            linkToken={linkToken}
            onSuccess={handlePlaidSuccess}
            onExit={handlePlaidExit}
          />
        )}

        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(0,177,64,0.1)', border: '1px solid rgba(0,177,64,0.2)' }}
        >
          <span style={{ fontSize: '26px' }}>💳</span>
        </div>
        <div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
            Connect Your Bank
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Securely link your bank account to see balances, recent transactions, and investment holdings.
          </p>
        </div>
        {error && (
          <p className="text-xs px-3 py-2 rounded-lg font-mono w-full"
            style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
        <button
          onClick={handleConnectClick}
          disabled={fetchingToken || exchanging}
          className="w-full py-2.5 rounded-xl text-sm font-semibold"
          style={{
            background: 'rgba(0,177,64,0.15)',
            color: '#00b140',
            border: '1px solid rgba(0,177,64,0.3)',
            cursor: (fetchingToken || exchanging) ? 'not-allowed' : 'pointer',
            opacity: (fetchingToken || exchanging) ? 0.6 : 1,
          }}
        >
          {exchanging ? 'Connecting…' : fetchingToken ? 'Opening Plaid…' : '+ Connect Bank'}
        </button>
        <p className="font-mono" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
          Powered by Plaid · Bank-level encryption
        </p>
      </div>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Institution header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 pt-2.5 pb-0"
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '14px' }}>🏦</span>
          <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            {institutionName.toUpperCase()}
          </span>
          {isStale && (
            <span title="Showing cached data — refreshing" style={{ fontSize: 9, color: 'var(--text-faint)', opacity: 0.7 }}>↻</span>
          )}
        </div>
        {/* Reconnect Plaid Link button */}
        {linkToken && (
          <PlaidLinkButton
            linkToken={linkToken}
            onSuccess={handlePlaidSuccess}
            onExit={handlePlaidExit}
          />
        )}
        <button
          onClick={handleConnectClick}
          disabled={fetchingToken}
          className="font-mono text-xs px-2 py-0.5 rounded"
          style={{
            color: 'var(--text-faint)',
            background: 'transparent',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            fontSize: '10px',
          }}
          title="Switch bank or reconnect"
        >
          {fetchingToken ? '…' : 'Switch'}
        </button>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {/* Error banner */}
      {error && (
        <div
          className="mx-3 mt-1.5 px-3 py-1.5 rounded-lg text-xs font-mono flex items-center justify-between flex-shrink-0"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
        >
          {error}
          <button onClick={() => setError(null)} style={{ cursor: 'pointer', opacity: 0.7 }}>✕</button>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto nexus-scroll px-3 py-2" style={{ minHeight: 0 }}>

        {/* ── ACCOUNTS tab ── */}
        {tab === 'accounts' && (
          accounts.length === 0 ? (
            <EmptyState icon="💳" message="No accounts found" />
          ) : (
            <div className="flex flex-col gap-2">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="rounded-xl p-3"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span style={{ fontSize: '16px', flexShrink: 0 }}>
                        {accountTypeIcon(acc.type, acc.subtype)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                          {acc.name}
                        </p>
                        {acc.subtype && (
                          <p className="font-mono truncate" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                            {acc.subtype.replace(/_/g, ' ').toUpperCase()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-mono font-semibold text-sm" style={{ color: 'var(--text)' }}>
                        {formatCurrency(acc.balanceCurrent, acc.currency)}
                      </p>
                      {acc.balanceAvailable !== null && acc.balanceAvailable !== acc.balanceCurrent && (
                        <p className="font-mono" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                          {formatCurrency(acc.balanceAvailable, acc.currency)} avail
                        </p>
                      )}
                      {acc.balanceLimit !== null && (
                        <p className="font-mono" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                          of {formatCurrency(acc.balanceLimit, acc.currency)} limit
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Net worth summary */}
              {accounts.length > 1 && (
                <div
                  className="rounded-xl p-3 flex items-center justify-between"
                  style={{ background: 'rgba(0,177,64,0.06)', border: '1px solid rgba(0,177,64,0.15)' }}
                >
                  <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    TOTAL BALANCE
                  </span>
                  <span className="font-mono font-semibold text-sm" style={{ color: '#00b140' }}>
                    {formatCurrency(
                      accounts
                        .filter((a) => a.type !== 'credit')
                        .reduce((s, a) => s + (a.balanceCurrent ?? 0), 0)
                    )}
                  </span>
                </div>
              )}
            </div>
          )
        )}

        {/* ── TRANSACTIONS tab ── */}
        {tab === 'transactions' && (
          transactions.length === 0 ? (
            <EmptyState icon="📋" message="No recent transactions" sub="Transactions may take a moment to load after first connection." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {transactions.map((tx) => {
                const isDebit = tx.amount > 0;
                const absAmount = Math.abs(tx.amount);
                return (
                  <div
                    key={tx.id}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                    style={{
                      background: 'var(--row-bg)',
                      border: '1px solid var(--border)',
                      opacity: tx.pending ? 0.7 : 1,
                    }}
                  >
                    {/* Merchant logo / category icon */}
                    <div
                      className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{ background: 'var(--surface2)', fontSize: '13px' }}
                    >
                      {tx.logoUrl ? (
                        <img src={tx.logoUrl} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        <span>{isDebit ? '↑' : '↓'}</span>
                      )}
                    </div>

                    {/* Merchant + category */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>
                        {tx.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {tx.category && (
                          <span
                            className="font-mono px-1 rounded"
                            style={{ background: 'var(--surface2)', color: 'var(--text-faint)', fontSize: '9px' }}
                          >
                            {humanCategory(tx.category)}
                          </span>
                        )}
                        {tx.pending && (
                          <span
                            className="font-mono px-1 rounded"
                            style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--color-warning)', fontSize: '9px' }}
                          >
                            PENDING
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Amount + date */}
                    <div className="text-right flex-shrink-0">
                      <p
                        className="font-mono text-xs font-semibold"
                        style={{ color: isDebit ? 'var(--color-danger)' : '#00b140' }}
                      >
                        {isDebit ? '−' : '+'}{formatCurrency(absAmount)}
                      </p>
                      <p className="font-mono" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                        {formatDate(tx.date)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── INVESTMENTS tab ── */}
        {tab === 'investments' && (
          holdings.length === 0 ? (
            <EmptyState
              icon="📈"
              message="No investment accounts"
              sub="Investment accounts will appear here if your connected bank supports the Investments product."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Portfolio total */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-xl mb-1"
                style={{ background: 'rgba(0,177,64,0.06)', border: '1px solid rgba(0,177,64,0.15)' }}
              >
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  PORTFOLIO VALUE
                </span>
                <span className="font-mono font-bold text-sm" style={{ color: '#00b140' }}>
                  {formatCurrency(totalPortfolio)}
                </span>
              </div>

              {holdings.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                  style={{ background: 'var(--row-bg)', border: '1px solid var(--border)' }}
                >
                  {/* Ticker badge */}
                  <div
                    className="flex-shrink-0 w-10 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: 'rgba(0,177,64,0.08)', border: '1px solid rgba(0,177,64,0.15)' }}
                  >
                    <span className="font-mono font-bold" style={{ color: '#00b140', fontSize: '9px' }}>
                      {h.ticker ?? '—'}
                    </span>
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>
                      {h.name}
                    </p>
                    <p className="font-mono" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                      {h.quantity % 1 === 0 ? h.quantity.toFixed(0) : h.quantity.toFixed(4)} shares
                      {h.price !== null ? ` · ${formatCurrency(h.price)}` : ''}
                    </p>
                  </div>

                  {/* Value + portfolio % */}
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono text-xs font-semibold" style={{ color: 'var(--text)' }}>
                      {formatCurrency(h.value)}
                    </p>
                    <p className="font-mono" style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
                      {h.pctOfPortfolio.toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ icon, message, sub }: { icon: string; message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
      <span style={{ fontSize: '22px', opacity: 0.5 }}>{icon}</span>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{message}</p>
      {sub && <p className="text-xs px-4 leading-relaxed" style={{ color: 'var(--text-faint)' }}>{sub}</p>}
    </div>
  );
}
