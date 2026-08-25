/* Corbanu market search: shared type-ahead over the Market Lens universe. */
(function () {
  "use strict";

  function normalize(universe) {
    const rows = Array.isArray(universe.instruments) ? universe.instruments : [];
    return rows.map((item) => ({
      slug: String(item.slug || ""),
      symbol: String(item.symbol || ""),
      name: String(item.name || ""),
      category: String(item.category || ""),
    }));
  }

  function wire(rows) {
    const wrap = document.querySelector(".market-search");
    const input = document.getElementById("market-search-input");
    const list = document.getElementById("market-search-results");
    if (!wrap || !input || !list || input.dataset.searchWired) return;
    input.dataset.searchWired = "1";
    let matches = [];
    let active = -1;

    function close() {
      list.hidden = true;
      list.replaceChildren();
      wrap.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      matches = [];
      active = -1;
    }

    function go(item) {
      if (item && item.slug) window.location.href = `/${item.slug}/`;
    }

    function rank(item, query) {
      const symbol = item.symbol.toLowerCase();
      const name = item.name.toLowerCase();
      if (symbol.startsWith(query)) return 0;
      if (name.startsWith(query)) return 1;
      if (symbol.includes(query)) return 2;
      if (name.includes(query)) return 3;
      return -1;
    }

    function highlight(index) {
      active = index;
      Array.from(list.children).forEach((child, childIndex) => {
        if (child.getAttribute("role") !== "option") return;
        const selected = childIndex === active;
        child.setAttribute("aria-selected", selected ? "true" : "false");
        if (selected) {
          input.setAttribute("aria-activedescendant", child.id);
          child.scrollIntoView({ block: "nearest" });
        }
      });
      if (active < 0) input.removeAttribute("aria-activedescendant");
    }

    function render(query) {
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) {
        close();
        return;
      }
      matches = rows
        .map((item) => ({ item, score: rank(item, trimmed) }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => left.score - right.score || left.item.symbol.localeCompare(right.item.symbol))
        .slice(0, 8)
        .map((entry) => entry.item);
      list.replaceChildren();
      if (!matches.length) {
        const empty = document.createElement("li");
        empty.className = "market-search-empty";
        empty.textContent = "No matching markets";
        list.appendChild(empty);
      }
      matches.forEach((item, index) => {
        const row = document.createElement("li");
        row.id = `market-search-option-${index}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", "false");
        const symbol = document.createElement("strong");
        symbol.textContent = item.symbol;
        const name = document.createElement("span");
        name.textContent = item.name;
        const category = document.createElement("small");
        category.textContent = item.category;
        row.append(symbol, name, category);
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          go(item);
        });
        list.appendChild(row);
      });
      list.hidden = false;
      wrap.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      highlight(matches.length ? 0 : -1);
    }

    input.addEventListener("input", () => render(input.value));
    input.addEventListener("focus", () => {
      if (input.value.trim()) render(input.value);
    });
    input.addEventListener("blur", () => window.setTimeout(close, 120));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        input.blur();
        return;
      }
      if (!matches.length) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        highlight((active + 1) % matches.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlight((active - 1 + matches.length) % matches.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        go(matches[active >= 0 ? active : 0]);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable)) return;
      event.preventDefault();
      input.focus();
      input.select();
    });
  }

  async function autoInit() {
    const wrap = document.querySelector(".market-search[data-autofetch]");
    if (!wrap) return;
    try {
      const response = await fetch("/assets/market-data/universe.json", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      wire(normalize(await response.json()));
    } catch (error) {
      /* search stays inert if the universe cannot load */
    }
  }

  window.CorbanuMarketSearch = { wire, normalize };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})();
