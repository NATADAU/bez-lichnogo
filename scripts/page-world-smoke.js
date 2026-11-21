/* Автопроверка через window.__BEZ__ (?testapi=1). */
(async () => {
  const out = [];
  const assert = (ok, msg) => out.push({ ok: !!ok, msg });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitReady = async () => {
    for (let i = 0; i < 150; i++) {
      if (!document.getElementById('loading').classList.contains('visible')) return;
      await sleep(50);
    }
  };
  const finish = () => {
    const payload = {
      passed: out.filter((r) => r.ok).length,
      failed: out.filter((r) => !r.ok).length,
      results: out,
      status: document.getElementById('status')?.textContent,
      pageInfo: document.getElementById('pageInfo')?.textContent,
      resources: performance.getEntriesByType('resource').map((r) => r.name)
    };
    let box = document.getElementById('__smoke_result');
    if (!box) {
      box = document.createElement('pre');
      box.id = '__smoke_result';
      box.style.display = 'none';
      document.documentElement.appendChild(box);
    }
    box.textContent = JSON.stringify(payload);
  };

  try {
    const api = window.__BEZ__;
    assert(!!api, 'тестовый API __BEZ__ доступен');
    if (!api) return finish();

    try {
      await fetch(location.origin + '/app.js');
      assert(false, 'fetch должен быть запрещён CSP');
    } catch (e) {
      assert(true, 'CSP блокирует fetch');
    }

    const blur = document.getElementById('blur');
    assert(blur.min === '2', 'blur min=2');
    blur.value = '0';
    blur.dispatchEvent(new Event('input', { bubbles: true }));
    assert(api.getBlur() >= 2, 'blur 0 отклонён -> ' + api.getBlur());

    api.demo();
    await sleep(80);
    api.setColor('#112233');
    api.setMode('solid');
    await sleep(40);
    assert(api.getMode() === 'solid', 'режим solid');
    assert(document.getElementById('solidMode').classList.contains('active'), 'кнопка solid active');

    const c = api.displayCanvas();
    const ctx = c.getContext('2d');
    const pix = ctx.getImageData(210, 480, 1, 1).data;
    assert(
      pix[0] === 0x11 && pix[1] === 0x22 && pix[2] === 0x33,
      'solid поверх frost RGB(' + pix[0] + ',' + pix[1] + ',' + pix[2] + ')'
    );
    const right = Math.ceil((0.096 + 0.235) * c.width);
    const edge = ctx.getImageData(right - 1, 480, 1, 1).data;
    assert(
      edge[0] === 0x11 && edge[1] === 0x22 && edge[2] === 0x33,
      'край плашки RGB(' + edge[0] + ',' + edge[1] + ',' + edge[2] + ')'
    );

    // Перекрытие: frost снизу, solid сверху на той же области
    api.setRegions({
      1: [
        { x: 0.1, y: 0.1, w: 0.3, h: 0.3, type: 'frost', color: '#ffffff' },
        { x: 0.15, y: 0.15, w: 0.15, h: 0.15, type: 'solid', color: '#aabbcc' }
      ]
    });
    await sleep(30);
    const over = ctx.getImageData(Math.floor(0.2 * c.width), Math.floor(0.2 * c.height), 1, 1).data;
    assert(
      over[0] === 0xaa && over[1] === 0xbb && over[2] === 0xcc,
      'перекрытие solid поверх frost RGB(' + over[0] + ',' + over[1] + ',' + over[2] + ')'
    );

    const b64 = document.getElementById('__smoke_b64')?.textContent.trim() || '';
    assert(!!b64, 'есть base64 тестового PDF');
    if (!b64) return finish();

    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const file = new File([bin], 'sample-2pages.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('upload');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    let opened = false;
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      await waitReady();
      if (api.getPages() === 2 && api.getPdfLoaded()) {
        opened = true;
        break;
      }
      const st = document.getElementById('status').textContent;
      if (st.includes('Не удалось') || st.includes('Ошибка')) {
        assert(false, 'открытие PDF: ' + st);
        break;
      }
    }
    assert(opened, 'PDF открыт pages=' + api.getPages() + ' loaded=' + api.getPdfLoaded());

    const res = performance.getEntriesByType('resource').map((r) => r.name);
    assert(res.some((n) => n.includes('/vendor/pdf.min.mjs')), 'pdf.min.mjs');
    assert(res.some((n) => n.includes('/vendor/pdf.worker.min.mjs')), 'pdf.worker.min.mjs');
    assert(
      res.every((n) => n.startsWith(location.origin) || n.startsWith('blob:')),
      'нет внешних URL'
    );

    await api.showPage(2);
    await waitReady();
    assert(api.getPage() === 2, 'страница 2, сейчас ' + api.getPage());
    await api.showPage(1);
    await waitReady();
    assert(api.getPage() === 1, 'страница 1, сейчас ' + api.getPage());

    api.setMode('solid');
    api.setRegions({
      1: [{ x: 0.05, y: 0.05, w: 0.4, h: 0.2, type: 'solid', color: '#112233' }],
      2: [{ x: 0.05, y: 0.05, w: 0.4, h: 0.2, type: 'solid', color: '#112233' }]
    });

    let saved = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob && blob.type === 'application/pdf') saved = blob;
      return orig(blob);
    };
    const realConfirm = window.confirm;
    window.confirm = () => true;
    await api.save();
    window.confirm = realConfirm;
    for (let i = 0; i < 50 && !saved; i++) await sleep(50);
    URL.createObjectURL = orig;

    assert(!!saved, 'экспорт blob: ' + document.getElementById('status').textContent);
    if (saved) {
      const head = String.fromCharCode(...new Uint8Array(await saved.slice(0, 5).arrayBuffer()));
      assert(head === '%PDF-', 'сигнатура ' + head);
      assert(saved.size > 500, 'размер ' + saved.size);
    }
  } catch (e) {
    out.push({ ok: false, msg: 'исключение: ' + (e && e.stack ? e.stack : String(e)) });
  }
  finish();
})();
