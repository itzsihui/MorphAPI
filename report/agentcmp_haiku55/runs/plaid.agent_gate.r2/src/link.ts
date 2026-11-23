import createPlaidClient, { CountryCode, Products } from "plaid-link-v2";

/**
 * Link token helpers using typed Products / CountryCode enums.
 */
export async function createUserLinkToken(userId: string) {
  const client = createPlaidClient({
    clientId: process.env.PLAID_CLIENT_ID ?? "client_demo",
    secret: process.env.PLAID_SECRET ?? "secret_demo",
  });

  // Usage site 1 — US transactions Link
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "MorphAPI Demo",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return response.link_token;
}

export async function createUkAuthLinkToken(userId: string) {
  const client = createPlaidClient({
    clientId: process.env.PLAID_CLIENT_ID ?? "client_demo",
    secret: process.env.PLAID_SECRET ?? "secret_demo",
  });

  // Usage site 2 — UK auth Link
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "MorphAPI Demo UK",
    products: [Products.Auth],
    country_codes: [CountryCode.Gb],
    language: "en",
  });

  return response.link_token;
}
