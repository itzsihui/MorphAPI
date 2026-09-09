/**
 * Legacy Plaid-style client: products and country_codes as plain strings.
 * Real Plaid TypeScript SDK (plaid@30+) requires Products / CountryCode enums.
 */

export interface LinkTokenCreateRequest {
  user: { client_user_id: string };
  client_name: string;
  /** @deprecated Prefer Products enum members in plaid-link-v2 */
  products: string[];
  /** @deprecated Prefer CountryCode enum members in plaid-link-v2 */
  country_codes: string[];
  language: string;
}

export interface LinkTokenCreateResponse {
  link_token: string;
  expiration: string;
}

export interface PlaidApi {
  linkTokenCreate(
    request: LinkTokenCreateRequest
  ): Promise<LinkTokenCreateResponse>;
}

export function createPlaidClient(_config: {
  clientId: string;
  secret: string;
}): PlaidApi {
  return {
    async linkTokenCreate(request) {
      return {
        link_token: `link-sandbox-${request.user.client_user_id}`,
        expiration: new Date(Date.now() + 3600_000).toISOString(),
      };
    },
  };
}

export default createPlaidClient;
