/**
 * Mini-Keycloak-Admin-Client fuer E2E-Tests.
 * Legt User an und raeumt sie auch wieder weg. Funktioniert gegen den
 * Default-Admin admin/admin im master-Realm — passend zu
 * deployment/docker-compose.dev.yml.
 */
const KEYCLOAK_URL = process.env.LUMEN_KEYCLOAK_URL ?? "http://localhost:18080";
const REALM = "lumen";

async function adminToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: "admin",
    password: "admin",
  });
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    { method: "POST", body },
  );
  if (!res.ok) {
    throw new Error(`Admin-Token fehlgeschlagen: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export interface CreatedUser {
  id: string;
  username: string;
  password: string;
}

export async function createTestUser(
  username: string,
  password: string,
): Promise<CreatedUser> {
  const token = await adminToken();
  const create = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/users`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        email: username,
        firstName: "E2E",
        lastName: "Test",
        enabled: true,
        emailVerified: true,
        requiredActions: [],
        credentials: [{ type: "password", value: password, temporary: false }],
      }),
    },
  );
  if (!create.ok && create.status !== 201) {
    throw new Error(
      `User-Anlage fehlgeschlagen: ${create.status} ${await create.text()}`,
    );
  }

  const search = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=${encodeURIComponent(username)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const users = (await search.json()) as Array<{ id: string }>;
  const user = users[0];
  if (!user) throw new Error("Angelegter User nicht gefunden");
  return { id: user.id, username, password };
}

export async function deleteTestUser(userId: string): Promise<void> {
  try {
    const token = await adminToken();
    await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best effort cleanup */
  }
}

/**
 * Weist einem bestehenden Test-User die `admin`-Realm-Role zu. Muss
 * VOR dem Login-Flow passieren, weil bestehende Tokens die alte
 * Roles-Liste behalten.
 */
export async function assignAdminRole(userId: string): Promise<void> {
  const token = await adminToken();
  const roleRes = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/roles/admin`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!roleRes.ok) {
    throw new Error(
      `Admin-Role-Lookup fehlgeschlagen: ${roleRes.status}`,
    );
  }
  const role = await roleRes.json();
  const assign = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}/role-mappings/realm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([role]),
    },
  );
  if (!assign.ok && assign.status !== 204) {
    throw new Error(
      `Admin-Role-Assignment fehlgeschlagen: ${assign.status}`,
    );
  }
}
