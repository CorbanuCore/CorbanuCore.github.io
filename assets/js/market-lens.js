(function () {
  "use strict";

  const page = document.body;
  const slug = page.dataset.marketSlug;
  const state = { data: null, range: "MAX", rows: [], focusIndex: -1 };
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null ? "—" : String(value);
  }

  function number(value, digits) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(digits == null ? 2 : digits) : "—";
  }

  function percent(value, digits) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "—";
    return `${parsed >= 0 ? "+" : ""}${parsed.toFixed(digits == null ? 2 : digits)}%`;
  }

  function signed(node, value) {
    if (!node) return;
    node.classList.remove("positive", "negative");
    const parsed = Number(value);
    if (Number.isFinite(parsed)) node.classList.add(parsed >= 0 ? "positive" : "negative");
  }

  function dateLabel(value, long) {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-US", long
      ? { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
      : { year: "2-digit", month: "short", day: "numeric", timeZone: "UTC" }
    ).format(date);
  }

  async function json(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function populateUniverse(universe) {
    const picker = $("instrument-select");
    if (!picker) return;
    picker.innerHTML = universe.instruments.map((item) => (
      `<option value="${item.slug}"${item.slug === slug ? " selected" : ""}>${item.symbol}</option>`
    )).join("");
    picker.addEventListener("change", () => {
      window.location.href = `/${picker.value}/`;
    });
  }

  function updateCopy(data) {
    document.title = `${data.symbol} Spot and Swap Total Return — Corbanu`;
    text("market-symbol", data.symbol);
    text("market-name", data.name);
    text("generated-at", String(data.generatedAt || "").replace("T", " ").slice(0, 19) + " UTC");
    text("spot-start", dateLabel(data.spotStart, true));
    text("perp-start", dateLabel(data.perpStart, true));
    text("anchor-date", dateLabel(data.anchorDate, true));
    text("exact-start", dateLabel(data.exactStart, true));

    const summary = data.summary || {};
    text("latest-basis", percent(summary.totalReturnSpreadPct));
    text("spot-return", percent(summary.spotReturnSinceAnchorPct));
    text("perp-return", percent(summary.perpReturnSinceAnchorPct));
    text("latest-funding", percent(summary.latestFundingPct, 3));
    signed($("latest-basis"), summary.totalReturnSpreadPct);
    signed($("spot-return"), summary.spotReturnSinceAnchorPct);
    signed($("perp-return"), summary.perpReturnSinceAnchorPct);
    signed($("latest-funding"), -Number(summary.latestFundingPct));
  }

  function cutoffForRange(data) {
    if (state.range === "MAX") return new Date(`${data.spotStart}T00:00:00Z`);
    const last = new Date(`${data.endDate}T00:00:00Z`);
    if (state.range === "YTD") return new Date(Date.UTC(last.getUTCFullYear(), 0, 1));
    const months = state.range === "3M" ? 3 : 6;
    last.setUTCMonth(last.getUTCMonth() - months);
    return last;
  }

  function visibleRows(data) {
    const cutoff = cutoffForRange(data).getTime();
    return data.spot.filter((row) => new Date(`${row.d}T00:00:00Z`).getTime() >= cutoff);
  }

  function svgNode(name, attributes) {
    const node = document.createElementNS(NS, name);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function renderChart() {
    const data = state.data;
    const stage = $("market-chart-stage");
    if (!data || !stage) return;
    const spotRows = visibleRows(data);
    const spotDates = new Set(spotRows.map((row) => row.d));
    const perpRows = data.perp.filter((row) => spotDates.has(row.d));
    state.rows = spotRows;
    state.focusIndex = spotRows.length - 1;

    if (!spotRows.length) {
      stage.innerHTML = '<div class="chart-error">No observations in this window.</div>';
      return;
    }

    const width = 1280;
    const height = 590;
    const margin = { top: 40, right: 76, bottom: 50, left: 72 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const startMs = new Date(`${spotRows[0].d}T00:00:00Z`).getTime();
    const endMs = new Date(`${spotRows[spotRows.length - 1].d}T00:00:00Z`).getTime();
    const span = Math.max(endMs - startMs, 86400000);
    const x = (date) => margin.left + (new Date(`${date}T00:00:00Z`).getTime() - startMs) / span * plotWidth;
    const values = spotRows.map((row) => row.c);
    perpRows.forEach((row) => values.push(row.l, row.h));
    let low = Math.min(...values);
    let high = Math.max(...values);
    const pad = Math.max((high - low) * .09, 1);
    low -= pad;
    high += pad;
    const y = (value) => margin.top + (high - Number(value)) / (high - low) * plotHeight;

    stage.innerHTML = "";
    const svg = svgNode("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `${data.symbol} spot total-return line and long perpetual-swap total-return candlesticks from ${spotRows[0].d} through ${spotRows[spotRows.length - 1].d}`,
    });

    const exactTime = data.exactStart ? new Date(`${data.exactStart}T00:00:00Z`).getTime() : null;
    if (exactTime && exactTime > startMs && exactTime < endMs) {
      const exactX = x(data.exactStart);
      svg.appendChild(svgNode("rect", { x: margin.left, y: margin.top, width: exactX - margin.left, height: plotHeight, class: "market-proxy-zone" }));
      svg.appendChild(svgNode("line", { x1: exactX, y1: margin.top, x2: exactX, y2: height - margin.bottom, class: "market-exact-line" }));
      const label = svgNode("text", { x: exactX + 8, y: margin.top + 14, class: "market-exact-label" });
      label.textContent = "EXACT 30M OPEN / RANGE →";
      svg.appendChild(label);
    }

    for (let index = 0; index < 6; index += 1) {
      const value = high - (high - low) * index / 5;
      const py = y(value);
      svg.appendChild(svgNode("line", { x1: margin.left, y1: py, x2: width - margin.right, y2: py, class: "market-grid" }));
      const label = svgNode("text", { x: width - margin.right + 10, y: py + 4, class: "market-axis" });
      label.textContent = number(value, 1);
      svg.appendChild(label);
    }

    const candleWidth = Math.max(2.2, Math.min(8, plotWidth / Math.max(perpRows.length, 1) * .58));
    perpRows.forEach((row) => {
      const px = x(row.d);
      const group = svgNode("g", { class: row.p === "hourly" ? "market-proxy" : "market-exact" });
      group.appendChild(svgNode("line", { x1: px, y1: y(row.h), x2: px, y2: y(row.l), class: "market-wick" }));
      const top = Math.min(y(row.o), y(row.c));
      const bodyHeight = Math.max(Math.abs(y(row.o) - y(row.c)), 1.4);
      group.appendChild(svgNode("rect", {
        x: px - candleWidth / 2,
        y: top,
        width: candleWidth,
        height: bodyHeight,
        class: row.c >= row.o ? "market-body-up" : "market-body-down",
      }));
      svg.appendChild(group);
    });

    const line = spotRows.map((row, index) => `${index ? "L" : "M"}${x(row.d).toFixed(2)},${y(row.c).toFixed(2)}`).join(" ");
    svg.appendChild(svgNode("path", { d: line, class: "market-spot" }));

    const labelCount = 5;
    for (let index = 0; index < labelCount; index += 1) {
      const rowIndex = Math.round((spotRows.length - 1) * index / (labelCount - 1));
      const row = spotRows[rowIndex];
      const label = svgNode("text", {
        x: x(row.d),
        y: height - 18,
        class: "market-axis",
        "text-anchor": index === 0 ? "start" : index === labelCount - 1 ? "end" : "middle",
      });
      label.textContent = dateLabel(row.d, false);
      svg.appendChild(label);
    }

    const crosshair = svgNode("line", { y1: margin.top, y2: height - margin.bottom, class: "market-crosshair" });
    const focusDot = svgNode("circle", { r: 4.5, class: "market-focus-dot" });
    crosshair.setAttribute("visibility", "hidden");
    focusDot.setAttribute("visibility", "hidden");
    svg.appendChild(crosshair);
    svg.appendChild(focusDot);
    stage.appendChild(svg);
    const tooltip = document.createElement("div");
    tooltip.id = "market-tooltip";
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    stage.appendChild(tooltip);

    const perpByDate = new Map(perpRows.map((row) => [row.d, row]));
    function focusAt(index, pointerX, pointerY) {
      const bounded = Math.max(0, Math.min(index, spotRows.length - 1));
      state.focusIndex = bounded;
      const spot = spotRows[bounded];
      const perp = perpByDate.get(spot.d);
      const px = x(spot.d);
      crosshair.setAttribute("x1", px);
      crosshair.setAttribute("x2", px);
      crosshair.setAttribute("visibility", "visible");
      focusDot.setAttribute("cx", px);
      focusDot.setAttribute("cy", y(spot.c));
      focusDot.setAttribute("visibility", "visible");
      tooltip.innerHTML = [
        `<div class="tooltip-date">${dateLabel(spot.d, true).toUpperCase()}</div>`,
        `<div class="tooltip-row spot"><span>Spot close</span><strong>${number(spot.c)}</strong></div>`,
        perp ? `<div class="tooltip-row"><span>Swap O / C</span><strong>${number(perp.o)} / ${number(perp.c)}</strong></div>` : '<div class="tooltip-row"><span>Swap</span><strong>Not listed</strong></div>',
        perp ? `<div class="tooltip-row"><span>Swap H / L</span><strong>${number(perp.h)} / ${number(perp.l)}</strong></div>` : "",
        perp ? `<div class="tooltip-row"><span>Funding to close</span><strong>${percent(perp.f * 100, 3)}</strong></div>` : "",
        perp ? `<p class="tooltip-precision">${perp.p === "exact" ? "Exact 09:30–16:00 from 30-minute bars" : "Hourly proxy: 09:00 open; exact 16:00 close"}</p>` : "",
      ].join("");
      tooltip.hidden = false;
      const stageRect = stage.getBoundingClientRect();
      const cssX = pointerX == null ? px / width * stageRect.width : pointerX;
      const cssY = pointerY == null ? y(spot.c) / height * stageRect.height : pointerY;
      tooltip.style.left = `${Math.min(Math.max(cssX + 14, 8), stageRect.width - 243)}px`;
      tooltip.style.top = `${Math.min(Math.max(cssY - 78, 8), stageRect.height - tooltip.offsetHeight - 8)}px`;
      text("chart-live", `${spot.d}. Spot ${number(spot.c)}.${perp ? ` Swap open ${number(perp.o)}, high ${number(perp.h)}, low ${number(perp.l)}, close ${number(perp.c)}.` : " Swap not yet available."}`);
    }

    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const svgX = (event.clientX - rect.left) / rect.width * width;
      const timestamp = startMs + (svgX - margin.left) / plotWidth * span;
      let nearest = 0;
      let distance = Infinity;
      spotRows.forEach((row, index) => {
        const current = Math.abs(new Date(`${row.d}T00:00:00Z`).getTime() - timestamp);
        if (current < distance) { nearest = index; distance = current; }
      });
      focusAt(nearest, event.clientX - rect.left, event.clientY - rect.top);
    });
    svg.addEventListener("pointerleave", () => { tooltip.hidden = true; crosshair.setAttribute("visibility", "hidden"); focusDot.setAttribute("visibility", "hidden"); });
    stage.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? spotRows.length - 1 : state.focusIndex + (event.key === "ArrowRight" ? 1 : -1);
      focusAt(next);
    };
    if (window.matchMedia("(max-width: 620px)").matches) {
      window.requestAnimationFrame(() => {
        const scroller = stage.closest(".chart-scroll");
        if (scroller) scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
      });
    }
  }

  function wireRanges() {
    document.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        state.range = button.dataset.range;
        document.querySelectorAll("[data-range]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        renderChart();
      });
    });
  }

  async function initialize() {
    if (!slug) return;
    wireRanges();
    try {
      const [universe, data] = await Promise.all([
        json("/assets/market-data/universe.json"),
        json(`/assets/market-data/${slug}.json`),
      ]);
      state.data = data;
      populateUniverse(universe);
      updateCopy(data);
      renderChart();
    } catch (error) {
      const stage = $("market-chart-stage");
      if (stage) stage.innerHTML = `<div class="chart-error">Market history unavailable.<br>${String(error.message || error)}</div>`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
