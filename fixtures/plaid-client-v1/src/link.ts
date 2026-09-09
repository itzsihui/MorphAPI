import createPlaidClient from "plaid-link-v1";

/**
 * Link token helpers using legacy string products / country_codes.
 * Migrate to plaid-link-v2 CountryCode / Products enums.
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
    products: ["transactions"],
    country_codes: ["US"],
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
    products: ["auth"],
    country_codes: ["GB"],
    language: "en",
  });

  return response.link_token;
}
