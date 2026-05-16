# CocinaNative

App nativa de cocina para Barril, hecha con React Native CLI y TypeScript.

## Qué hace
- Conecta con la laptop por URL configurable.
- Sincroniza comandas por `socket.io`.
- Muestra pedidos pendientes y en preparación.
- Permite iniciar preparación y marcar completado.
- Guarda la URL y el estado de sonido en el dispositivo.

## Requisitos
- Node.js 18+
- Android Studio + Android SDK
- Un dispositivo Android o emulador

## Arranque

```sh
npm install
npm start
```

En otra terminal:

```sh
npm run android
```

## Configuración de servidor

Al abrir la app, ingresa la URL de la laptop, por ejemplo:

```text
http://192.168.1.42:4000
```

## Verificación rápida

Ya validé estos pasos en el proyecto:

```sh
npx tsc --noEmit
npm run lint
```

## Pendiente
- Sustituir la vibración por audio nativo si hace falta.
