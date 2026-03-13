// In production: use VITE_API_URL build arg if provided, otherwise fall back to the
// default hosted domain. Set VITE_API_URL in Railway → Frontend service → Variables.
export const API_BASE_URL = import.meta.env.PROD
  ? (import.meta.env.VITE_API_URL ?? 'https://nexus-api.lj-buchmiller.com')
  : '';
