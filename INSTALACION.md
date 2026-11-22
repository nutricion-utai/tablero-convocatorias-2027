# Puesta en marcha del tablero de convocatorias 2027

Son tres partes: Firebase (5 minutos), la herramienta de convocatorias en Apps Script (10 minutos) y GitHub Pages (1 minuto). Hay que hacerlas **en este orden**: las reglas de Firestore deben cerrar los datos antes de publicar el primer proceso, porque hoy ese proyecto deja leer cualquier colección sin clave.

## 1. Firebase (proyecto `tablero-envios-pncm`)

Entrar a https://console.firebase.google.com con la cuenta luisenrique1901@gmail.com y abrir el proyecto **tablero-envios-pncm** (el mismo del tablero de envíos).

1. **Activar el ingreso con clave.** Menú *Compilación* → *Authentication* → *Comenzar* → pestaña *Método de acceso* → *Correo electrónico/contraseña* → activar solo la primera opción → *Guardar*.
2. **Crear el usuario lector.** Pestaña *Usuarios* → *Agregar usuario*:
   - Correo: `lector@nutricion-utai.github.io` (no recibe correos; solo identifica al lector).
   - Contraseña: **la clave del tablero**. Mínimo 6 caracteres; se sugieren 10 o más, con letras y números.
3. **Autorizar el dominio.** Pestaña *Configuración* → *Dominios autorizados* → *Agregar dominio* → `nutricion-utai.github.io`.
4. **Cambiar las reglas de Firestore.** Menú *Firestore Database* → pestaña *Reglas*:
   - Antes de borrar nada, revisa si las reglas actuales mencionan alguna colección distinta de `periodos` y `tablero`. Si la hay, avísame antes de seguir.
   - Reemplaza todo el texto por el de `firebase/firestore.rules` y pulsa *Publicar*.
   - El tablero de envíos sigue público (`periodos` y `tablero`); el de convocatorias (`conv2027`) solo se lee con la clave.

## 2. Herramienta de convocatorias (Apps Script)

Abrir el proyecto **Herramienta Convocatorias de Alimentos 2027** en https://script.google.com.

1. **Permiso para Firestore.** *Configuración del proyecto* (engranaje) → marcar *Mostrar el archivo de manifiesto “appsscript.json” en el editor*. En el editor, abrir `appsscript.json` y agregar esta línea al final de la lista `oauthScopes` (con una coma después de la línea anterior):

   ```
   "https://www.googleapis.com/auth/datastore"
   ```

   El archivo completo, ya con la línea, está en `apps-script/appsscript.json`.
2. **Archivo nuevo.** *+* → *Secuencia de comandos* → nombre `TableroConvocatorias` → pegar todo el contenido de `apps-script/TableroConvocatorias.gs` → guardar.
3. **Primera línea, en `Datos.gs`**, función `escribirProceso_`. Buscar:

   ```
       actualizarConsolidados_(proc);
       return proc;
   ```

   y dejarlo así:

   ```
       actualizarConsolidados_(proc);
       tcPublicarProceso_(proc, usuario); // tablero de convocatorias en GitHub (si falla, el guardado sigue)
       return proc;
   ```
4. **Segunda línea, en `Servidor.gs`**, función `apiEliminarProceso`. Buscar:

   ```
       registrar_(s.usuario, 'Eliminar proceso', id);
   ```

   y agregar debajo:

   ```
       tcRetirarProceso_(p, s.usuario); // tablero de convocatorias en GitHub
   ```
5. **Probar la conexión.** Elegir la función `tcProbarConexion` y pulsar *Ejecutar*. Google pedirá autorizar el permiso nuevo (Cloud Datastore): aceptar. El registro debe decir “Conexión correcta con Firestore”.
6. **Publicar todo por primera vez.** Elegir `tcInstalarTablero` y *Ejecutar*. Publica los procesos reales y crea la revisión automática de cada hora.
7. **Nueva implementación.** *Implementar* → *Administrar implementaciones* → editar (lápiz) → *Versión: nueva versión* → *Implementar*. Sin este paso, la aplicación que usan las UT/OCT no publica sus guardados.

Hasta que se ejecuta `tcInstalarTablero`, las dos líneas no hacen nada, así que se pueden agregar sin riesgo. Si Firestore no responde, el guardado de la especialista sigue normal: el error queda anotado y la revisión de cada hora lo corrige.

**En las próximas versiones de la herramienta** hay que conservar el archivo `TableroConvocatorias` y las dos líneas.

## 3. GitHub Pages

En el repositorio `nutricion-utai/tablero-convocatorias-2027`: *Settings* → *Pages* → *Source: Deploy from a branch* → rama `main`, carpeta `/ (root)` → *Save*. En uno o dos minutos queda en:

https://nutricion-utai.github.io/tablero-convocatorias-2027/

## Compartir

- Enviar la dirección y, por separado, la clave.
- También se puede enviar un enlace que ingresa solo: `https://nutricion-utai.github.io/tablero-convocatorias-2027/#clave=LA_CLAVE`. Entregar ese enlace equivale a entregar la clave.
- Cada navegador recuerda la clave hasta que se pulsa *Salir*.

## Cambiar la clave

Firebase → *Authentication* → *Usuarios* → menú del usuario `lector@nutricion-utai.github.io` → *Borrar cuenta* → *Agregar usuario* otra vez con el mismo correo y la clave nueva. Quienes tenían la clave anterior verán la pantalla de ingreso en menos de una hora.

## Si algo no funciona

- `tcDiagnosticoTablero()` muestra si la publicación está activa, cuántos procesos hay publicados, la última revisión completa y el último error.
- `tcSincronizarTodo()` vuelve a publicar todo lo que cambió.
- `tcQuitarTablero()` detiene la publicación (la herramienta sigue funcionando igual). `tcBorrarTablero()` borra lo publicado.
- Si la página dice que la clave no es correcta con la clave correcta, revisar el paso 1.1 (método de acceso activado) y el paso 1.3 (dominio autorizado).
