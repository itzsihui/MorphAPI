import sendEmail from "mail-send-v1";

/**
 * Seed / bootstrap helper — welcome mail for demo tenants.
 * Easy to miss when migrating only the main notify service.
 */
export async function seedWelcomeEmails(tenants: string[]) {
  for (const tenant of tenants) {
    await sendEmail(
      `admin@${tenant}`,
      "seed@morphapi.demo",
      "Demo tenant ready",
      `Tenant ${tenant} was seeded.`
    );
  }
}
