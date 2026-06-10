const bundleUrl =
  "https://jhostinsantana.github.io/Barril/assets/index-Cythc6IX.js";
const bundle = await fetch(bundleUrl).then((r) => r.text());
const gistMatch = bundle.match(
  /https:\/\/gist\.githubusercontent\.com[^"'`\s]+/,
);
console.log("deployed_gist_url:", gistMatch?.[0] ?? "NOT FOUND");

const registryUrl =
  gistMatch?.[0] ??
  "https://gist.githubusercontent.com/JhostinSantana/f2ce64f6b6c35caafac2dfbc99c45677/raw/barril-tunnel-urls.json";
const registry = await fetch(registryUrl, { cache: "no-store" }).then((r) =>
  r.json(),
);
console.log("registry:", registry);

const choneUrl = `${registry.chone ?? ""}`.trim().replace(/\/+$/, "");
if (!choneUrl) {
  console.log("chone_url: MISSING");
  process.exit(1);
}

const snapshot = await fetch(`${choneUrl}/api/dashboard/snapshot`, {
  headers: { Origin: "https://jhostinsantana.github.io" },
}).then((r) => r.json());
console.log("snapshot_ok:", Boolean(snapshot.restaurantName));
console.log("restaurant:", snapshot.restaurantName);
console.log("paid_orders:", snapshot.paidOrders?.length ?? 0);
