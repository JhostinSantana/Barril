# Tunel fijo Cloudflare — link permanente para las dos sedes

Con URLs fijas, el dueno usa **un solo favorito** y funciona siempre, aunque apagues y enciendas el servidor mil veces.

## Que necesitas (una sola vez)

1. Cuenta gratis Cloudflare: https://dash.cloudflare.com/sign-up
2. Un dominio en Cloudflare (ej. `ahumadosalbarril.com`) — ~USD 10/año
3. Dos subdominios:
   - `https://portoviejo.tudominio.com` → laptop Portoviejo
   - `https://chone.tudominio.com` → laptop Chone

---

## Paso 1 — Tunel Cloudflare por sede

Repite en **Portoviejo** y **Chone**:

1. Cloudflare → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
2. Nombre: `barril-portoviejo` o `barril-chone`
3. **Public Hostname**:
   - Subdominio: `portoviejo` o `chone`
   - Service: `http://localhost:4000`
4. Copia el **Tunnel token**

---

## Paso 2 — `.env` en cada laptop

**Portoviejo** (`apps/server/.env`):

```env
BARRIL_PUBLIC_URL=https://portoviejo.tudominio.com
CLOUDFLARE_TUNNEL_TOKEN=token_de_portoviejo
BARRIL_AUTO_START_TUNNEL=1
```

**Chone** (`apps/server/.env`):

```env
BARRIL_PUBLIC_URL=https://chone.tudominio.com
CLOUDFLARE_TUNNEL_TOKEN=token_de_chone
BARRIL_AUTO_START_TUNNEL=1
```

Reinicia el servidor. El tunel arranca solo. La URL **no cambia**.

En cada laptop: **Conectividad → confirmar sede** (Portoviejo o Chone).

---

## Paso 3 — Link permanente del dueno

### Opcion A — Desde la laptop (mas facil)

1. Conectividad → PIN admin → **Link fijo multi-sede**
2. Pega las dos URLs fijas
3. **Guardar URLs fijas del dueno**
4. Copia o escanea el **QR permanente**

Ese link incluye las dos sedes y **nunca cambia**.

### Opcion B — GitHub Pages (favorito aun mas simple)

En GitHub → **Settings → Secrets → Actions**, agrega:

| Secret | Valor |
|--------|--------|
| `VITE_SITE_URL_PORTOVIEJO` | `https://portoviejo.tudominio.com` |
| `VITE_SITE_URL_CHONE` | `https://chone.tudominio.com` |

Haz un push o re-ejecuta el workflow **Deploy laptop to GitHub Pages**.

El dueno guarda solo:

```
https://jhostinsantana.github.io/Barril/?multi=1
```

GitHub Pages ya conoce las dos URLs fijas por dentro.

### Opcion C — Link manual (sin tocar GitHub)

```
https://jhostinsantana.github.io/Barril/?multi=1&api_portoviejo=https://portoviejo.tudominio.com&api_chone=https://chone.tudominio.com
```

Reemplaza `tudominio.com`. Este string **no cambia nunca**.

---

## Paso 4 — Probar

1. Enciende ambas laptops (servidor activo)
2. Abre el link permanente en el celular del dueno + PIN
3. Debes ver **Portoviejo** y **Chone**
4. Apaga y enciende un servidor → el mismo link sigue funcionando

---

## Sin dominio (temporal)

El tunel rapido `trycloudflare.com` **cambia** al reiniciar. Solo sirve para pruebas. Para produccion usa dominio + tunel con nombre.
