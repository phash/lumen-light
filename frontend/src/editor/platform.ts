/**
 * Plattform-Erkennung fuer Tastenkuerzel-Beschriftungen: Mac zeigt "Cmd",
 * alle anderen "Strg". Bevorzugt navigator.userAgentData (Chromium),
 * faellt auf navigator.platform / userAgent zurueck.
 */
interface NavigatorUAData {
  readonly platform?: string;
}

export function isMacPlatform(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const uaData = (nav as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  const platform = uaData?.platform ?? nav.platform ?? "";
  if (platform) return /mac|iphone|ipad|ipod/i.test(platform);
  return /mac os x|iphone|ipad/i.test(nav.userAgent ?? "");
}

/** Beschriftung der Modifier-Taste: "Cmd" auf Mac, sonst "Strg". */
export function modKeyLabel(nav?: Navigator): string {
  return isMacPlatform(nav) ? "Cmd" : "Strg";
}
