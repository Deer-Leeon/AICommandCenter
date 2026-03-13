import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

type PlaidEnvKey = keyof typeof PlaidEnvironments;

const envKey = (process.env.PLAID_ENV ?? 'sandbox') as PlaidEnvKey;

const config = new Configuration({
  basePath: PlaidEnvironments[envKey] ?? PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID ?? '',
      'PLAID-SECRET': process.env.PLAID_SECRET ?? '',
    },
  },
});

export const plaidClient = new PlaidApi(config);
