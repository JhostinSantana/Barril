const GIST_FILENAME = "barril-tunnel-urls.json";

function parseRegistryContent(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function publishTunnelUrlToRegistry(siteId, publicUrl) {
  const gistId = `${process.env.GITHUB_TUNNEL_GIST_ID ?? ""}`.trim();
  const token = `${process.env.GITHUB_TUNNEL_GIST_TOKEN ?? ""}`.trim();
  const normalizedUrl = `${publicUrl ?? ""}`.trim().replace(/\/+$/, "");

  if (!gistId || !token || !siteId || !normalizedUrl) {
    return { ok: false, skipped: true };
  }

  const gistResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!gistResponse.ok) {
    throw new Error(`No se pudo leer el gist del registro (${gistResponse.status}).`);
  }

  const gist = await gistResponse.json();
  const currentContent =
    gist?.files?.[GIST_FILENAME]?.content ??
    gist?.files?.["barril-tunnel-urls.json"]?.content ??
    "{}";
  const nextRegistry = {
    ...parseRegistryContent(currentContent),
    [siteId]: normalizedUrl,
    updatedAt: new Date().toISOString(),
  };

  const patchResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: `${JSON.stringify(nextRegistry, null, 2)}\n`,
        },
      },
    }),
  });

  if (!patchResponse.ok) {
    throw new Error(`No se pudo actualizar el gist del registro (${patchResponse.status}).`);
  }

  return { ok: true, registry: nextRegistry };
}
