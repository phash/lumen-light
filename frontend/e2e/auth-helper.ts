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

/**
 * Holt einen Access-Token via ROPC (Direct Access Grant) — funktioniert
 * weil der Test-Realm `directAccessGrantsEnabled=true` setzt. Damit
 * koennen E2E-Tests Backend-API direkt callen, ohne die ganze
 * UI-Interaktion durchzuspielen.
 */
const KEYCLOAK_URL = process.env.LUMEN_KEYCLOAK_URL ?? "http://localhost:18080";
const REALM = "lumen";

export async function apiTokenFor(user: CreatedUser): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "lumen-frontend",
    username: user.username,
    password: user.password,
    scope: "openid",
  });
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    { method: "POST", body },
  );
  if (!res.ok) {
    throw new Error(
      `apiTokenFor fehlgeschlagen: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}
