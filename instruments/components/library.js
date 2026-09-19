import { listInstruments, listCategories } from "../core/registry.js";

const RECENT_KEY = "deeley_instruments_recent";

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

export function markInstrumentUsed(id) {
  try {
    const recent = loadRecent();
    recent[id] = Date.now();
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch (e) {}
}

// A search/filter/sort browser over the instrument registry. Used both as
// the "Add instrument" picker inside the workspace and as the standalone
// library page - the caller decides what a card's primary action does
// (onPick for the picker, hrefFor to render a real link for the directory
// page) so this component only ever deals with listing instruments, never
// with what happens after one is chosen.
export function createLibraryView(options = {}) {
  const { onPick, hrefFor, actionLabel = "Add" } = options;

  const el = document.createElement("div");
  el.className = "im-library";

  const controls = document.createElement("div");
  controls.className = "im-library-controls";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search instruments…";
  searchInput.className = "im-library-search";
  controls.appendChild(searchInput);

  const categorySelect = document.createElement("select");
  categorySelect.className = "im-library-select";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All categories";
  categorySelect.appendChild(allOption);
  for (const cat of listCategories()) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  }
  controls.appendChild(categorySelect);

  const sortSelect = document.createElement("select");
  sortSelect.className = "im-library-select";
  [
    ["name", "Name"],
    ["category", "Category"],
    ["recent", "Recently used"],
  ].forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = "Sort: " + label;
    sortSelect.appendChild(opt);
  });
  controls.appendChild(sortSelect);

  el.appendChild(controls);

  const grid = document.createElement("div");
  grid.className = "im-library-grid";
  el.appendChild(grid);

  const emptyState = document.createElement("div");
  emptyState.className = "im-library-empty";
  emptyState.textContent = "No instruments match your search.";
  emptyState.style.display = "none";
  el.appendChild(emptyState);

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const category = categorySelect.value;
    const sortBy = sortSelect.value;
    const recent = loadRecent();

    let items = listInstruments().filter((m) => {
      if (category && m.category !== category) return false;
      if (!query) return true;
      const haystack = [m.name, m.shortName, m.description, m.category, ...(m.tags || [])].join(" ").toLowerCase();
      return haystack.includes(query);
    });

    if (sortBy === "name") {
      items.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "category") {
      items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    } else if (sortBy === "recent") {
      items.sort((a, b) => (recent[b.id] || 0) - (recent[a.id] || 0));
    }

    grid.innerHTML = "";
    emptyState.style.display = items.length ? "none" : "block";

    for (const manifest of items) {
      const card = document.createElement(hrefFor ? "a" : "div");
      card.className = "im-library-card";
      if (hrefFor) card.href = hrefFor(manifest);

      const icon = document.createElement("div");
      icon.className = "im-library-card-icon";
      icon.textContent = manifest.icon || "\u{1F3B9}";
      card.appendChild(icon);

      const name = document.createElement("div");
      name.className = "im-library-card-name";
      name.textContent = manifest.name;
      card.appendChild(name);

      const category2 = document.createElement("div");
      category2.className = "im-library-card-category";
      category2.textContent = manifest.category;
      card.appendChild(category2);

      const desc = document.createElement("div");
      desc.className = "im-library-card-desc";
      desc.textContent = manifest.description || "";
      card.appendChild(desc);

      if (onPick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "im-btn im-library-card-action";
        btn.textContent = actionLabel;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          markInstrumentUsed(manifest.id);
          onPick(manifest);
        });
        card.appendChild(btn);
        card.addEventListener("click", () => {
          markInstrumentUsed(manifest.id);
          onPick(manifest);
        });
      } else if (hrefFor) {
        card.addEventListener("click", () => markInstrumentUsed(manifest.id));
      }

      grid.appendChild(card);
    }
  }

  searchInput.addEventListener("input", render);
  categorySelect.addEventListener("change", render);
  sortSelect.addEventListener("change", render);

  render();

  return { el, refresh: render };
}
