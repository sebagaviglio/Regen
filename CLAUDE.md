# Regen — sitio regen.ar

Sitio público de REGEN: portada (`index.html`) con formulario de contacto, invitaciones
(`invitacion.html`, `/i/<token>`) y páginas aparte que no se indexan (`pitch/`,
`inversores/`, `benchmark/`, `demo/`, `presentacionelite/`, `parches/`,
`modelosdenegocio/`, `mismosanos/`). HTML estático, sin compilación: cada página es un
solo archivo con su CSS y su JS. Vercel publica desde `main` (`vercel.json`).

## Pruebas

```
cd test
npm install
npx playwright install chromium
npm test
```

Corren en un navegador real con la red externa cortada. GitHub las corre en cada PR
(`.github/workflows/pruebas.yml`). Controlan:
- **Portada:**
  - las animaciones no recalculan el layout y se pausan fuera de pantalla;
  - la fórmula del parallax y la foto en WebP;
  - que cada texto use una fuente que se pide a Google Fonts;
  - **el formulario: aviso de privacidad, línea de urgencias y consentimiento**.
- **Inversores:** la voz para inversores.

`test/`, `.github/`, `.claude/`, `CLAUDE.md` y `REVIEW.md` no se publican (`.vercelignore`).

## Reglas de la portada

- **Formulario de contacto:** manda a `regen-form`, que exige `consent: true` y `privacy_version`. Lleva el aviso de privacidad (Ley 25.326), la línea de urgencias (107 / 911 / 0800-999-0091) y los avisos de validación en español. Si cambia el texto del aviso, cambia la versión, y se coordina con el Worker del formulario.
- **Posicionamiento:** REGEN es una plataforma de salud biológica. Sin «Córdoba» ni «longevidad» en el título, la descripción ni los datos para Google (decisión del 9/10/2026), salvo que Seba diga otra cosa.
- **Animaciones:** solo `transform` y `opacity` (nada de `top`/`left`/`width`, ni `<circle>` animados dentro de un SVG). Las que no se ven se pausan.
- **Fuentes:** pedí a Google Fonts solo las variantes que se usan. Si sumás una negrita o itálica, agregala al link, o la prueba de fuentes avisa.
- **Imágenes:** WebP con el JPEG de respaldo en `<picture>`, y tamaño acorde a la pantalla.
- Las páginas que no se indexan llevan `noindex` en la página y, si corresponde, en `vercel.json`.

## Cómo trabajamos (vale para todos los repos de REGEN)

**Idioma.** Todo en castellano rioplatense (vos): respuestas, mensajes de commit, títulos y
descripciones de PR, comentarios del código y textos de la interfaz. Nunca en inglés.

**Con Seba.** Seba es el dueño del producto y no programa a diario. Explicá en lenguaje
llano, sin jerga. Si tiene que correr algo en su compu, pasale **un comando por vez** y
esperá lo que devuelva antes de pasar el siguiente.

**`main` es producción.** Lo que entra a `main` se publica solo, así que:
- Nunca subas directo a `main`. Trabajá en una rama y abrí un PR **sin fusionar**: fusiona Seba.
- No actives la fusión automática.
- Si el PR necesita algo antes de fusionar (una migración, una variable), decilo arriba de todo en la descripción.

**Antes de tocar un archivo, partí de `origin/main` actual.** Hacé `git fetch` y trabajá
sobre lo que está publicado. Nunca reescribas un archivo entero a partir de una copia
vieja (de otro chat, del proyecto de Claude o de memoria): el 13/11/2026 eso borró sin
querer el consentimiento del formulario de regen.ar y el trabajo de octubre. Preferí
cambios puntuales, y antes de abrir el PR mirá el `git diff --stat`: si cambian muchas
más líneas de las que esperabas, frená y revisá.

**Pruebas primero.** Para cada cambio de comportamiento: escribí la prueba, comprobá que
falla con el código actual, hacé el cambio y comprobá que pasa. Si una prueba vieja fija
el comportamiento que querés cambiar a propósito, actualizala y explicalo en el PR.

**Medí antes y después.** Para rendimiento, no alcanza con «debería andar más rápido»:
medí (tamaño de lo que se descarga, tiempos, pedidos al Worker) antes y después.

**Sin cambios visuales no pedidos.** Si el cambio no es visual, demostralo: corré la
verificación (`.claude/skills/verify`) y compará contra `main`. Si es visual, mostrá
capturas.

**Revisá tu propio PR contra `REVIEW.md`** antes de abrirlo.

**Tres intentos.** Si algo sigue fallando después de tres intentos de arreglo, pará: el
enfoque está mal. Contale a Seba qué probaste y qué creés que pasa.

**Datos de salud.** Todo lo que toca pacientes es dato sensible (Ley 25.326). Nada de
datos reales en pruebas, capturas, logs ni PRs: usá datos inventados.

**Commits y PRs.** Mensaje en castellano que diga qué cambia y por qué. El PR explica en
lenguaje llano qué pasaba, qué cambia, cómo se verificó y qué queda pendiente.
