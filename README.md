# Без личного

Браузерное приложение для скрытия фрагментов в сканированных PDF и изображениях.  
Обработка выполняется **локально в браузере**.

- **Приложение:** https://natadau.github.io/bez-lichnogo/
- **Репозиторий:** https://github.com/NATADAU/bez-lichnogo
- **Паспорт проекта** (контекст, архитектура, безопасность, правила разработки): [PROJECT_PASSPORT.md](./PROJECT_PASSPORT.md)

PDF.js **6.5.438** подключается локально из `vendor/` (ES-модули `.mjs`). На GitHub Pages библиотека попадает в сайт при сборке Actions.

## Публикация (GitHub Pages)

1. Source в настройках Pages: **GitHub Actions**.
2. После push в `main` проверить вкладку **Actions**.
3. Перед работой с чувствительными данными — проверка на опубликованном адресе (ниже).

GitHub Actions устанавливает `pdfjs-dist@6.5.438`, копирует `index.html`, `app.js` и файлы PDF.js в артефакт сайта. Посетители получают библиотеку **с того же GitHub Pages**, не с CDN.

## Локальная подготовка

Только внутри папки проекта:

```bash
npm install --no-save --ignore-scripts --no-audit --no-fund pdfjs-dist@6.5.438
mkdir vendor
copy node_modules\pdfjs-dist\build\pdf.min.mjs vendor\pdf.min.mjs
copy node_modules\pdfjs-dist\build\pdf.worker.min.mjs vendor\pdf.worker.min.mjs
```

Или: `powershell -ExecutionPolicy Bypass -File .\scripts\prepare-vendor.ps1`

Открывать через локальный веб-сервер (не `file://`):

```bash
python -m http.server 4173
```

## Важно о безопасности

- **Frost не подходит для надёжного обезличивания.** Для секретных сведений — только непрозрачные цветные плашки и проверка всего документа.
- PDF.js **6.5.438**; XFA отключён (`enableXfa: false`). В PDF.js 5+/6 eval в движке отключён.
- В `index.html` задана **Content-Security-Policy** (`connect-src 'none'` и др.). Это усиливает защиту, но не заменяет осторожность.
- В репозиторий — только код, **без PDF с персональными данными**.

Подробности: [PROJECT_PASSPORT.md](./PROJECT_PASSPORT.md).

## Проверки перед использованием

- Chrome/Edge: `F12` → **Network** → открыть тестовый PDF и сохранить; нет запросов к чужим доменам.
- `vendor/pdf.min.mjs` и `vendor/pdf.worker.min.mjs` грузятся с того же сайта.
- Проверить 1 и несколько страниц, копирование областей, экспорт, края цветных плашек.
- Лимиты: один PDF — до 10 страниц и не более 25 МБ.

Локальные автопроверки (вымышленные данные): `node scripts/check-region-math.mjs`; при необходимости — `?testapi=1` и `scripts/bootstrap-smoke.js` (в артефакт Pages не входят).
