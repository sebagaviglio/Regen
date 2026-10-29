# Pruebas de la web

Prueban la portada (`index.html`) y la invitación en un navegador real. No son parte del
sitio: `.vercelignore` las deja afuera del deploy.

```
cd test
npm install
npx playwright install chromium
npm test
```

Qué cuidan:
- Las animaciones del hero no recalculan el layout de la página en cada cuadro, y se pausan
  cuando el hero sale de pantalla.
- El parallax de la foto sigue la misma fórmula (±45px) y solo trabaja con la foto a la vista.
- En el celular baja la foto en WebP de 1200px; el JPEG original queda para quien no tenga WebP.
- Todo texto (también el menú abierto y los mensajes del formulario) usa una variante de
  fuente que la página pide a Google Fonts. Si sumás una negrita o itálica nueva, agregala al
  link de Google Fonts o esta prueba avisa.
