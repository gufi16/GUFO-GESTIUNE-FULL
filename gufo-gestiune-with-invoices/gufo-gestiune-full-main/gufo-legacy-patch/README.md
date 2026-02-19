# GUFO Legacy UI Patch

Acest patch iti adauga pagina **/legacy** care incarca vechiul `index.html` intr-un iframe,
plus fisierul static la **/legacy/index.html**.

## Ce contine
- `public/legacy/index.html` (copie din index (46).html)
- `app/legacy/page.tsx` (ruta Next.js App Router: `/legacy`)

## Cum il aplici in repo (fara sa strici nimic)
1) In GitHub -> repo -> **Add file** -> **Upload files**
2) Urca folderele EXACT ca in zip:
   - `public/legacy/index.html`
   - `app/legacy/page.tsx`
3) Commit.

## Cum verifici
- Deschizi: `/legacy` (ex: https://<app>.onrender.com/legacy)
- Sau direct: `/legacy/index.html`

## Optional
- In meniul din layout-ul tau (sidebar), adauga un link catre `/legacy` ca sa ajungi rapid la modulele vechi.
