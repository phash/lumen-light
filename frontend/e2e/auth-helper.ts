import type { Page } from "@playwright/test";

import { createTestUser, deleteTestUser, type CreatedUser } from "./keycloak-helper";

/**
 * Lebenszyklus eines Test-Users: Keycloak-User anlegen, im Browser durch
 * den Login-Flow gehen, am Ende User wieder loeschen.
 */
export async function loginAsNewUser(page: Page): Promise<CreatedUser> {
  const username = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const password = "Geheim123!Test";
  const user = await createTestUser(username, password);

  await page.goto("/");

  // Warten bis IRGENDEIN Auth-Button sichtbar ist — auth.isLoading kann
  // anfangs true sein und beide Buttons unterdruecken.
  await Promise.race([
    page
      .getByTestId("auth-login-button")
      .waitFor({ state: "visible", timeout: 15_000 }),
    page
      .getByRole("button", { name: "Logout" })
      .waitFor({ state: "visible", timeout: 15_000 }),
  ]);

  // Wenn aus einem vorherigen Test eine Keycloak-Session uebrig ist,
  // zuerst ausloggen.
  const loginVisible = await page
    .getByTestId("auth-login-button")
    .isVisible();
  if (!loginVisible) {
    await page.getByRole("button", { name: "Logout" }).click();
    await page
      .getByTestId("auth-login-button")
      .waitFor({ state: "visible", timeout: 15_000 });
  }

  await page.getByTestId("auth-login-button").click();

  // Auf der Keycloak-Login-Page das Form ausfuellen
  await page.locator("input[name='username']").fill(username);
  await page.locator("input[name='password']").fill(password);
  await page.locator("#kc-login").click();

  // Zurueck im Frontend mit Token — Header zeigt Email
  await page.getByTestId("auth-email").waitFor({ state: "visible", timeout: 15_000 });
  return user;
}

export async function cleanupUser(user: CreatedUser): Promise<void> {
  await deleteTestUser(user.id);
}
