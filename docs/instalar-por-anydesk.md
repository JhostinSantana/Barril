# Instalar Barril por AnyDesk (Portoviejo o Chone)

Guía corta para dejar **meseros, cocina y caja** funcionando en la laptop del local.

---

## Antes de empezar (en la laptop remota)

Necesitas instalado:

1. **Node.js LTS** — https://nodejs.org  
2. **Git** — https://git-scm.com/download/win  

Cierra cualquier ventana vieja de Barril (`Barril-master` en Descargas **no se usa más**).

---

## Instalación automática (recomendado)

1. Abre **CMD** o **PowerShell**.
2. Descarga y ejecuta el instalador (como **Administrador** si puedes):

```cmd
git clone https://github.com/JhostinSantana/Barril.git C:\Barril
cd C:\Barril
scripts\instalar-laptop-produccion.cmd
```

3. Cuando pregunte por arranque automático: **S** = sí (recomendado para producción).

4. Edita el token en `C:\Barril\apps\server\.env` (solo si dice `PEGA_AQUI_TU_TOKEN`).

5. En el navegador → **Conectividad**:
   - Portoviejo → **Barril Portoviejo** → **Confirmar sede**
   - Chone → **Barril Chone** → **Confirmar sede**

---

## Conectar meseros (app Android)

1. Celular en la **misma WiFi** del restaurante.
2. Abre la app de meseros.
3. Escanea el **QR** de Conectividad en la laptop  
   **o** escribe la URL local, ejemplo: `http://192.168.100.17:4000`
4. El mesero registra su nombre (debe estar autorizado en la laptop).

Si no conecta: borra la URL guardada en la app y vuelve a escanear.

---

## Conectar cocina (app CocinaNative)

1. Tablet/celular en la **misma WiFi**.
2. Abrir app → conectar → URL: `http://IP_DE_LA_LAPTOP:4000`
3. Debe decir **En línea**.

---

## Prueba obligatoria (30 segundos)

Desde un celular en la WiFi del local, abre Chrome:

```
http://IP_QUE_MUESTRA_CONECTIVIDAD:4000/health
```

Debe aparecer:

```json
{"ok":true,"service":"asados-en-el-barril-server"}
```

Si **no carga** → firewall o IP incorrecta. Vuelve a ejecutar el instalador **como Administrador**.

---

## Arranque diario

Doble clic en el escritorio: **Iniciar Barril.bat**

O el sistema arranca solo si instalaste autostart.

Panel caja: http://localhost:5173/Barril/

---

## Repetir en la otra sede

Mismo proceso en la **otra laptop**. El archivo `.env` es **igual** en las dos.  
Solo cambia qué sede confirmas en Conectividad.

---

## Link del dueño (celular, fuera del local)

```
https://jhostinsantana.github.io/Barril/?multi=1
```

PIN: `040420`

Requiere ambas laptops encendidas con `.env` y túnel activo.
