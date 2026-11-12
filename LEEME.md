# Mis Finanzas

App de finanzas personales para el móvil. Funciona sin internet, no tiene cuenta ni servidor,
y guarda todo cifrado (AES-256) solo en tu dispositivo.

## Carpetas y archivos

```
mis-finanzas/
├── index.html              La página (pantalla de bloqueo y estructura)
├── styles.css              Colores y diseño (tema claro y oscuro)
├── manifest.webmanifest    Nombre e icono al instalarla en el móvil
├── sw.js                   Hace que funcione sin internet
├── icons/                  Iconos de la app
├── js/
│   ├── app.js              Arranque, bloqueo, guardado, copias de seguridad
│   ├── version.js          Número de versión
│   ├── crypto.js           Cifrado
│   ├── bio.js              Desbloqueo con Face ID
│   ├── storage.js          Guardado en el móvil (IndexedDB)
│   ├── model.js            Cálculos: saldos, recurrentes, CSV
│   ├── views.js            Todas las pantallas
│   ├── forms.js            Formularios, avisos y diálogos
│   ├── charts.js           Gráficos
│   └── util.js             Utilidades (fechas, dinero)
└── pruebas/pruebas.mjs     Pruebas de los cálculos (no es parte de la app)
```

## Cómo ponerla en tu iPhone

Un iPhone solo instala una app web si se abre desde una dirección `https://`.
Por eso hay que subir los ARCHIVOS DE LA APP (no tus datos) a un alojamiento gratuito.
Tus datos nunca salen del móvil.

1. Crea una cuenta gratis en https://github.com
2. Arriba a la derecha: **+** → **New repository**. Nombre: `mis-finanzas`. Marca **Public**. Pulsa **Create repository**.
3. En la página que aparece, pulsa **uploading an existing file**.
4. Arrastra dentro TODO el contenido de la carpeta `mis-finanzas` (los archivos y las carpetas `js`, `icons`, no la carpeta en sí). Pulsa **Commit changes**.
5. Ve a **Settings** → **Pages**. En "Branch" elige **main** y **/(root)**. Pulsa **Save**.
6. Espera 1-2 minutos. Tu app estará en `https://TU-USUARIO.github.io/mis-finanzas/`
7. En el iPhone abre esa dirección con **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
8. Abre la app desde el icono y crea tu contraseña.

Importante: crea la contraseña y usa la app SIEMPRE desde el icono de la pantalla de inicio.
Safari y el icono guardan los datos por separado.

## Probarla en el ordenador

Con Python instalado, abre una terminal dentro de la carpeta y ejecuta:

```bash
python3 -m http.server 8000
```

Luego abre http://localhost:8000 en el navegador.

## Si cambias el código

Sube el número de versión en DOS sitios (deben coincidir):

- `js/version.js`: `VERSION = '1.4'` → `'1.5'`
- `sw.js`: `mis-finanzas-v1.4` → `mis-finanzas-v1.5`

Si no lo haces, el móvil seguirá usando la versión antigua guardada.
La versión que está abierta se ve abajo en la pantalla de bloqueo y al final de Inicio.

## Face ID

Se activa en Más → Ajustes y seguridad → Activar Face ID (hace falta iOS 18 o posterior).
El iPhone guarda una "llave de acceso" en la app Contraseñas; si la borras de ahí, Face ID
dejará de funcionar y tendrás que entrar con la contraseña y volver a activarlo.
La contraseña sigue siendo necesaria como respaldo: no la olvides.

## Seguridad: lo que debes saber

- Con Face ID activado, quien pueda desbloquear tu móvil (cara o código) puede abrir la app.

- Si olvidas la contraseña, los datos NO se pueden recuperar.
- Haz copias de seguridad (Más → Copias de seguridad) y guárdalas fuera del móvil.
- El archivo CSV exportado NO va cifrado. La copia de seguridad sí.
- Si borras los datos de Safari o eliminas el icono, se pueden borrar los datos de la app.
