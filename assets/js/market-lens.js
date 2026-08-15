(function () {
  "use strict";

  const page = document.body;
  const slug = page.dataset.marketSlug;
  const marketVersion = page.dataset.marketVersion || "";
  const state = { data: null, range: "MAX", rows: [], focusIndex: -1, ratioRows: [], ratioFocusIndex: -1 };
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

  function dateLabel(value, long) {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-US", long
      ? { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
      : { year: "2-digit", month: "short", day: "numeric", timeZone: "UTC" }
    ).format(date);
  }

  function timestampLabel(value) {
    if (!value) return "unknown cutoff";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "unknown cutoff";
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      hour12: false, timeZone: "UTC",
    }).format(parsed);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function compactMoney(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "—";
    if (parsed < 1000) return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(parsed)}`;
  }

  function explorerUrl(network, address) {
    const encoded = encodeURIComponent(address);
    const routes = {
      "Robinhood Chain": `https://robinhoodchain.blockscout.com/token/${encoded}`,
      Ethereum: `https://etherscan.io/token/${encoded}`,
      Solana: `https://solscan.io/token/${encoded}`,
      HyperEVM: `https://hyperevmscan.io/token/${encoded}`,
      Arbitrum: `https://arbiscan.io/token/${encoded}`,
      "BNB Chain": `https://bscscan.com/token/${encoded}`,
      Base: `https://basescan.org/token/${encoded}`,
      Optimism: `https://optimistic.etherscan.io/token/${encoded}`,
      Mantle: `https://mantlescan.xyz/token/${encoded}`,
      Ink: `https://explorer.inkonchain.com/token/${encoded}`,
      "X Layer": `https://www.oklink.com/xlayer/address/${encoded}`,
      Polygon: `https://polygonscan.com/token/${encoded}`,
      Avalanche: `https://snowtrace.io/token/${encoded}`,
      Gnosis: `https://gnosisscan.io/token/${encoded}`,
      Sonic: `https://sonicscan.org/token/${encoded}`,
      TON: `https://tonviewer.com/${encoded}`,
      Tron: `https://tronscan.org/#/token20/${encoded}`,
    };
    return routes[network] || "";
  }

  function marketAssetUrl(url) {
    if (!marketVersion) return url;
    return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(marketVersion)}`;
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
    text("spot-start", dateLabel(data.spotStart, true));
    text("perp-start", dateLabel(data.perpStart, true));
    text("anchor-date", dateLabel(data.anchorDate, true));
    text("exact-start", dateLabel(data.exactStart, true));
    renderFundingForecast(data.fundingForecast);
  }

  function renderFundingForecast(forecast) {
    const asOf = forecast && forecast.asOf;
    text("funding-forecast-asof", asOf ? `As of ${timestampLabel(asOf)} UTC` : "Forecast unavailable");
    [
      ["1d", forecast && forecast.oneDayLongApyPct],
      ["7d", forecast && forecast.sevenDayLongApyPct],
    ].forEach(([horizon, value]) => {
      const valueNode = $(`funding-forecast-${horizon}`);
      const directionNode = $(`funding-forecast-${horizon}-direction`);
      const parsed = value == null ? NaN : Number(value);
      if (!Number.isFinite(parsed)) {
        if (valueNode) valueNode.textContent = "—";
        if (directionNode) directionNode.textContent = "Unavailable";
        return;
      }
      const earns = parsed > 0;
      const pays = parsed < 0;
      const className = earns ? "positive" : pays ? "negative" : "";
      if (valueNode) {
        valueNode.textContent = percent(parsed, 2);
        valueNode.className = className;
      }
      if (directionNode) {
        directionNode.textContent = earns ? "Long earns" : pays ? "Long pays" : "Flat";
        directionNode.className = className;
      }
    });
  }

  function cutoffForRange(data) {
    if (state.range === "MAX") {
      const first = [data.spotStart, data.perpStart].filter(Boolean).sort()[0];
      return new Date(`${first}T00:00:00Z`);
    }
    const last = new Date(`${data.endDate}T00:00:00Z`);
    if (state.range === "YTD") return new Date(Date.UTC(last.getUTCFullYear(), 0, 1));
    const months = state.range === "3M" ? 3 : 6;
    last.setUTCMonth(last.getUTCMonth() - months);
    return last;
  }

  function visibleSeries(data, key) {
    const cutoff = cutoffForRange(data).getTime();
    return data[key].filter((row) => new Date(`${row.d}T00:00:00Z`).getTime() >= cutoff);
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
    const spotRows = visibleSeries(data, "spot");
    const perpRows = visibleSeries(data, "perp");
    const spotByDate = new Map(spotRows.map((row) => [row.d, row]));
    const perpByDate = new Map(perpRows.map((row) => [row.d, row]));
    const dates = [...new Set([...spotByDate.keys(), ...perpByDate.keys()])].sort();
    const timelineRows = dates.map((date) => ({ d: date, spot: spotByDate.get(date), perp: perpByDate.get(date) }));
    state.rows = timelineRows;
    state.focusIndex = timelineRows.length - 1;

    if (!timelineRows.length) {
      stage.innerHTML = '<div class="chart-error">No observations in this window.</div>';
      return;
    }

    const width = 1280;
    const height = 590;
    const margin = { top: 40, right: 76, bottom: 50, left: 72 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const startMs = new Date(`${dates[0]}T00:00:00Z`).getTime();
    const endMs = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
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
      "aria-label": `${data.symbol} spot total-return line and seven-day long perpetual-swap total-return candlesticks from ${dates[0]} through ${dates[dates.length - 1]}`,
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
      const groupClass = row.p === "partial" ? "market-partial" : row.p === "hourly" ? "market-proxy" : "market-exact";
      const group = svgNode("g", { class: groupClass });
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
    if (line) svg.appendChild(svgNode("path", { d: line, class: "market-spot" }));

    const labelCount = 5;
    for (let index = 0; index < labelCount; index += 1) {
      const rowIndex = Math.round((timelineRows.length - 1) * index / (labelCount - 1));
      const row = timelineRows[rowIndex];
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

    function focusAt(index, pointerX, pointerY) {
      const bounded = Math.max(0, Math.min(index, timelineRows.length - 1));
      state.focusIndex = bounded;
      const row = timelineRows[bounded];
      const spot = row.spot;
      const perp = row.perp;
      const focusValue = spot ? spot.c : perp.c;
      const px = x(row.d);
      crosshair.setAttribute("x1", px);
      crosshair.setAttribute("x2", px);
      crosshair.setAttribute("visibility", "visible");
      focusDot.setAttribute("class", spot ? "market-focus-dot" : "market-focus-dot perp-only");
      focusDot.setAttribute("cx", px);
      focusDot.setAttribute("cy", y(focusValue));
      focusDot.setAttribute("visibility", "visible");
      const precision = !perp
        ? ""
        : perp.p === "partial"
        ? `Live partial session through ${timestampLabel(perp.t)} UTC`
        : perp.p === "exact"
        ? "Exact 09:30–16:00 from 30-minute bars"
        : "Hourly proxy: 09:00 open; exact 16:00 close";
      tooltip.innerHTML = [
        `<div class="tooltip-date">${dateLabel(row.d, true).toUpperCase()}</div>`,
        spot ? `<div class="tooltip-row spot"><span>Spot close</span><strong>${number(spot.c)}</strong></div>` : '<div class="tooltip-row spot"><span>Spot</span><strong>Cash market closed</strong></div>',
        perp ? `<div class="tooltip-row"><span>Swap O / C</span><strong>${number(perp.o)} / ${number(perp.c)}</strong></div>` : '<div class="tooltip-row"><span>Swap</span><strong>Not listed</strong></div>',
        perp ? `<div class="tooltip-row"><span>Swap H / L</span><strong>${number(perp.h)} / ${number(perp.l)}</strong></div>` : "",
        perp ? `<div class="tooltip-row"><span>${perp.p === "partial" ? "Funding observed" : "Funding to close"}</span><strong>${percent(perp.f * 100, 3)}</strong></div>` : "",
        precision ? `<p class="tooltip-precision">${precision}</p>` : "",
      ].join("");
      tooltip.hidden = false;
      const stageRect = stage.getBoundingClientRect();
      const cssX = pointerX == null ? px / width * stageRect.width : pointerX;
      const cssY = pointerY == null ? y(focusValue) / height * stageRect.height : pointerY;
      tooltip.style.left = `${Math.min(Math.max(cssX + 14, 8), stageRect.width - 243)}px`;
      tooltip.style.top = `${Math.min(Math.max(cssY - 78, 8), stageRect.height - tooltip.offsetHeight - 8)}px`;
      text("chart-live", `${row.d}. ${spot ? `Spot ${number(spot.c)}.` : "Cash spot closed."}${perp ? ` Swap open ${number(perp.o)}, high ${number(perp.h)}, low ${number(perp.l)}, close ${number(perp.c)}.` : " Swap not yet available."}`);
    }

    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const svgX = (event.clientX - rect.left) / rect.width * width;
      const timestamp = startMs + (svgX - margin.left) / plotWidth * span;
      let nearest = 0;
      let distance = Infinity;
      timelineRows.forEach((row, index) => {
        const current = Math.abs(new Date(`${row.d}T00:00:00Z`).getTime() - timestamp);
        if (current < distance) { nearest = index; distance = current; }
      });
      focusAt(nearest, event.clientX - rect.left, event.clientY - rect.top);
    });
    svg.addEventListener("pointerleave", () => { tooltip.hidden = true; crosshair.setAttribute("visibility", "hidden"); focusDot.setAttribute("visibility", "hidden"); });
    stage.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? timelineRows.length - 1 : state.focusIndex + (event.key === "ArrowRight" ? 1 : -1);
      focusAt(next);
    };
    if (window.matchMedia("(max-width: 620px)").matches) {
      window.requestAnimationFrame(() => {
        const scroller = stage.closest(".chart-scroll");
        if (scroller) scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
      });
    }
  }

  function renderRatioChart() {
    const data = state.data;
    const stage = $("ratio-chart-stage");
    if (!data || !stage) return;
    const spotRows = visibleSeries(data, "spot");
    const perpRows = visibleSeries(data, "perp");
    const ratioRows = [];
    let spotCursor = 0;
    let latestSpot = null;
    perpRows.forEach((perp) => {
      while (spotCursor < spotRows.length && spotRows[spotCursor].d <= perp.d) {
        latestSpot = spotRows[spotCursor];
        spotCursor += 1;
      }
      if (!latestSpot) return;
      const ratio = Number(perp.c) / Number(latestSpot.c);
      if (Number.isFinite(ratio)) {
        ratioRows.push({ d: perp.d, ratio, spotDate: latestSpot.d, spotHeld: latestSpot.d !== perp.d });
      }
    });
    state.ratioRows = ratioRows;
    state.ratioFocusIndex = ratioRows.length - 1;

    if (!ratioRows.length) {
      stage.innerHTML = '<div class="chart-error">No anchored spot and swap observations in this window.</div>';
      text("ratio-latest", "—");
      return;
    }

    const width = 1280;
    const height = 250;
    const margin = { top: 18, right: 76, bottom: 40, left: 72 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const startMs = new Date(`${ratioRows[0].d}T00:00:00Z`).getTime();
    const endMs = new Date(`${ratioRows[ratioRows.length - 1].d}T00:00:00Z`).getTime();
    const span = Math.max(endMs - startMs, 86400000);
    const x = (date) => margin.left + (new Date(`${date}T00:00:00Z`).getTime() - startMs) / span * plotWidth;
    const extent = Math.max(...ratioRows.map((row) => Math.abs(row.ratio - 1)), .005) * 1.12;
    const low = 1 - extent;
    const high = 1 + extent;
    const y = (value) => margin.top + (high - Number(value)) / (high - low) * plotHeight;
    const baselineY = y(1);

    stage.innerHTML = "";
    const svg = svgNode("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `${data.symbol} perp long divided by spot long total-return ratio from ${ratioRows[0].d} through ${ratioRows[ratioRows.length - 1].d}`,
    });

    for (let index = 0; index < 5; index += 1) {
      const value = high - (high - low) * index / 4;
      const py = y(value);
      if (index !== 2) svg.appendChild(svgNode("line", { x1: margin.left, y1: py, x2: width - margin.right, y2: py, class: "market-grid" }));
      const label = svgNode("text", { x: width - margin.right + 10, y: py + 4, class: "market-axis" });
      label.textContent = `${number(value, 3)}×`;
      svg.appendChild(label);
    }
    svg.appendChild(svgNode("line", { x1: margin.left, y1: baselineY, x2: width - margin.right, y2: baselineY, class: "ratio-baseline" }));

    const line = ratioRows.map((row, index) => `${index ? "L" : "M"}${x(row.d).toFixed(2)},${y(row.ratio).toFixed(2)}`).join(" ");
    const area = `${line} L${x(ratioRows[ratioRows.length - 1].d).toFixed(2)},${baselineY.toFixed(2)} L${x(ratioRows[0].d).toFixed(2)},${baselineY.toFixed(2)} Z`;
    svg.appendChild(svgNode("path", { d: area, class: "ratio-area" }));
    svg.appendChild(svgNode("path", { d: line, class: "ratio-line" }));

    const labelCount = 5;
    for (let index = 0; index < labelCount; index += 1) {
      const rowIndex = Math.round((ratioRows.length - 1) * index / (labelCount - 1));
      const row = ratioRows[rowIndex];
      const label = svgNode("text", {
        x: x(row.d),
        y: height - 13,
        class: "market-axis",
        "text-anchor": index === 0 ? "start" : index === labelCount - 1 ? "end" : "middle",
      });
      label.textContent = dateLabel(row.d, false);
      svg.appendChild(label);
    }

    const crosshair = svgNode("line", { y1: margin.top, y2: height - margin.bottom, class: "ratio-crosshair", visibility: "hidden" });
    const focusDot = svgNode("circle", { r: 4.5, class: "ratio-focus-dot", visibility: "hidden" });
    svg.appendChild(crosshair);
    svg.appendChild(focusDot);
    stage.appendChild(svg);
    const tooltip = document.createElement("div");
    tooltip.id = "ratio-tooltip";
    tooltip.className = "chart-tooltip ratio-tooltip";
    tooltip.hidden = true;
    stage.appendChild(tooltip);

    const latest = ratioRows[ratioRows.length - 1];
    const latestNode = $("ratio-latest");
    if (latestNode) {
      latestNode.textContent = `${number(latest.ratio, 4)}× · ${percent((latest.ratio - 1) * 100, 2)}${latest.spotHeld ? ` · spot ${dateLabel(latest.spotDate, false)}` : ""}`;
      latestNode.classList.toggle("positive", latest.ratio >= 1);
      latestNode.classList.toggle("negative", latest.ratio < 1);
    }

    function focusAt(index, pointerX, pointerY) {
      const bounded = Math.max(0, Math.min(index, ratioRows.length - 1));
      state.ratioFocusIndex = bounded;
      const row = ratioRows[bounded];
      const px = x(row.d);
      const py = y(row.ratio);
      crosshair.setAttribute("x1", px);
      crosshair.setAttribute("x2", px);
      crosshair.setAttribute("visibility", "visible");
      focusDot.setAttribute("cx", px);
      focusDot.setAttribute("cy", py);
      focusDot.setAttribute("visibility", "visible");
      tooltip.innerHTML = [
        `<div class="tooltip-date">${dateLabel(row.d, true).toUpperCase()}</div>`,
        `<div class="tooltip-row"><span>Perp / spot</span><strong>${number(row.ratio, 4)}×</strong></div>`,
        `<div class="tooltip-row"><span>Perp vs spot</span><strong>${percent((row.ratio - 1) * 100, 2)}</strong></div>`,
        row.spotHeld ? `<p class="tooltip-precision">Spot reference held at ${dateLabel(row.spotDate, true)} cash close</p>` : "",
      ].join("");
      tooltip.hidden = false;
      const stageRect = stage.getBoundingClientRect();
      const cssX = pointerX == null ? px / width * stageRect.width : pointerX;
      const cssY = pointerY == null ? py / height * stageRect.height : pointerY;
      tooltip.style.left = `${Math.min(Math.max(cssX + 14, 8), stageRect.width - 243)}px`;
      tooltip.style.top = `${Math.min(Math.max(cssY - 58, 8), stageRect.height - tooltip.offsetHeight - 8)}px`;
      text("ratio-live", `${row.d}. Perp long divided by spot long is ${number(row.ratio, 4)}. Perp cumulative return versus spot is ${percent((row.ratio - 1) * 100, 2)}.${row.spotHeld ? ` Spot reference is held at the ${row.spotDate} cash close.` : ""}`);
    }

    svg.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const svgX = (event.clientX - rect.left) / rect.width * width;
      const timestamp = startMs + (svgX - margin.left) / plotWidth * span;
      let nearest = 0;
      let distance = Infinity;
      ratioRows.forEach((row, index) => {
        const current = Math.abs(new Date(`${row.d}T00:00:00Z`).getTime() - timestamp);
        if (current < distance) { nearest = index; distance = current; }
      });
      focusAt(nearest, event.clientX - rect.left, event.clientY - rect.top);
    });
    svg.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
      crosshair.setAttribute("visibility", "hidden");
      focusDot.setAttribute("visibility", "hidden");
    });
    stage.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? ratioRows.length - 1 : state.ratioFocusIndex + (event.key === "ArrowRight" ? 1 : -1);
      focusAt(next);
    };
    if (window.matchMedia("(max-width: 620px)").matches) {
      window.requestAnimationFrame(() => {
        const scroller = stage.closest(".chart-scroll");
        if (scroller) scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
      });
    }
  }

  function renderAllCharts() {
    renderChart();
    renderRatioChart();
  }

  const MAJOR_QUOTES = new Set(["USDC", "USDT", "USDG", "USDON", "DAI", "USDS", "FDUSD", "USD1", "USDE", "USDT0", "PYUSD", "WETH", "ETH", "SOL", "WSOL", "HYPE", "WHYPE"]);

  function networkMarkup(deployments) {
    const networks = [...new Set(deployments.map((deployment) => deployment.network))];
    const badges = networks.map((network) => `<span class="network-badge">${escapeHtml(network)}</span>`).join("");
    if (networks.length <= 5) return `<div class="network-list">${badges}</div>`;
    return `<details class="network-details"><summary>${networks.length} networks</summary><div class="network-list">${badges}</div></details>`;
  }

  function contractLink(deployment, className) {
    const href = explorerUrl(deployment.network, deployment.address);
    const label = escapeHtml(deployment.address);
    if (!href) return `<span class="${className || "contract-link"}">${label}</span>`;
    return `<a class="${className || "contract-link"}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  function contractMarkup(market) {
    const primary = market.primaryDeployment;
    const deployments = market.deployments || [];
    const uniqueAddresses = new Set(deployments.map((deployment) => deployment.address.toLowerCase())).size;
    const details = deployments.map((deployment) => (
      `<div class="contract-deployment"><span>${escapeHtml(deployment.network)}</span>${contractLink(deployment)}</div>`
    )).join("");
    return [
      `<div class="contract-primary"><span class="contract-network">${escapeHtml(primary.network)}</span>${contractLink(primary)}</div>`,
      deployments.length > 1 ? `<details class="contract-details"><summary>${deployments.length} deployments · ${uniqueAddresses} contract${uniqueAddresses === 1 ? "" : "s"}</summary><div class="contract-deployment-list">${details}</div></details>` : "",
    ].join("");
  }

  function onchainRowMarkup(market, index) {
    const issuerClass = String(market.issuer || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const volume = Number(market.allVenueVolumeUsd);
    const hasVolume = market.allVenueVolumeUsd != null && Number.isFinite(volume);
    const volumeLabel = hasVolume ? compactMoney(volume) : "Not indexed";
    const volumeTitle = hasVolume ? `$${volume.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "No aggregate venue volume available";
    const issuerUrl = market.issuerUrl || market.sourceUrl;
    const marketDataLink = market.marketDataUrl
      ? `<a href="${escapeHtml(market.marketDataUrl)}" target="_blank" rel="noopener noreferrer">CoinGecko aggregate ↗</a>`
      : "No aggregate feed";
    return `<div class="onchain-market-row issuer-${issuerClass}${market.preferred ? " preferred-market" : ""}" role="row">
      <div class="onchain-cell token" role="cell">
        <div class="onchain-token"><i class="issuer-mark" aria-hidden="true"></i><strong>${escapeHtml(market.tokenSymbol)}</strong><a href="${escapeHtml(issuerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(market.issuer)} ↗</a>${market.preferred ? '<span class="preferred-badge">Preferred</span>' : ""}</div>
        <span class="onchain-structure">${escapeHtml(market.legalStructure || "Issuer-linked token")}</span>
      </div>
      <div class="onchain-cell networks" role="cell">${networkMarkup(market.deployments || [])}</div>
      <div class="onchain-cell contracts" role="cell">${contractMarkup(market)}</div>
      <div class="onchain-cell volume onchain-metric" role="cell"><strong title="${escapeHtml(volumeTitle)}">${volumeLabel}</strong><small>${marketDataLink}</small></div>
      <div id="onchain-liquidity-${index}" class="onchain-cell liquidity onchain-metric" role="cell"><strong>Indexing…</strong><small>Major-quote pools</small></div>
    </div>`;
  }

  function pairKey(pair) {
    return `${pair.chainId || ""}:${String(pair.pairAddress || "").toLowerCase()}`;
  }

  function isMajorQuotePair(pair, addresses) {
    const baseAddress = String(pair.baseToken && pair.baseToken.address || "").toLowerCase();
    const quoteAddress = String(pair.quoteToken && pair.quoteToken.address || "").toLowerCase();
    const baseSymbol = String(pair.baseToken && pair.baseToken.symbol || "").toUpperCase();
    const quoteSymbol = String(pair.quoteToken && pair.quoteToken.symbol || "").toUpperCase();
    return (addresses.has(baseAddress) && MAJOR_QUOTES.has(quoteSymbol)) || (addresses.has(quoteAddress) && MAJOR_QUOTES.has(baseSymbol));
  }

  async function liquidityForMarket(market) {
    const addresses = [...new Set((market.queryAddresses || []).map((address) => String(address)))];
    const responses = await Promise.allSettled(addresses.map((address) => json(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`)));
    const fulfilled = responses.filter((response) => response.status === "fulfilled");
    if (!fulfilled.length) throw new Error("liquidity index unavailable");
    const targetAddresses = new Set(addresses.map((address) => address.toLowerCase()));
    const pairs = [];
    const seen = new Set();
    fulfilled.forEach((response) => {
      (response.value.pairs || []).forEach((pair) => {
        const key = pairKey(pair);
        if (!seen.has(key) && isMajorQuotePair(pair, targetAddresses)) {
          seen.add(key);
          pairs.push(pair);
        }
      });
    });
    return {
      liquidity: pairs.reduce((sum, pair) => sum + (Number(pair.liquidity && pair.liquidity.usd) || 0), 0),
      volume: pairs.reduce((sum, pair) => sum + (Number(pair.volume && pair.volume.h24) || 0), 0),
      pools: pairs.length,
    };
  }

  async function renderOnchainMarkets(data) {
    const rowsNode = $("onchain-market-rows");
    const stampNode = $("onchain-live-stamp");
    const preferredNode = $("onchain-preferred");
    if (!rowsNode) return;
    const markets = data.onchainSpot && Array.isArray(data.onchainSpot.markets) ? data.onchainSpot.markets : [];
    if (!markets.length) {
      rowsNode.innerHTML = '<div class="onchain-empty">No verified on-chain spot wrapper found in the indexed issuer registries.</div>';
      if (preferredNode) preferredNode.textContent = "No indexed wrapper";
      if (stampNode) stampNode.textContent = "Registries checked";
      return;
    }
    const preferred = markets.find((market) => market.preferred);
    if (preferredNode) {
      preferredNode.textContent = preferred
        ? `Preferred by 24h volume · ${preferred.tokenSymbol} / ${preferred.issuer}`
        : "No volume-ranked preference";
    }
    rowsNode.innerHTML = markets.map(onchainRowMarkup).join("");
    const results = await Promise.allSettled(markets.map(liquidityForMarket));
    let liveCount = 0;
    results.forEach((result, index) => {
      const liquidityNode = $(`onchain-liquidity-${index}`);
      if (!liquidityNode) return;
      if (result.status === "rejected") {
        liquidityNode.innerHTML = "<strong>Unavailable</strong><small>Contract remains verified</small>";
        return;
      }
      liveCount += 1;
      const value = result.value;
      const dexVolume = value.pools ? compactMoney(value.volume) : "—";
      liquidityNode.innerHTML = `<strong title="$${value.liquidity.toLocaleString("en-US", { maximumFractionDigits: 2 })}">${value.pools ? compactMoney(value.liquidity) : "No indexed pool"}</strong><small>${dexVolume} DEX volume · ${value.pools} pool${value.pools === 1 ? "" : "s"}</small>`;
    });
    if (stampNode) {
      const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
      const dexTime = formatter.format(new Date());
      const venueTime = data.onchainSpot && data.onchainSpot.generatedAt
        ? formatter.format(new Date(data.onchainSpot.generatedAt))
        : "unknown";
      stampNode.textContent = liveCount
        ? `Venue snapshot ${venueTime} UTC · DEX live ${dexTime} UTC`
        : `Venue snapshot ${venueTime} UTC · DEX index unavailable`;
    }
  }

  function wireRanges() {
    document.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        state.range = button.dataset.range;
        document.querySelectorAll("[data-range]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        renderAllCharts();
      });
    });
  }

  async function initialize() {
    if (!slug) return;
    wireRanges();
    try {
      const [universe, data] = await Promise.all([
        json(marketAssetUrl("/assets/market-data/universe.json")),
        json(marketAssetUrl(`/assets/market-data/${slug}.json`)),
      ]);
      state.data = data;
      populateUniverse(universe);
      updateCopy(data);
      renderAllCharts();
      renderOnchainMarkets(data);
    } catch (error) {
      const stage = $("market-chart-stage");
      if (stage) stage.innerHTML = `<div class="chart-error">Market history unavailable.<br>${String(error.message || error)}</div>`;
      const ratioStage = $("ratio-chart-stage");
      if (ratioStage) ratioStage.innerHTML = '<div class="chart-error">Return ratio unavailable.</div>';
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
