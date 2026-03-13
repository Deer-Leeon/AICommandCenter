import { Router, type Response } from 'express';
import { Products, CountryCode } from 'plaid';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { plaidClient } from '../services/plaidClient.js';

export const plaidRouter = Router();

const MAX_PLAID_ITEMS = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPlaidTokenRow(userId: string) {
  const { data } = await supabase
    .from('user_tokens')
    .select('access_token, refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'plaid')
    .single();
  return data ?? null;
}

// ── GET /api/plaid/status ─────────────────────────────────────────────────────

plaidRouter.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const row = await getPlaidTokenRow(req.user!.id);
  res.json({ connected: !!row });
});

// ── POST /api/plaid/link-token ────────────────────────────────────────────────
// Creates a Plaid Link token used to open the Link modal on the frontend.
// Hard cap: refuse if 100+ Plaid items already exist across all users.

plaidRouter.post('/link-token', requireAuth, async (req: AuthRequest, res: Response) => {
  const { count, error: countErr } = await supabase
    .from('user_tokens')
    .select('*', { count: 'exact', head: true })
    .eq('provider', 'plaid');

  if (countErr) {
    res.status(500).json({ error: 'Failed to check capacity' });
    return;
  }
  if ((count ?? 0) >= MAX_PLAID_ITEMS) {
    res.status(403).json({ error: 'Maximum number of connected banks has been reached' });
    return;
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: req.user!.id },
      client_name: 'NEXUS',
      products: [Products.Transactions, Products.Auth],
      optional_products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create link token';
    console.error('Plaid link-token:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/plaid/exchange-token ───────────────────────────────────────────
// Exchanges the public_token from Plaid Link for a permanent access_token.
// Stores: access_token in access_token, item_id in refresh_token column.

plaidRouter.post('/exchange-token', requireAuth, async (req: AuthRequest, res: Response) => {
  const { public_token } = req.body as { public_token: string };
  if (!public_token) {
    res.status(400).json({ error: 'public_token is required' });
    return;
  }

  try {
    const exchange = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchange.data;

    const { error } = await supabase.from('user_tokens').upsert(
      {
        user_id: req.user!.id,
        provider: 'plaid',
        access_token,
        refresh_token: item_id,   // repurpose refresh_token column for item_id
        expires_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    );

    if (error) throw new Error(error.message);
    console.log(`✅ Plaid token saved for user ${req.user!.id} (item ${item_id})`);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    console.error('Plaid exchange-token:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/plaid/accounts ───────────────────────────────────────────────────

plaidRouter.get('/accounts', requireAuth, async (req: AuthRequest, res: Response) => {
  const row = await getPlaidTokenRow(req.user!.id);
  if (!row) { res.json({ accounts: [], needsAuth: true }); return; }

  try {
    const response = await plaidClient.accountsGet({ access_token: row.access_token });
    const { accounts, item } = response.data;

    // Resolve institution name (best-effort)
    let institutionName = 'My Bank';
    if (item.institution_id) {
      try {
        const inst = await plaidClient.institutionsGetById({
          institution_id: item.institution_id,
          country_codes: [CountryCode.Us],
        });
        institutionName = inst.data.institution.name;
      } catch { /* non-fatal */ }
    }

    res.json({
      institutionName,
      accounts: accounts.map((a) => ({
        id: a.account_id,
        name: a.name,
        officialName: a.official_name ?? null,
        type: a.type,
        subtype: a.subtype ?? null,
        balanceCurrent: a.balances.current ?? null,
        balanceAvailable: a.balances.available ?? null,
        balanceLimit: a.balances.limit ?? null,
        currency: a.balances.iso_currency_code ?? 'USD',
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch accounts';
    console.error('Plaid accounts:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/plaid/transactions ───────────────────────────────────────────────

plaidRouter.get('/transactions', requireAuth, async (req: AuthRequest, res: Response) => {
  const row = await getPlaidTokenRow(req.user!.id);
  if (!row) { res.json({ transactions: [], needsAuth: true }); return; }

  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    const response = await plaidClient.transactionsGet({
      access_token: row.access_token,
      start_date: startDate,
      end_date: endDate,
      options: { count: 15, offset: 0 },
    });

    res.json({
      transactions: response.data.transactions.map((t) => ({
        id: t.transaction_id,
        name: t.merchant_name ?? t.name,
        amount: t.amount,   // Plaid: positive = money out (debit), negative = money in (credit)
        date: t.date,
        category: t.personal_finance_category?.primary ?? t.category?.[0] ?? null,
        pending: t.pending,
        accountId: t.account_id,
        logoUrl: t.logo_url ?? null,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch transactions';
    console.error('Plaid transactions:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/plaid/investments ────────────────────────────────────────────────

plaidRouter.get('/investments', requireAuth, async (req: AuthRequest, res: Response) => {
  const row = await getPlaidTokenRow(req.user!.id);
  if (!row) { res.json({ holdings: [], totalValue: 0, needsAuth: true }); return; }

  try {
    const response = await plaidClient.investmentsHoldingsGet({ access_token: row.access_token });
    const { holdings, securities, accounts } = response.data;

    const totalValue = holdings.reduce((sum, h) => sum + (h.institution_value ?? 0), 0);

    res.json({
      totalValue,
      holdings: holdings
        .map((h) => {
          const security = securities.find((s) => s.security_id === h.security_id);
          const account = accounts.find((a) => a.account_id === h.account_id);
          const value = h.institution_value ?? 0;
          return {
            id: h.security_id,
            name: security?.name ?? 'Unknown',
            ticker: security?.ticker_symbol ?? null,
            value,
            quantity: h.quantity,
            price: h.institution_price ?? null,
            pctOfPortfolio: totalValue > 0 ? (value / totalValue) * 100 : 0,
            accountName: account?.name ?? null,
          };
        })
        .sort((a, b) => b.value - a.value),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch investments';
    console.error('Plaid investments:', msg);
    // Investments may not be enabled for this item — return empty gracefully
    res.json({ holdings: [], totalValue: 0 });
  }
});

// ── POST /api/plaid/disconnect ────────────────────────────────────────────────
// Revokes the Plaid item AND deletes the local token row.

plaidRouter.post('/disconnect', requireAuth, async (req: AuthRequest, res: Response) => {
  const row = await getPlaidTokenRow(req.user!.id);
  if (!row) { res.json({ success: true }); return; }

  // Best-effort item removal from Plaid side
  try {
    await plaidClient.itemRemove({ access_token: row.access_token });
  } catch { /* token may already be expired */ }

  await supabase
    .from('user_tokens')
    .delete()
    .eq('user_id', req.user!.id)
    .eq('provider', 'plaid');

  console.log(`🔌 Plaid disconnected for user ${req.user!.id}`);
  res.json({ success: true });
});
