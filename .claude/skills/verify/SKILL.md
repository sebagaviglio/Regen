---
name: verify
description: Verificar un cambio en regen.ar (portada, invitación, pitch, inversores, benchmark) antes de abrir o actualizar un PR. Corre las pruebas en un navegador real y compara cada página contra main píxel a píxel con las animaciones congeladas. Usar siempre antes de decir que un cambio «no cambia nada visual» o que «funciona».
---

# Verificar un cambio en regen.ar

No digas que un cambio funciona ni que no cambia lo visual sin haber hecho estos pasos.
En el PR, pegá la tabla del paso 2.

## 1. Pruebas

```
cd test && npm install && npx playwright install chromium && npm test && cd ..
```

Si ya están instaladas, alcanza con `cd test && npm test`.

## 2. Comparación visual contra main

```
git fetch origin main
python3 .claude/skills/verify/verify.py
```

El script sirve el sitio tal como está y como está en `origin/main`. Abre las páginas de
`verify.json` (portada, invitación, pitch, inversores, benchmark) en celular (390 px) y
escritorio (1440 px), con la red externa cortada y el reloj detenido. Recorre la página
para que aparezca todo, congela las animaciones (CSS, SMIL y video) y compara.

- `idéntica`: no cambió nada.
- `difiere en …`: mirá `diff-*.png` y la captura de `cambio/`, y explicá cada diferencia.
- `cambió el alto`: se agregó o se sacó contenido. Si no lo esperabas, revisá el `git diff --stat`: puede ser que el archivo se haya reescrito a partir de una copia vieja.

Opciones: `--base`, `--solo` y `--out`, igual que en las apps.

## 3. Mirar lo que tocaste

Abrí la captura de `cambio/` de la página que tocaste y miralo vos. Las fuentes de Google
no cargan en esta verificación (la red está cortada): de eso se encarga la prueba de
fuentes de `test/home.test.mjs`.

## Si sumás una página

Agregala a `screens` en `verify.json` y corré `--base HEAD` una vez: todo tiene que dar
`idéntica`. Las presentaciones pesadas (`demo`, `mismosanos`, `presentacionelite`) están
afuera a propósito; sumalas solo si las tocás.
