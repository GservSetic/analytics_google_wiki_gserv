import { GoogleAuth } from 'google-auth-library';

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

function env(name) {
  return process.env[name]?.trim();
}

export function isConfigured() {
  return Boolean(env('GA_PROPERTY_ID') && env('GA_CLIENT_EMAIL') && env('GA_PRIVATE_KEY'));
}

export function propertyId() {
  return env('GA_PROPERTY_ID') || '554924878';
}

async function accessToken() {
  const privateKey = env('GA_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  const auth = new GoogleAuth({
    credentials: {
      client_email: env('GA_CLIENT_EMAIL'),
      private_key: privateKey,
    },
    scopes: [SCOPE],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return typeof token === 'string' ? token : token?.token;
}

async function gaRequest(method, body) {
  const token = await accessToken();
  if (!token) throw new Error('Não foi possível obter token do Google Analytics.');

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
    const detail = await response.text();
    throw new Error(`GA4 ${method} falhou (${response.status}): ${detail}`);
  }

  return response.json();
}

export function runRealtimeReport(body) {
  return gaRequest('runRealtimeReport', body);
}

export function runReport(body) {
  return gaRequest('runReport', body);
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
