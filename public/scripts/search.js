// @ts-check
// Native on-demand import: Pagefind is generated after the Astro build.

  /** @typedef {{url:string, excerpt:string, meta:{title?:string}}} ResultData */
  /** @typedef {{search:(q:string)=>Promise<{results:{data:()=>Promise<ResultData>}[]}>}} Pagefind */
  const panel = /** @type {HTMLElement} */ (document.querySelector('#search'));
  const input = /** @type {HTMLInputElement} */ (document.querySelector('#fulltext-search'));
  const clear = /** @type {HTMLButtonElement} */ (document.querySelector('#search-clear'));
  const state = /** @type {HTMLElement} */ (document.querySelector('#search-state'));
  const results = /** @type {HTMLElement} */ (document.querySelector('#search-results'));
  /** @type {Promise<Pagefind>|undefined} */
  let engine;
  let sequence = 0;
  /** @type {ReturnType<typeof setTimeout>} */
  let timer;
  async function search() {
    const current = ++sequence;
    const query = input.value.trim();
    clear.hidden = !query;
    results.replaceChildren();
    if (!query) { state.textContent = '输入关键词，检索文章与实验记录。'; return; }
    state.textContent = '正在搜索…';
    try {
      engine ||= import(/** @type {string} */ (panel.dataset.bundle));
      const pagefind = await engine;
      const found = await pagefind.search(query);
      const pages = await Promise.all(found.results.slice(0,12).map(r => r.data()));
      if (current !== sequence) return;
      state.textContent = found.results.length ? `找到 ${found.results.length} 条结果` : '没有找到匹配内容。试试更短的关键词。';
      for (const page of pages) {
        const item = document.createElement('article');
        const heading = document.createElement('h3');
        const link = document.createElement('a');
        const excerpt = document.createElement('p');
        link.href = page.url; link.textContent = page.meta.title || '查看结果';
        const parsed = new DOMParser().parseFromString(page.excerpt, 'text/html');
        excerpt.textContent = parsed.body.textContent;
        heading.append(link); item.append(heading, excerpt); results.append(item);
      }
    } catch {
      if (current === sequence) state.textContent = '搜索索引暂时无法加载。请重试，或使用下方文章列表。';
      engine = undefined;
    }
  }
  input.addEventListener('input',()=>{ sequence++; clearTimeout(timer); timer=setTimeout(search,180); });
  clear.addEventListener('click',()=>{clearTimeout(timer);input.value='';void search();input.focus();});
