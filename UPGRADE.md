Procedimiento de actualización sin pérdida de datos

Resumen

- La base de datos principal es `apps/server/data/barril.sqlite` y debe conservarse durante actualizaciones.
- Se generan backups periódicos en `apps/server/data/backups/`.

Pasos recomendados para actualizar la aplicación en la laptop (cajero)

1. Desde la UI de la laptop, ir a la sección lateral y pulsar `Exportar datos` para descargar un archivo JSON de respaldo.
2. Opcional: copiar manualmente `apps/server/data/barril.sqlite` a un lugar seguro.
3. Detener la aplicación (cerrar la app o servicio `node` si se usa como servicio).
4. Actualizar los archivos de la aplicación (reemplazar carpetas `apps/laptop`, `apps/server`, etc.).
5. Restaurar la base de datos:
   - Si se quiere conservar la base existente, no hacer nada (la app seguirá usando `barril.sqlite`).
   - Si se desea reemplazar por el backup JSON: en la UI de la laptop usar `Restaurar` y seleccionar el JSON exportado.
   - Si se dispone de `barril.sqlite` completo, copiarlo a `apps/server/data/barril.sqlite`.
6. Iniciar la aplicación y verificar que los pedidos, pagos y configuraciones están presentes.

Automatización

- El servidor crea copias periódicas de la DB en `apps/server/data/backups/` cada 15 minutos y al inicio.
- Antes de aplicar cambios destructivos (limpieza o restore), la UI pedirá confirmación y sugerirá exportar backup.

Notas operativas

- Mantener la carpeta `apps/server/data/` en el mismo disco para evitar problemas de rutas.
- Para migraciones de esquema importantes, crear un script de migración que transforme datos en el servidor y probar en un entorno de staging.

Restauración avanzada

- El endpoint `/api/restore/json` acepta el JSON generado por `/api/backup/json`.
- Para restaurar un `barril.sqlite` completo, simplemente reemplazar el archivo y reiniciar la app.

Mantenimiento

- Desde la UI se puede ejecutar VACUUM para compactar la DB y una limpieza selectiva por fecha.
- Siempre exportar un backup antes de realizar limpieza masiva.
