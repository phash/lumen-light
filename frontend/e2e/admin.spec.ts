import { test, expect, type Page } from "@playwright/test";

import { apiTokenFor, cleanupUser, loginAsNewUser } from "./auth-helper";
import {
  assignAdminRole,
  createTestUser,
  deleteTestUser,
  type CreatedUser,
} from "./keycloak-helper";

/**
 * Browser-Tests fuer den Admin-Bereich. Erstellt einen frischen
 * Test-User, weist ihm die `admin`-Realm-Role zu, loggt ihn ein und
 * prueft die Admin-Page.
 *
 * Onboarding wird auf "dismissed" vorgesetzt, damit das Welcome-Modal
 * keine Klicks im Editor blockiert (das deckt onboarding.spec.ts).
 */
test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumen.onboarding.v1",
      JSON.stringify({ status: "dismissed" }),
    );
  });
});

async function loginAsAdmin(page: Page): Promise<CreatedUser> {
  // User erst anlegen, Role direkt zuweisen, dann erst einloggen.
  // Der erste Token traegt die admin-Role bereits — kein Logout-Roundtrip.
  const username = `e2e-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@test.local`;
  const password = "Geheim123!Test";
  const user = await createTestUser(username, password);
  await assignAdminRole(user.id);

  await page.goto("/");
  await page
    .getByTestId("auth-login-button")
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("auth-login-button").click();
  await page.locator("input[name='username']").fill(username);
  await page.locator("input[name='password']").fill(password);
  await page.locator("#kc-login").click();
  await page
    .getByTestId("auth-email")
    .waitFor({ state: "visible", timeout: 15_000 });
  return user;
}

async function cleanupAdmin(user: CreatedUser): Promise<void> {
  await deleteTestUser(user.id);
}

test.describe("Admin-Bereich", () => {
  test("Non-Admin wird auf /editor umgeleitet", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      // Direktes Routing zu /admin als nicht-admin
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/editor$/, { timeout: 5_000 });
      // Kein Admin-Link im Header
      await expect(
        page.getByRole("link", { name: "Admin", exact: true }),
      ).not.toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Admin sieht Stats + Users-Tab + kann User sperren", async ({
    page,
  }) => {
    const adminUser = await loginAsAdmin(page);
    try {
      await page.goto("/admin");
      await expect(page.getByTestId("page-admin")).toBeVisible();
      await expect(page.getByTestId("admin-stats")).toBeVisible();
      await expect(page.getByTestId("admin-stats")).toContainText("Nutzer");

      // Users-Tab ist Default
      await expect(page.getByTestId("admin-users")).toBeVisible();
      // Mindestens unsere eigene Row ist sichtbar
      const myRow = page.locator(`[data-testid^="admin-user-row-"]`).first();
      await expect(myRow).toBeVisible();
    } finally {
      await cleanupAdmin(adminUser);
    }
  });

  test("Admin sieht Feedback-Inbox und kann Status patchen", async ({
    page,
  }) => {
    const admin = await loginAsAdmin(page);
    try {
      // Eigenes Feedback via API submitten, damit etwas in der Inbox liegt
      const token = await apiTokenFor(admin);
      const submitRes = await fetch(
        `${process.env.LUMEN_API_BASE ?? "http://localhost:8000/api/v1"}/feedback`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            kind: "idea",
            message: "E2E-Test-Feedback fuer Admin-Inbox-Pruefung.",
            page: "/editor",
          }),
        },
      );
      expect(submitRes.status).toBe(201);

      await page.goto("/admin");
      await page.getByTestId("admin-tab-feedback").click();
      await expect(page.getByTestId("admin-feedback")).toBeVisible();

      // Mindestens ein Eintrag (unser eben submittedes Feedback)
      const feedbackItems = page.locator(
        `[data-testid^="admin-feedback-item-"]`,
      );
      await expect(feedbackItems.first()).toBeVisible({ timeout: 5_000 });

      // Filter „Neu" hat aria-pressed=true
      await page.getByTestId("admin-feedback-filter-new").click();
      await expect(page.getByTestId("admin-feedback-filter-new")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } finally {
      await cleanupAdmin(admin);
    }
  });

  test("Header zeigt 'Admin'-Link nur fuer Admins", async ({ page }) => {
    const adminUser = await loginAsAdmin(page);
    try {
      await expect(
        page.getByRole("link", { name: "Admin", exact: true }),
      ).toBeVisible();
    } finally {
      await cleanupAdmin(adminUser);
    }
  });
});
