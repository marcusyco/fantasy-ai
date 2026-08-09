/**
 * Yahoo OAuth 2.0 (Authorization Code Grant), confirmed against
 * https://developer.yahoo.com/oauth2/guide/flows_authcode/.
 *
 * Fantasy Sports read scope is granted per-app when you register at
 * developer.yahoo.com (check "Fantasy Sports" → Read under API Permissions);
 * there is no separate `scope` request parameter to pass.
 */

const AUTHORIZATION_ENDPOINT = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_ENDPOINT = 'https://api.login.yahoo.com/oauth2/get_token';

export interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number; // seconds; Yahoo access tokens are short-lived (~3600s)
  xoauth_yahoo_guid?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} env var.`);
  return value;
}

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('YAHOO_CLIENT_ID'),
    redirect_uri: requireEnv('YAHOO_REDIRECT_URI'),
    response_type: 'code',
    language: 'en-us',
    state,
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

function basicAuthHeader(): string {
  const clientId = requireEnv('YAHOO_CLIENT_ID');
  const clientSecret = requireEnv('YAHOO_CLIENT_SECRET');
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

async function postToken(params: Record<string, string>): Promise<YahooTokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo token request failed (${res.status}): ${raw}`);
  }
  return JSON.parse(raw) as YahooTokenResponse;
}

export function exchangeCodeForTokens(code: string): Promise<YahooTokenResponse> {
  return postToken({
    client_id: requireEnv('YAHOO_CLIENT_ID'),
    redirect_uri: requireEnv('YAHOO_REDIRECT_URI'),
    code,
    grant_type: 'authorization_code',
  });
}

export function refreshAccessToken(refreshToken: string): Promise<YahooTokenResponse> {
  return postToken({
    client_id: requireEnv('YAHOO_CLIENT_ID'),
    redirect_uri: requireEnv('YAHOO_REDIRECT_URI'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}
