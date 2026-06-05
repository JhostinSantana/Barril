export const PUBLIC_SITES = [
  { id: "portoviejo", name: "Barril Portoviejo", shortName: "Portoviejo" },
  { id: "chone", name: "Barril Chone", shortName: "Chone" },
];

export const PUBLIC_DASHBOARD_URL = "https://jhostinsantana.github.io/Barril/";
export const COMBINED_PUBLIC_SITE_ID = "combined";

const LEGACY_SNAPSHOT_KEY = "barril.publicDashboardSnapshot";
const LEGACY_API_KEY = "barril.publicApiBaseUrl";
const BRANCH_SITE_STORAGE_KEY = "barril.branchSiteId";
const SITE_API_PREFIX = "barril.publicApiBaseUrl.";
const SITE_SNAPSHOT_PREFIX = "barril.publicDashboardSnapshot.";

export function isPublicPagesHost() {
  if (typeof window === "undefined") return false;

  return (
    window.location.hostname.includes("github.io") &&
    window.location.pathname.includes("/Barril/")
  );
}

export function isPublicPagesView() {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") === "public") return true;

  return isPublicPagesHost();
}

export function getPublicDashboardMode() {
  if (!isPublicPagesView()) return "local";

  const params = new URLSearchParams(window.location.search);
  const legacyApi = params.get("api")?.trim();
  if (legacyApi && params.get("multi") !== "1") {
    return "single";
  }

  return "multi";
}

export function normalizePublicBackendUrl(value) {
  return `${value ?? ""}`.trim().replace(/\/+$/, "");
}

export function getPublicSiteById(siteId) {
  return PUBLIC_SITES.find((site) => site.id === siteId) ?? null;
}

export function isBranchSiteId(value) {
  return PUBLIC_SITES.some((site) => site.id === value);
}

export function readBranchSiteId() {
  if (typeof window === "undefined") return "";

  const stored = window.localStorage.getItem(BRANCH_SITE_STORAGE_KEY) ?? "";
  return isBranchSiteId(stored) ? stored : "";
}

export function writeBranchSiteId(siteId) {
  if (typeof window === "undefined") return;
  if (!isBranchSiteId(siteId)) {
    window.localStorage.removeItem(BRANCH_SITE_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(BRANCH_SITE_STORAGE_KEY, siteId);
}

function readSiteApiUrl(siteId) {
  if (typeof window === "undefined") return "";
  return (
    window.localStorage.getItem(`${SITE_API_PREFIX}${siteId}`) ??
    ""
  ).trim();
}

export function writeSiteApiUrl(siteId, value) {
  if (typeof window === "undefined") return;
  const normalized = normalizePublicBackendUrl(value);
  if (normalized) {
    window.localStorage.setItem(`${SITE_API_PREFIX}${siteId}`, normalized);
  } else {
    window.localStorage.removeItem(`${SITE_API_PREFIX}${siteId}`);
  }
}

export function readSiteSnapshot(siteId) {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(`${SITE_SNAPSHOT_PREFIX}${siteId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeSiteSnapshot(siteId, snapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${SITE_SNAPSHOT_PREFIX}${siteId}`,
      JSON.stringify(snapshot),
    );
  } catch {
    // Ignore storage errors.
  }
}

export function migrateLegacyPublicDashboardStorage() {
  if (typeof window === "undefined") return;

  const legacySnapshotRaw = window.localStorage.getItem(LEGACY_SNAPSHOT_KEY);
  if (legacySnapshotRaw && !readSiteSnapshot("portoviejo")) {
    try {
      writeSiteSnapshot("portoviejo", JSON.parse(legacySnapshotRaw));
    } catch {
      // Ignore invalid legacy snapshot.
    }
  }

  const legacyApi = window.localStorage.getItem(LEGACY_API_KEY);
  if (legacyApi && !readSiteApiUrl("portoviejo")) {
    writeSiteApiUrl("portoviejo", legacyApi);
  }
}

export function parsePublicSiteEntriesFromUrl() {
  migrateLegacyPublicDashboardStorage();

  const params = new URLSearchParams(window.location.search);
  const mode = getPublicDashboardMode();

  if (mode === "single") {
    const api = normalizePublicBackendUrl(params.get("api"));
    const siteParam = params.get("site")?.trim();
    const siteId = isBranchSiteId(siteParam) ? siteParam : "";

    if (api && siteId) {
      writeSiteApiUrl(siteId, api);
    }

    const site = getPublicSiteById(siteId);
    if (!site) return [];

    return [
      {
        ...site,
        apiUrl: api || readSiteApiUrl(site.id),
      },
    ];
  }

  return PUBLIC_SITES.map((site) => {
    const fromQuery = normalizePublicBackendUrl(params.get(`api_${site.id}`));
    if (fromQuery) {
      writeSiteApiUrl(site.id, fromQuery);
    }

    return {
      ...site,
      apiUrl: fromQuery || readSiteApiUrl(site.id),
    };
  });
}

export function buildMasterPublicDashboardUrl() {
  const url = new URL(PUBLIC_DASHBOARD_URL);
  url.searchParams.set("multi", "1");
  return url.toString();
}

export function buildBranchPublicDashboardUrl(backendUrl, siteId) {
  const normalizedUrl = normalizePublicBackendUrl(backendUrl);
  if (!isBranchSiteId(siteId)) return "";

  const url = new URL(PUBLIC_DASHBOARD_URL);
  url.searchParams.set("multi", "1");

  if (normalizedUrl) {
    url.searchParams.set(`api_${siteId}`, normalizedUrl);
  }

  return url.toString();
}

/** Compatibilidad con enlaces antiguos de una sola sede. */
export function buildLegacyPublicDashboardUrl(backendUrl) {
  const normalizedUrl = normalizePublicBackendUrl(backendUrl);
  if (!normalizedUrl) return "";

  const url = new URL(PUBLIC_DASHBOARD_URL);
  url.searchParams.set("api", normalizedUrl);
  url.searchParams.set("socket", normalizedUrl);
  return url.toString();
}

export function createInitialPublicSiteRuntime() {
  return Object.fromEntries(
    PUBLIC_SITES.map((site) => {
      const snapshot = readSiteSnapshot(site.id);
      return [
        site.id,
        {
          connected: false,
          lastSyncAt: snapshot?.syncedAt ?? null,
          error: "",
          snapshot,
        },
      ];
    }),
  );
}

export async function fetchPublicDashboardSnapshot(apiBaseUrl) {
  const baseUrl = normalizePublicBackendUrl(apiBaseUrl);
  if (!baseUrl) {
    throw new Error("Sin URL de servidor.");
  }

  const requestUrl = new URL(
    "/api/dashboard/snapshot",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
  const response = await fetch(requestUrl);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message ?? "No se pudo leer el dashboard.");
  }

  return response.json();
}

export function formatPublicSyncLabel(isoString) {
  if (!isoString) return "Sin sincronizar";

  try {
    return new Date(isoString).toLocaleString("es-CO", {
      timeZone: "America/Bogota",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Sin sincronizar";
  }
}

export const PUBLIC_DASHBOARD_PIN_SESSION_KEY = "barril.publicDashboard.pinSession";
export const PUBLIC_DASHBOARD_PIN_TTL_MS = 30 * 60 * 1000;

export function isPublicDashboardPinSessionValid() {
  if (typeof window === "undefined") return false;

  const raw = window.sessionStorage.getItem(PUBLIC_DASHBOARD_PIN_SESSION_KEY);
  const unlockedAt = Number(raw);
  if (!Number.isFinite(unlockedAt)) return false;

  return Date.now() - unlockedAt < PUBLIC_DASHBOARD_PIN_TTL_MS;
}

export function markPublicDashboardPinSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    PUBLIC_DASHBOARD_PIN_SESSION_KEY,
    String(Date.now()),
  );
}

export function clearPublicDashboardPinSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PUBLIC_DASHBOARD_PIN_SESSION_KEY);
}

export function buildMultiSiteStatusLabel(siteRuntime) {
  return PUBLIC_SITES.map((site) => {
    const runtime = siteRuntime[site.id];
    const status = runtime?.connected
      ? "en línea"
      : runtime?.snapshot
        ? "última sync"
        : "sin datos";
    return `${site.shortName}: ${status}`;
  }).join(" · ");
}
