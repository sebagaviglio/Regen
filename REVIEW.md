# Cómo revisar un PR en Regen (regen.ar)

## Qué es «Importante» acá
Algo que rompa el formulario de contacto o le saque el consentimiento, el aviso de
privacidad o la línea de urgencias; que vuelva atrás contenido publicado sin que el PR lo
diga; o que haga más pesada o más lenta la portada. Estilo y nombres son, como mucho,
detalle.

## Revisar siempre
- **Alcance del cambio:** el `diff --stat` es coherente con lo que dice el PR. Si un cambio chico reescribe cientos de líneas, se revisa si partió de una copia vieja (pasó el 13/11/2026).
- **Formulario:** sigue mandando `consent` y `privacy_version`, y muestra el aviso (Ley 25.326) y la línea de urgencias. La prueba del formulario sigue pasando.
- **Contenido visible:** se verifica contra `main` (`.claude/skills/verify`), y cada diferencia se explica.
- **Posicionamiento:** sin «Córdoba» ni «longevidad» en el título, la descripción ni los datos para Google, salvo que el PR diga que es a propósito.
- **Rendimiento:** las animaciones nuevas usan solo `transform` y `opacity`; las imágenes nuevas, WebP con respaldo; las fuentes, solo las variantes usadas.
- **Páginas privadas:** las páginas para inversores o para presentar llevan `noindex`.

## Para no hacer ruido
- Como mucho, cinco comentarios de detalle.
- No revisar los audios, videos ni imágenes embebidos en base64 de las presentaciones.
- Cada afirmación sobre el comportamiento lleva archivo y línea.
