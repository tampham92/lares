// Copy buttons for install commands. External file on purpose: the CSP in site/_headers blocks inline scripts.
for (const btn of document.querySelectorAll('[data-copy]')) {
  const label = btn.querySelector('.label');
  const idle = label ? label.textContent : '';
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy)?.textContent.trim() ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers / insecure contexts: select the text so Ctrl+C works.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(btn.dataset.copy));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    btn.classList.add('done');
    if (label) label.textContent = btn.dataset.done || idle;
    setTimeout(() => {
      btn.classList.remove('done');
      if (label) label.textContent = idle;
    }, 2000);
  });
}
