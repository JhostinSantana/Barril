const gist =
  "https://gist.githubusercontent.com/JhostinSantana/f2ce64f6b6c35caafac2dfbc99c45677/raw/barril-tunnel-urls.json";
const expectedTunnel = "https://wiley-describe-watch-reward.trycloudflare.com";

const g = await fetch(gist, { cache: "no-store" }).then((r) => r.json());
console.log("GIST:", JSON.stringify(g, null, 2));

const tunnelUrl = `${g.portoviejo ?? ""}`.trim();
console.log("GIST_PORTOVIEJO_MATCHES_LAPTOP:", tunnelUrl === expectedTunnel);

if (tunnelUrl) {
  const snap = await fetch(`${tunnelUrl}/api/dashboard/snapshot`, {
    headers: { Origin: "https://jhostinsantana.github.io" },
  });
  console.log("GIST_URL_TUNNEL_STATUS:", snap.status);
} else {
  console.log("GIST_URL_TUNNEL_STATUS: no portoviejo url in gist");
}

const snapDirect = await fetch(`${expectedTunnel}/api/dashboard/snapshot`, {
  headers: { Origin: "https://jhostinsantana.github.io" },
});
console.log("LAPTOP_TUNNEL_STATUS:", snapDirect.status);
if (snapDirect.ok) {
  const body = await snapDirect.json();
  console.log("LAPTOP_PAID_ORDERS:", body.paidOrders?.length ?? 0);
}

const html = await fetch("https://jhostinsantana.github.io/Barril/").then((r) =>
  r.text(),
);
const bundleName = html.match(/index-[^"]+\.js/)?.[0];
if (bundleName) {
  const bundle = await fetch(
    `https://jhostinsantana.github.io/Barril/${bundleName}`,
  ).then((r) => r.text());
  console.log("PAGES_HAS_GIST_REGISTRY:", bundle.includes("gist.githubusercontent.com"));
  const gistInBundle = bundle.match(/https:\/\/gist\.githubusercontent\.com[^"'`\s]+/);
  console.log("PAGES_GIST_URL:", gistInBundle?.[0] ?? "NOT FOUND");
}
