# Convocatorias de alimentos 2027 · PNCM

Tablero en línea del avance de los procesos de adquisición de alimentos 2027 de las UT/OCT del Programa Nacional Cuna Más. Muestra lo que registran las especialistas en nutrición en la herramienta web de convocatorias (Apps Script) y se actualiza solo, al instante, cada vez que alguien guarda un proceso.

Dirección: https://nutricion-utai.github.io/tablero-convocatorias-2027/

Los datos solo cargan con la clave de acceso que entrega la UTAI. El código de esta página es público; los datos no están en este repositorio, sino en Firestore, protegidos por las reglas de `firebase/firestore.rules`.

## Pestañas

- **Resumen**: cifras generales, paso del registro en que está cada proceso, acto del cronograma que se realiza hoy, alertas de convocatoria pública sin invitación previa a la agricultura familiar y avance por UT/OCT con su sectorista.
- **Procesos**: lista con estado a la fecha, avance de los 12 pasos del numeral 7 de la Directiva, acto del cronograma, ámbito y resultado. Se descarga en CSV. Cada fila abre el detalle del proceso (pasos, cronograma, postores, resultados y precios).
- **Cronograma**: agenda de los próximos 7, 14 o 30 días y diagrama de los cronogramas (Anexo 3) con la fecha de hoy.
- **Resultados y precios**: paquetes adjudicados y desiertos, proporción de alimentos adjudicados por invitación directa AF por UT/OCT, precios adjudicados por alimento (mínimo, mediana y máximo) y resultados por paquete.
- **Actividad**: últimos registros hechos en la herramienta.

Los filtros (sectorista, UT/OCT, modalidad y búsqueda) se aplican a todas las pestañas y se recuerdan en el navegador.

## Archivos

- `index.html`: estructura y estilos.
- `logica.js`: reglas sin pantalla (estado a la fecha, acto vigente, alertas AF, agenda, precios). Son las mismas de la herramienta 2.0.36 (`Calc.estadoPorFechas` y `Calc.alertasAgriculturaFamiliar`).
- `app.js`: la pantalla.
- `boot.mjs`: ingreso con la clave (Firebase Authentication) y lectura en vivo de Firestore.
- `apps-script/TableroConvocatorias.gs`: archivo que se agrega a la herramienta de convocatorias para publicar en Firestore.
- `firebase/firestore.rules`: reglas de Firestore del proyecto `tablero-envios-pncm`.
- `INSTALACION.md`: pasos para ponerlo en marcha, compartirlo y cambiar la clave.

## Datos en Firestore (proyecto `tablero-envios-pncm`)

| Documento | Contenido |
|---|---|
| `conv2027/meta` | UT/OCT, sectorista de cada una, feriados y versión de la herramienta |
| `conv2027/vivo` | últimos 40 registros (aviso en vivo) |
| `conv2027/estado` | hora de la última revisión completa |
| `conv2027/datos/procesos/{id}` | un documento por proceso real |
| `conv2027/datos/precios/{id}` | precios adjudicados del proceso |

No se publican los procesos de prueba, las claves, los correos de los usuarios ni los RUC de personas naturales (los que empiezan con 10).
