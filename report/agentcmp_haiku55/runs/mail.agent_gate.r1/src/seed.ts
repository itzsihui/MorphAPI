import send from "mail-send-v2";

/**
 * Seed / bootstrap helper — welcome mail for demo tenants.
 * Easy to miss when migrating only the main notify service.
 */
export async function seedWelcomeEmails(tenants: string[]) {
  for (const tenant of tenants) {
    await send({
      to: `admin@${tenant}`,
      from: "seed@morphapi.demo",
      subject: "Demo tenant ready",
      content: `Tenant ${tenant} was seeded.`,
    });
  }
}
