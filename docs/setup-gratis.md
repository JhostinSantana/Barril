# Setup 100% gratis (Portoviejo + Chone)

Sin pagar dominio. Usa Cloudflare gratis + un Gist gratis de GitHub para que el celular del dueno siempre encuentre las dos sedes, aunque reinicies el servidor.

## Link del dueno (favorito unico)

```
https://jhostinsantana.github.io/Barril/?multi=1
```

Ese link **nunca cambia**. Pide PIN de administrador al abrir.

---

## Paso 1 — Gist gratis (5 minutos, una sola vez)

1. Entra a https://gist.github.com con tu cuenta GitHub.
2. Crea un Gist **secreto** con:
   - Nombre del archivo: `barril-tunnel-urls.json`
   - Contenido:

```json
{
  "portoviejo": "",
  "chone": ""
}
```

3. Guarda y copia el **ID del gist** (lo ultimo de la URL).
4. Crea un token gratis: GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained token** con permiso **Gists: Read and write**.
5. Abre el Gist → boton **Raw** → copia la URL raw (termina en `/raw/.../barril-tunnel-urls.json`).

---

## Paso 2 — GitHub Pages (una sola vez)

En el repo **Barril** → Settings → Secrets and variables → Actions → New secret:

| Secret | Valor |
|--------|--------|
| `VITE_TUNNEL_REGISTRY_URL` | URL raw del gist del paso 1 |

Guarda. El proximo deploy de Pages ya usa el registro automatico.

---

## Paso 3 — `.env` en cada laptop (gratis)

Crea `apps/server/.env` en **cada** laptop:

**Laptop Portoviejo:**

```env
GITHUB_TUNNEL_GIST_ID=pega_el_id_del_gist
GITHUB_TUNNEL_GIST_TOKEN=pega_el_token_github
TUNNEL_REGISTRY_PUBLIC_URL=https://gist.githubusercontent.com/.../barril-tunnel-urls.json
BARRIL_AUTO_START_TUNNEL=1
```

**Laptop Chone:** mismo gist y mismo token (pueden compartirse).

Reinicia el servidor en ambas.

---

## Paso 4 — Confirmar sede (una vez por laptop)

1. Conectividad → elige **Portoviejo** o **Chone**
2. **Confirmar sede de esta laptop**
3. Espera ~15 s a que el tunel arranque solo

Cada laptop publica su URL nueva al Gist automaticamente al reiniciar.

---

## Paso 5 — Celular del dueno

1. Abre `https://jhostinsantana.github.io/Barril/?multi=1`
2. PIN administrador
3. Veras **Portoviejo** y **Chone**

No necesitas volver a escanear QR cada vez que reinicias el servidor.

---

## Como funciona

```
Laptop Portoviejo ──► tunel Cloudflare gratis ──► actualiza Gist
Laptop Chone      ──► tunel Cloudflare gratis ──► actualiza Gist
Celular del dueno ──► GitHub Pages ?multi=1 ──► lee Gist ──► muestra ambas sedes
```

Todo cuesta **$0**.

---

## Si algo falla

- **Una sede sin datos:** esa laptop apagada o sin confirmar sede.
- **Gist vacio:** espera a que el tunel termine de iniciar (~20 s).
- **Token invalido:** revisa permiso Gists en el token de GitHub.
