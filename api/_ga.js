import { getVercelOidcToken } from '@vercel/oidc';

const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_PROPERTY_ID = '558035356';
const DEFAULT_PROJECT_NUMBER = '568010186513';
const DEFAULT_SERVICE_ACCOUNT_EMAIL = 'wiki-analytics-dashboard@project-d0079f33-9005-473f-938.iam.gserviceaccount.com';
const DEFAULT_POOL_ID = 'vercel-wiki';
const DEFAULT_PROVIDER_ID = 'vercel';

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function env(name) {
  return process.env[name]?.trim();
}

export function isConfigured() {
  return true;
}

export function propertyId() {
  return env('GA_PROPERTY_ID') || DEFAULT_PROPERTY_ID;
}

function projectNumber() {
  return env('GCP_PROJECT_NUMBER') || DEFAULT_PROJECT_NUMBER;
}

function serviceAccountEmail() {
  return env('GCP_SERVICE_ACCOUNT_EMAIL') || DEFAULT_SERVICE_ACCOUNT_EMAIL;
}

function poolId() {
  return env('GCP_WORKLOAD_IDENTITY_POOL_ID') || DEFAULT_POOL_ID;
}

function providerId() {
  return env('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID') || DEFAULT_PROVIDER_ID;
}

function providerResource() {
  return `projects/${projectNumber()}/locations/global/workloadIdentityPools/${poolId()}/providers/${providerId()}`;
}

async function getFederatedToken() {
  const provider = providerResource();
  const oidcAudience = `https://iam.googleapis.com/${provider}`;
  const stsAudience = `//iam.googleapis.com/${provider}`;

  const subjectToken = await getVercelOidcToken({ audience: oidcAudience });
  if (!subjectToken) throw new Error('Token OIDC da Vercel não disponível.');

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    audience: stsAudience,
    scope: CLOUD_SCOPE,
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
  });

  const response = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Falha no Google STS (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error('Google STS não retornou access_token.');
  return data.access_token;
}

async function accessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const federatedToken = await getFederatedToken();
  const email = encodeURIComponent(serviceAccountEmail());

  const response = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${federatedToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope: [ANALYTICS_SCOPE],
        lifetime: '3600s',
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Falha ao representar a conta de serviço (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  if (!data.accessToken) throw new Error('IAM Credentials não retornou accessToken.');

  cachedAccessToken = data.accessToken;
  cachedAccessTokenExpiresAt = data.expireTime ? Date.parse(data.expireTime) : Date.now() + 50 * 60_000;
  return cachedAccessToken;
}

async function gaRequest(method, body) {
  const token = await accessToken();

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId()}:${method}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`GA4 ${method} falhou (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

export function runRealtimeReport(body) {
  return gaRequest('runRealtimeReport', body);
}

export function runReport(body) {
  return gaRequest('runReport', body);
}

export async function batchRunReports(requests) {
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 5) {
    throw new Error('batchRunReports aceita de 1 a 5 relatórios por lote.');
  }
  const response = await gaRequest('batchRunReports', { requests });
  return response.reports || [];
}

export function rows(report) {
  const dimensions = report.dimensionHeaders?.map((item) => item.name) || [];
  const metrics = report.metricHeaders?.map((item) => item.name) || [];

  return (report.rows || []).map((row) => {
    const item = {};
    dimensions.forEach((name, index) => {
      item[name] = row.dimensionValues?.[index]?.value ?? '';
    });
    metrics.forEach((name, index) => {
      const value = row.metricValues?.[index]?.value ?? '0';
      item[name] = Number.isNaN(Number(value)) ? value : Number(value);
    });
    return item;
  });
}
