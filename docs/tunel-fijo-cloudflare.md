# Tunel fijo Cloudflare (ver dashboard desde casa)

Con esto el dueno puede abrir el dashboard desde cualquier internet (casa, celular, otro pais). Cada sede mantiene su propia base de datos.

## Que necesitas

- Laptop del local encendida con Barril activo
- Cuenta gratis en Cloudflare: https://dash.cloudflare.com/sign-up
- Un dominio propio en Cloudflare (ej. `ahumadosalbarril.com`) — unico costo opcional (~USD 10/anio)

## Paso 0 — Dos laptops (prueba en el mismo lugar)

En **cada laptop** crea `apps/server/.env`:

Laptop A (simula Portoviejo):

```env
BARRIL_BRANCH_SITE_ID=portoviejo
BARRIL_AUTO_START_TUNNEL=1
```

Laptop B (simula Chone):

```env
BARRIL_BRANCH_SITE_ID=chone
BARRIL_AUTO_START_TUNNEL=1
```

Reinicia el servidor en ambas. Cada una abrira su tunel solo. En Conectividad verifica que la sede sea la correcta. El dueno abre una vez el QR de cada sede (PIN admin) para registrar ambas URLs en su celular.

## Paso 1 — Crear tunel por sede

Repite en **Portoviejo** y **Chone**:

1. Entra a Cloudflare → **Zero Trust** → **Networks** → **Tunnels**.
2. **Create a tunnel** → nombre: `barril-portoviejo` o `barril-chone`.
3. Instala el conector (o usa el token que te da Cloudflare).
4. En **Public Hostname** agrega:
   - Subdominio: `portoviejo` (o `chone`)
   - Domain: tu dominio
   - Service: `http://localhost:4000`
5. Guarda la URL fija, por ejemplo:
   - `https://portoviejo.tudominio.com`
   - `https://chone.tudominio.com`
6. Copia el **Tunnel token** de esa sede.

## Paso 2 — Variables en la laptop de cada sede

Crea `apps/server/.env` (no se sube a git):

**Portoviejo**

```env
BARRIL_PUBLIC_URL=https://portoviejo.tudominio.com
CLOUDFLARE_TUNNEL_TOKEN=pega_aqui_el_token_de_portoviejo
BARRIL_AUTO_START_TUNNEL=1
```

**Chone**

```env
BARRIL_PUBLIC_URL=https://chone.tudominio.com
CLOUDFLARE_TUNNEL_TOKEN=pega_aqui_el_token_de_chone
BARRIL_AUTO_START_TUNNEL=1
```

Reinicia el servidor Barril. El tunel arranca solo y la URL publica ya no cambia.

## Paso 3 — Link fijo del dueno (GitHub Pages)

Guarda este enlace en favoritos del celular del dueno:

```
https://jhostinsantana.github.io/Barril/?multi=1&api_portoviejo=https://portoviejo.tudominio.com&api_chone=https://chone.tudominio.com
```

Reemplaza `tudominio.com` por tu dominio real.

## Paso 4 — Probar desde casa

1. En el local: laptop encendida, servidor activo, tunel en verde.
2. En casa: abre el link multi-sede.
3. Debes ver **Ambas sedes**, **Portoviejo** y **Chone** con ultima sync.

Si un local esta cerrado, veras la ultima informacion guardada en ese navegador.

## Sin dominio propio (temporal)

Puedes usar el tunel rapido desde la laptop (**Conectividad → Iniciar tunel**). La URL cambia al reiniciar; abre el enlace de sede una vez por reinicio para actualizar el celular del dueno.

## Seguridad

- No compartas el token del tunel.
- El dashboard administrativo sigue protegido por PIN en la laptop.
- GitHub Pages solo muestra estadisticas; no expone la caja completa sin el backend activo.
