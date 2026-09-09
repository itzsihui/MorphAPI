/**
 * Target Plaid-style Link API.
 *
 * Enum member names match the published TypeScript SDK (plaid@30 api.d.ts):
 *   CountryCode.Us = "US"   — NOT CountryCode.US / USA / UnitedStates
 *   Products.Transactions = "transactions" — NOT TRANSACTIONS / Transaction
 *
 * Deliberate near-miss traps LLMs invent from training data.
 */

export enum CountryCode {
  Us = "US",
  Gb = "GB",
  Ca = "CA",
  Fr = "FR",
  De = "DE",
}

export enum Products {
  Auth = "auth",
  Identity = "identity",
  Transactions = "transactions",
  Investments = "investments",
  Liabilities = "liabilities",
}

export interface LinkTokenCreateRequest {
  user: { client_user_id: string };
  client_name: string;
  products: Products[];
  country_codes: CountryCode[];
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
