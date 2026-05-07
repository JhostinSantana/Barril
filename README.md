# Asados en el Barril - Sistema de Comandas

Proyecto con 3 modulos conectados:

- `apps/server`: cerebro central con SQLite, comandas, cuentas, pagos, estadisticas y cierre de caja.
- `apps/laptop`: panel principal para caja, estadisticas y dias anteriores.
- `apps/mobile`: app nativa Expo/React Native para Android con menu sin precios.

## Requisitos

- Node.js 20+
- npm 10+

## Instalacion

```bash
npm install
```

## Arranque automatico en Windows (sin consola)

Para que la laptop inicie sola el hub al encender Windows:

1. Ejecuta `install-autostart.bat` como el usuario que usa la laptop.
2. Ese instalador crea una tarea programada llamada `BarrilHubAutoStart`.
3. En cada inicio de sesion, la tarea levanta API y laptop en segundo plano (sin abrir ventanas).

Para desinstalar el arranque automatico:

```bash
uninstall-autostart.bat
```

Los logs del arranque silencioso quedan en la carpeta `logs` del proyecto.

## Ejecutar en desarrollo

En terminales separadas:

```bash
npm run dev:server
npm run dev:laptop
npm run dev:mobile
```

Tambien puedes arrancar la laptop completa con un solo comando:

```bash
npm run dev:hub
```

En Windows tambien puedes abrir `start-hub.bat` para levantar la API y el panel de laptop en dos ventanas.

Para exponer la caja a meseros fuera de tu red local, ejecuta el backend con un tunel HTTPS seguro. El comando preparado es:

```bash
npm run tunnel:server
```

Eso abre un tunel publico hacia `http://localhost:4000`. Luego la app movil debe apuntar a la URL HTTPS que te entregue Cloudflare mediante `EXPO_PUBLIC_API_URL`.

Pasos recomendados para meseros remotos:

1. En la laptop, ejecuta `npm run dev:server` y `npm run dev:laptop`.
2. En otra consola de la laptop, ejecuta `npm run tunnel:server`.
3. Copia la URL HTTPS que entrega el tunel.
4. En la laptop, abre la seccion Conectividad y pega esa URL en URL publica del tunel.
5. Copia la URL publica desde ese mismo panel y compartela a los meseros para configurar `EXPO_PUBLIC_API_URL`.

URLs:

- Laptop: http://localhost:5173
- API: http://localhost:4000

Para Android emulador, configura la app movil con `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000`.
En un telefono fisico, usa la IP LAN de tu PC.

Si quieres que varios meseros trabajen al mismo tiempo desde otra ubicacion dentro de la misma red, la laptop debe mantenerse encendida con el backend activo y la app movil debe apuntar a la IP LAN de esa laptop, por ejemplo `EXPO_PUBLIC_API_URL=http://192.168.1.50:4000`.
Si los meseros estan fuera de tu red local, necesitas exponer la API con VPN/tunel seguro o un servidor publico.

## Mesero sin login

La app movil pide solo el nombre del mesero, el nombre del cliente y la mesa. Ese nombre viaja en la comanda y aparece en la laptop y en el ticket de cocina para identificar quien tomo cada pedido.

## Cero configuracion en WiFi

Cuando instalas la app movil, intenta detectar automaticamente la laptop en la misma red WiFi y guarda esa conexion para los siguientes inicios. El mesero no necesita escribir IP manualmente.

Si cambias de red, la app vuelve a detectar la laptop automaticamente.

## Pantalla de conectividad en laptop

En la laptop tienes una seccion Conectividad para:

- copiar URL local
- guardar y copiar URL publica del tunel
- activar o desactivar impresion automatica al recibir pedidos

Ese boton de impresion automatica ya esta disponible en la tarjeta `Impresion automatica`.

## APK release (sin Expo Go)

La app movil ya esta configurada para sacar APK instalable directo en Android.

Inicializacion de una sola vez (obligatoria):

```bash
npm run apk:init
```

Eso vincula el proyecto con tu cuenta Expo/EAS.

1. Ejecuta:

```bash
npm run apk:release
```

2. Inicia sesion en Expo/EAS cuando lo pida.
3. Al terminar, EAS te entrega un enlace para descargar el APK release.
4. Comparte ese APK a los meseros para instalarlo sin Expo Go.

## Impresion de cocina

La impresora termica real se envía por TCP/9100 desde el backend.
Configura:

- `KITCHEN_PRINTER_HOST`
- `KITCHEN_PRINTER_PORT` opcional, por defecto `9100`

Si no se configura, la comanda igual se guarda y el backend responde `printer-not-configured`.

## Flujo implementado

1. Desde la app movil se registra cliente, mesa y platos.
2. La comanda llega en tiempo real al panel de laptop, queda pendiente y muestra el mesero que la tomo.
3. En laptop o por API se imprime ticket de cocina real (sin precios) con cliente, mesa, mesero y pedido por categorias si hay impresora configurada.
4. En pantalla de cierre se busca la cuenta y se cobra por `efectivo` o `transferencia`.
5. Se actualiza el cierre de caja y la estadistica de platos vendidos.
6. En dias anteriores se consulta por fecha.

## Hub central

La laptop funciona como centro de operacion cuando ejecutas el backend en esa misma maquina. Los moviles no hablan entre si: todos envian pedidos al backend de la laptop y la laptop es la que guarda todo en SQLite.

## Build

```bash
npm run build
```
