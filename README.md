# Slick FS

Slick FS trae la experiencia de oil.vim directamente al centro de la pantalla: un solo comando muestra un prompt para crear, renombrar o eliminar archivos y carpetas escribiendo rutas completas.

## Características

- Comando `Slick FS: Operaciones rápidas` (`slick-fs.oil`) que abre un QuickPick en el centro de la pantalla y lanza el flujo adecuado.
- Crea rutas completas con un solo InputBox; puedes escribir `public/src/a.tsx` y se crean las carpetas necesarias antes de tocar el archivo.
- Renombra y elimina rutas desde un prompt que no depende del panel Explorer ni del mouse.
- El tipo de recurso se detecta automáticamente a partir de la extensión o si la ruta termina en `/`, y se muestran mensajes relevantes cuando ya existe o no existe lo que escribiste.
- Soporte para expansión de llaves y autocompletado de rutas.

## Uso rápido

1. Abre una carpeta o workspace en VS Code.
2. Presiona `Ctrl+Shift+P` (o abre la paleta de comandos) y ejecuta `Slick FS: Operaciones rápidas`.
3. Escoge la operación (crear, renombrar, eliminar) y escribe la ruta relativa que deseas afectar (`public/src`, `public/src/a.tsx`, etc.).
4. Confirma alertas (como la eliminación) y sigue escribiendo sin salir de la paleta.
5. Si creas un archivo nuevo, se abre automáticamente para que sigas escribiendo.

## Comandos disponibles

- `slick-fs.oil`: Muestra el menú de operaciones rápidas en el centro con opciones para crear, renombrar o eliminar rutas.
- `slick-fs.createPath`: Pide la ruta que quieres crear (carpeta si no tiene extensión, archivo si lleva extensión) y genera los padres necesarios.
- `slick-fs.renamePath`: Pide la ruta existente y la nueva ruta destino antes de renombrar.
- `slick-fs.deletePath`: Pide la ruta a borrar y confirma antes de eliminar (recursivamente si es carpeta).
- `slick-fs.navigate`: Permite navegar por las carpetas y revelarlas en el Explorer.

## Instalación

1. Descarga el archivo `.vsix` desde las [Publicaciones](https://github.com/franciscorojas27/Slick-FS/releases).
2. Instala la extensión en VS Code ejecutando `Extensions: Install from VSIX...`.

## Licencia

Este proyecto está licenciado bajo la Licencia MIT. Consulta el archivo [LICENSE](LICENSE) para obtener más detalles.

## Requisitos

- Debes tener abierta una carpeta o workspace dentro de VS Code; no funciona en una ventana sin carpeta.

## Consejos

- Si quieres crear una carpeta aunque el nombre tenga punto, termina la ruta con `/` para forzar que se trate como carpeta.
- Evita `..` en las rutas; el prompt no permitirá salir del workspace por razones de seguridad.
