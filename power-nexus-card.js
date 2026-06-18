// ─── Power Nexus Card ─────────────────────────────────────────────────────────
// Home Assistant Lovelace Custom Card zur Visualisierung von Energieflüssen
// Version 0.2.010

// ─── Geometrie-Konstanten ─────────────────────────────────────────────────────
const GEOM = {
  BASE_R: 50,           // Basis-Radius / Halbe Breite eines M-Knotens (in SVG-Einheiten)
  FO_SIZE: 52,          // foreignObject-Größe (Container für ha-icon im SVG)
  ICON_PX: 28,          // Icon-Pixelgröße (--mdc-icon-size)
  FONT_SIZE: 17,        // Schriftgröße für Knotenname und Leistungswert
  ICON_SCALE: 1.3,      // Icon-Skalierungsfaktor (transform:scale auf Wrapper-Div)
  CAP_FRAC: 0.35,       // Cap-Height-Anteil (zur Berechnung der visuellen Textmitte)
  BTN_HEIGHT: 0.85,     // Button-Höhenfaktor (Höhe = Breite × 0.85, ca. 4:3,4)
  BTN_CORNER: 12,       // Button-Eckenradius (wird mit sf multipliziert)
  HOME_CORNER: 16,      // Home-Eckenradius (wird mit HOME_SF multipliziert)
  SIZE_S: 0.65,         // S-Faktor (65% der M-Größe)
  SIZE_M: 1.0,          // M-Faktor (Standardgröße)
  SIZE_L: 1.35,         // L-Faktor (135% der M-Größe)
  FRAME_HALF: 0.45,     // Gruppenrahmen-Halbe (×CELL) – halbe Kantenlänge des Rahmens
  FRAME_OPACITY: 0.22,  // Rahmen-Deckkraft (rgba alpha)
  OFFSET_CIRCLE: 0.20,  // Text-Offset im Kreis-Mode (20% des Zwischenraums)
  OFFSET_BUTTON: 0.15,  // Text-Offset im Button-Mode (15% des Zwischenraums)
  SLOT_DIST: 0.22,      // Slot-Abstand vom Zellenmittelpunkt (×CELL)
  EDGE_OPACITY: 0.7,    // Linien-Deckkraft
  EDGE_DASH: 0.8,       // Dash-Länge-Faktor (×lineW für stroke-dasharray)
};

// HTML-Escaping um Injection zu verhindern
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Power Nexus Card – Energiefluss-Visualisierung für Home Assistant
window.customCards = window.customCards || [];
window.customCards.push({
  type: "custom:power-nexus-card",
  name: "Power Nexus Card",
  preview: true,
});

// ─── Card-Klasse ──────────────────────────────────────────────────────────────
class PowerNexus extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._hass = null; this._uid = ++PowerNexus._instances; }
  static _instances = 0;

  // Migrationen alter Keys in neue Struktur
  setConfig(c) {
    // fehlende Node-Properties mit Defaults belegen
    if (c.nodes?.length) {
      c = { ...c, nodes: c.nodes.map(n => ({ size: "M", slot: 0, invert_flow: false, ...n })) };
    }
    this.c = c;
    this._render();
  }

  set hass(h) {
    this._hass = h;
    this._updateValues();
  }

  _fmtPower(w) {
    const n = parseFloat(w);
    if (isNaN(n)) return "";
    if (Math.abs(n) < 1000) return n.toFixed(0) + " W";
    return (n / 1000).toFixed(1) + " kW";
  }

  static getStubConfig() {
    return {
      general: {
        knoten_zoom: 0.5,
        knoten_abstand: 185,
        button_mode: false,
        linien_staerke: 10,
        knoten_name_farbe: "#ffffff"
      },
      home: {
        name: "Haus",
        icon: "mdi:home",
        color: "#ffab40",
        entity: "",
        entity2: "",
        tap_action: { action: "more-info" }
      },
      nodes: [
        { name: "Solar", icon: "mdi:solar-power", color: "#ffab40", x: -1, y: 0, size: "M", connections: [{ target: "home" }] },
        { name: "Batterie", icon: "mdi:battery", color: "#4fc3f7", x: 1, y: 0, size: "M", connections: [{ target: "home" }] },
      ]
    };
  }

  static getConfigForm() {
    return {
      schema: [
        {
          type: "expandable",
          name: "general",
          title: "Allgemeine Einstellungen",
          schema: [
            { name: "knoten_zoom", selector: { number: { min: 0.5, max: 2.5, step: 0.1 } } },
            { name: "button_mode", selector: { boolean: {} } },
            { name: "linien_staerke", selector: { number: { min: 2, max: 30, step: 1 } } }
          ]
        },
        {
          type: "expandable",
          name: "home",
          title: "Home",
          schema: [
            { name: "name", selector: { text: {} } },
            { name: "icon", selector: { icon: {} } },
            { name: "color", selector: { text: { type: "color" } } },
            { name: "entity", selector: { entity: {} } },
            { name: "tap_action", selector: { "ui-action": {} } }
          ]
        }
      ]
    };
  }

  static async getConfigElement() {
    await window.loadCardHelpers?.();
    return document.createElement('power-nexus-card-editor');
  }

  getCardSize() { return 3; }

  _toHex(v) {
    if (!v) return "#ffab40";
    if (typeof v === "string") return v.startsWith("#") ? v : "#" + v.replace(/^#/, "");
    return "#ffab40";
  }

  _updateValues() {
    const root = this.shadowRoot;
    if (!root) return;

    const homeEl = root.querySelector('.pn-home-power');
    if (homeEl) {
      const eid = this.c?.home?.entity;
      const eid2 = this.c?.home?.entity2;
      let val = "";
      const v1 = (eid && this._hass?.states[eid]) ? parseFloat(this._hass.states[eid].state) || 0 : null;
      const v2 = (eid2 && this._hass?.states[eid2]) ? parseFloat(this._hass.states[eid2].state) || 0 : null;
      if (v1 !== null || v2 !== null) val = this._fmtPower((v1||0) + (v2||0));
      homeEl.textContent = val;
    }

    (this.c?.nodes || []).forEach((n, i) => {
      const el = root.querySelector(`.pn-node-power-${i}`);
      if (el) {
        let val = "";
        const v1 = (n.entity && this._hass?.states[n.entity]) ? parseFloat(this._hass.states[n.entity].state) || 0 : null;
        const v2 = (n.entity2 && this._hass?.states[n.entity2]) ? parseFloat(this._hass.states[n.entity2].state) || 0 : null;
        if (v1 !== null || v2 !== null) val = this._fmtPower((v1||0) + (v2||0));
        el.textContent = val;
      }
    });

    root.querySelectorAll('.pn-edge').forEach(edge => {
      const cellKey = edge.dataset.cell;
      if (!cellKey) return;
      const allNodes = this.c?.nodes || [];
      const cNodes = allNodes.filter(n => `${n.x??0},${n.y??0}` === cellKey);
      let sum = 0;
      cNodes.forEach(n => {
        const v1 = (n.entity && this._hass?.states[n.entity]) ? parseFloat(this._hass.states[n.entity].state) || 0 : 0;
        const v2 = (n.entity2 && this._hass?.states[n.entity2]) ? parseFloat(this._hass.states[n.entity2].state) || 0 : 0;
        const total = v1 + v2;
        sum += n.invert_flow ? -total : total;
      });
      edge.classList.remove('rev', 'still');
      if (sum === 0 || isNaN(sum)) edge.classList.add('still');
      else if (sum > 0) edge.classList.add('rev');
    });
  }

  // Strahl-Rechteck-Intersection
  _rayRect(hw, hh, ux, uy) {
    const tx = ux !== 0 ? hw / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? hh / Math.abs(uy) : Infinity;
    return Math.min(tx, ty);
  }

  // ─── Grid-Routing: Flusslinien um Knoten herumführen ─────────────────────

  // Set aller besetzten Grid-Zellen ("x,y"-Strings), inkl. Home (0,0)
  _buildOccupiedSet(nodes) {
    const occupied = new Set();
    occupied.add('0,0'); // Home ist immer besetzt
    nodes.forEach(n => occupied.add(`${n.x??0},${n.y??0}`));
    return occupied;
  }

  // Bresenham: alle Grid-Zellen, durch die eine Linie zwischen zwei Grid-Koordinaten verläuft
  _lineCells(gx1, gy1, gx2, gy2) {
    const cells = [];
    const dx = Math.abs(gx2 - gx1);
    const dy = Math.abs(gy2 - gy1);
    const sx = gx1 < gx2 ? 1 : -1;
    const sy = gy1 < gy2 ? 1 : -1;
    let err = dx - dy;
    let cx = gx1, cy = gy1;
    while (true) {
      cells.push(`${cx},${cy}`);
      if (cx === gx2 && cy === gy2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
    return cells;
  }

  // BFS-Pathfinding: kürzester Pfad von (sx,sy) nach (tx,ty), meidet besetzte Zellen
  _findGridPath(sx, sy, tx, ty, occupied) {
    if (sx === tx && sy === ty) return [{x: sx, y: sy}];
    const key = (x, y) => `${x},${y}`;
    const visited = new Set();
    const queue = [{x: sx, y: sy, path: [{x: sx, y: sy}]}];
    visited.add(key(sx, sy));
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const maxDist = Math.abs(tx - sx) + Math.abs(ty - sy) + 6;
    while (queue.length > 0) {
      const {x, y, path} = queue.shift();
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy, nk = key(nx, ny);
        if (visited.has(nk)) continue;
        if (Math.abs(nx - sx) + Math.abs(ny - sy) > maxDist * 2) continue;
        const isTarget = (nx === tx && ny === ty);
        if (!occupied.has(nk) || isTarget) {
          const newPath = [...path, {x: nx, y: ny}];
          if (isTarget) return newPath;
          visited.add(nk);
          queue.push({x: nx, y: ny, path: newPath});
        }
      }
    }
    return [{x: sx, y: sy}, {x: tx, y: ty}]; // Fallback: direkt
  }

  // Entfernt überflüssige Waypoints (kolineare Punkte auf gleicher Achse)
  _simplifyPath(path) {
    if (path.length <= 2) return path;
    const result = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const dx1 = path[i].x - path[i-1].x;
      const dy1 = path[i].y - path[i-1].y;
      const dx2 = path[i+1].x - path[i].x;
      const dy2 = path[i+1].y - path[i].y;
      if (dx1 !== dx2 || dy1 !== dy2) result.push(path[i]);
    }
    result.push(path[path.length - 1]);
    return result;
  }

  _render() {
    const c = this.c || {};
    const h = c.home || {};
    const g = c.general || {};
    const nodes = c.nodes || [];
    const homeName = h.name || "Haus";
    const homeIcon = h.icon || "mdi:home";
    const homeColor = this._toHex(h.color);
    const scale = parseFloat(g.knoten_zoom) || 1.0;
    const button = g.button_mode === true;
    const lineW = parseFloat(g.linien_staerke) || 10;
    const nodeNameColor = g.knoten_name_farbe || '#ffffff';
    const dashTotal = lineW * (1 + GEOM.EDGE_DASH); // Musterlänge für nahtlose Dash-Animation

    // SVG viewBox: 0 0 100 115, Home bei (50,50)
    const HOME_CX = 50, HOME_CY = 50;
    const SIZE_FACTOR = { S: GEOM.SIZE_S, M: GEOM.SIZE_M, L: GEOM.SIZE_L };
    const HOME_SF = SIZE_FACTOR.L;
    const HOME_HW = Math.round(GEOM.BASE_R * HOME_SF);
    const HOME_HH = Math.round(HOME_HW * GEOM.BTN_HEIGHT);
    const homeFoSize = Math.round(GEOM.FO_SIZE * HOME_SF);
    const homeFoOff = homeFoSize / 2;
    const homeFoX = HOME_CX - homeFoOff;
    const homeFoY = HOME_CY - homeFoOff;
    const homeIconSc = (GEOM.ICON_SCALE * HOME_SF).toFixed(2);
    const homeIconPx = Math.round(GEOM.ICON_PX * HOME_SF);
    const homeFontSize = Math.round(GEOM.FONT_SIZE * HOME_SF);
    // Text-Positionierung
    const homeCapHalf = homeFontSize * GEOM.CAP_FRAC;
    const homeVisIconHalf = homeIconPx * parseFloat(homeIconSc) / 2;
    const homeSpace = (button ? HOME_HH : HOME_HW) - homeVisIconHalf;
    const homeOffset = homeSpace * (button ? GEOM.OFFSET_BUTTON : GEOM.OFFSET_CIRCLE);
    const homeLabelY = HOME_CY - ((button ? HOME_HH : HOME_HW) + homeVisIconHalf) / 2 + homeCapHalf + homeOffset;
    const homePowerY = HOME_CY + (homeVisIconHalf + (button ? HOME_HH : HOME_HW)) / 2 + homeCapHalf - homeOffset;
    const CELL = parseFloat(g.knoten_abstand) || 195;

    // Button-Defs (nur im Button-Mode)
    const uid = this._uid;
    const buttonDefs = button ? `
      <defs>
        <linearGradient id="pn-btn-fill-${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(210,230,255,0.55)"/>
          <stop offset="40%" stop-color="rgba(140,190,245,0.30)"/>
          <stop offset="100%" stop-color="rgba(30,95,180,0.10)"/>
        </linearGradient>
        <linearGradient id="pn-btn-stroke-${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(180,220,255,0.60)"/>
          <stop offset="50%" stop-color="rgba(120,180,245,0.40)"/>
          <stop offset="100%" stop-color="rgba(30,85,175,0.12)"/>
        </linearGradient>
        <filter id="pn-btn-shadow-${uid}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.18)"/>
        </filter>
      </defs>
    ` : '';
    const shapeFill = button ? `fill: url(#pn-btn-fill-${uid});` : 'fill: none;';
    const shapeStroke = button
      ? `stroke: url(#pn-btn-stroke-${uid}); stroke-width: 1.0;`
      : `stroke: ${homeColor}; stroke-width: 2.5;`;
    const shapeFilter = button ? `filter: url(#pn-btn-shadow-${uid});` : '';

    // Zellen-Häufigkeiten für Slot-Positionierung
    const cellCount = {};
    nodes.forEach(n => { const k = `${n.x??0},${n.y??0}`; cellCount[k] = (cellCount[k]||0)+1; });

    const nodeSvgs = nodes.map((n, i) => {
      const sx = n.x || 0, sy = n.y || 0;
      const cellKey = `${sx},${sy}`;
      const hasNeighbors = (cellCount[cellKey] || 0) > 1;
      const slot = n.slot ?? 0;
      const d = GEOM.SLOT_DIST;
      const SLOT_DX = [-d, d, -d, d];
      const SLOT_DY = [-d, -d, d, d];
      const cx = HOME_CX + sx * CELL + (hasNeighbors ? SLOT_DX[slot] * CELL : 0);
      const cy = HOME_CY + sy * CELL + (hasNeighbors ? SLOT_DY[slot] * CELL : 0);
      const nColor = this._toHex(n.color) || '#4fc3f7';
      const nName = n.name || 'Node';
      const nIcon = n.icon || 'mdi:help-circle';
      const sf = SIZE_FACTOR[n.size] || 1.0;
      const nR = GEOM.BASE_R * sf;
      const halfH = button ? nR * GEOM.BTN_HEIGHT : nR;
      const foSize = GEOM.FO_SIZE * sf;
      const foOff = foSize / 2;
      const iconSc = (GEOM.ICON_SCALE * sf).toFixed(2);
      const iconPx = Math.round(GEOM.ICON_PX * sf);
      const fontSize = Math.round(GEOM.FONT_SIZE * sf);
      const capHalf = fontSize * GEOM.CAP_FRAC;
      const visIconHalf = iconPx * parseFloat(iconSc) / 2;
      const space = halfH - visIconHalf;
      const offset = space * (button ? GEOM.OFFSET_BUTTON : GEOM.OFFSET_CIRCLE);
      const labelY = -(halfH + visIconHalf) / 2 + capHalf + offset;
      const powerY = (visIconHalf + halfH) / 2 + capHalf - offset;
      const shapeEl = button
        ? `<rect class="pn-node-shape" x="${-nR}" y="${-halfH}" width="${nR*2}" height="${halfH*2}" rx="${Math.round(GEOM.BTN_CORNER*sf)}"/>`
        : `<circle class="pn-node-shape" cx="0" cy="0" r="${nR}" fill="none" stroke="${nColor}" stroke-width="2.5"/>`;
      const highlightEl = button
        ? `<rect class="pn-btn-highlight" x="${-nR+5}" y="${-halfH+2}" width="${nR*0.32}" height="${halfH*0.28}" rx="3"/>`
        : '';
      return `
        <g class="pn-node-group pn-node-${i}" transform="translate(${cx},${cy})">
          ${shapeEl}
          ${highlightEl}
          <foreignObject x="${-foOff}" y="${-foOff}" width="${foSize}" height="${foSize}">
            <div style="transform:scale(${iconSc});transform-origin:center;display:flex;align-items:center;justify-content:center;width:${foSize}px;height:${foSize}px;">
              <ha-icon icon="${nIcon}" style="--mdc-icon-size:${iconPx}px;color:${nColor};"></ha-icon>
            </div>
          </foreignObject>
          <text class="pn-node-label" x="0" y="${labelY}" font-size="${fontSize}" fill="${nodeNameColor}" text-anchor="middle">${esc(nName)}</text>
          <text class="pn-node-power-${i}" x="0" y="${powerY}" font-size="${fontSize}" fill="${nColor}" text-anchor="middle" font-weight="600"></text>
        </g>
      `;
    }).join('');

    // Gestrichelte Rahmen für Multi-Node-Zellen
    const groupFrames = Object.entries(cellCount)
      .filter(([, cnt]) => cnt > 1)
      .map(([key]) => {
        const [gx, gy] = key.split(',').map(Number);
        const gcx = HOME_CX + gx * CELL;
        const gcy = HOME_CY + gy * CELL;
        const fh = CELL * GEOM.FRAME_HALF;
        return `<rect class="pn-cell-frame" x="${gcx - fh}" y="${gcy - fh}" width="${fh*2}" height="${fh*2}" rx="10" fill="none"/>`;
      }).join('');

    // Grid-Map der besetzten Zellen (für Routing)
    const occupied = this._buildOccupiedSet(nodes);

    // Verbindungslinien pro Zelle (mit Routing um Knoten herum)
    const edgeLines = [];
    const edgeGrads = [];
    const cellNodes = {};
    nodes.forEach((n, i) => {
      const k = `${n.x??0},${n.y??0}`;
      if (!cellNodes[k]) cellNodes[k] = [];
      cellNodes[k].push({ ...n, idx: i });
    });
    const addedEdges = new Set();
    Object.entries(cellNodes).forEach(([cellKey, cNodes]) => {
      const [cx, cy] = cellKey.split(',').map(Number);
      const cellCX = HOME_CX + cx * CELL;
      const cellCY = HOME_CY + cy * CELL;
      const targets = new Map();
      cNodes.forEach(n => {
        (n.connections || []).forEach(conn => {
          if (!targets.has(conn.target)) targets.set(conn.target, []);
          targets.get(conn.target).push(n);
        });
      });
      targets.forEach((srcNodes, target) => {
        const edgeKey = `${cellKey}→${target}`;
        if (addedEdges.has(edgeKey)) return;
        addedEdges.add(edgeKey);
        const sx = cellCX, sy = cellCY;
        let tx = HOME_CX, ty = HOME_CY, tgtHW = HOME_HW, tgtHH = HOME_HH;
        if (target !== 'home') {
          const tj = parseInt(target);
          if (isNaN(tj) || tj >= nodes.length) return;
          const tn = nodes[tj];
          tx = HOME_CX + (tn.x || 0) * CELL;
          ty = HOME_CY + (tn.y || 0) * CELL;
          tgtHW = GEOM.BASE_R * (SIZE_FACTOR[tn.size] || 1.0);
          tgtHH = tgtHW * GEOM.BTN_HEIGHT;
        }
        const srcNode = srcNodes[0];
        const srcHW = GEOM.BASE_R * (SIZE_FACTOR[srcNode.size] || 1.0);
        const srcHH = srcHW * GEOM.BTN_HEIGHT;
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 1) return;
        const ux = dx / dist, uy = dy / dist;

        const frameHalf = CELL * GEOM.FRAME_HALF;
        const srcMulti = cNodes.length > 1;
        const srcDist = srcMulti ? this._rayRect(frameHalf, frameHalf, ux, uy) : (button ? this._rayRect(srcHW, srcHH, ux, uy) : srcHW);
        let tgtMulti = false;
        if (target !== 'home') {
          const tj = parseInt(target);
          if (!isNaN(tj) && tj < nodes.length) {
            const tKey = `${nodes[tj].x??0},${nodes[tj].y??0}`;
            tgtMulti = (cellNodes[tKey]?.length || 0) > 1;
          }
        }
        const tgtDist = tgtMulti ? this._rayRect(frameHalf, frameHalf, ux, uy) : (button ? this._rayRect(tgtHW, tgtHH, ux, uy) : tgtHW);
        const x1 = sx + ux * srcDist;
        const y1 = sy + uy * srcDist;
        const x2 = tx - ux * tgtDist;
        const y2 = ty - uy * tgtDist;

        // Grid-Koordinaten für Routing-Check
        const srcGX = cx, srcGY = cy;
        let tgtGX = 0, tgtGY = 0; // Home
        if (target !== 'home') {
          const tj = parseInt(target);
          if (!isNaN(tj) && tj < nodes.length) {
            tgtGX = nodes[tj].x || 0;
            tgtGY = nodes[tj].y || 0;
          }
        }

        // Prüfen ob direkte Linie durch besetzte Zellen führt
        let pathD;
        if (srcGX === tgtGX && srcGY === tgtGY) {
          // Gleiche Zelle (z.B. Home→Home) → direkt
          pathD = `M${x1},${y1} L${x2},${y2}`;
        } else {
          const lineCells = this._lineCells(srcGX, srcGY, tgtGX, tgtGY);
          const isBlocked = lineCells.some(cell => {
            if (cell === `${srcGX},${srcGY}` || cell === `${tgtGX},${tgtGY}`) return false;
            return occupied.has(cell);
          });

          if (!isBlocked) {
            // Kein Hindernis → direkte Linie
            pathD = `M${x1},${y1} L${x2},${y2}`;
          } else {
            // Hindernis → Grid-Pfad suchen
            const gridPath = this._findGridPath(srcGX, srcGY, tgtGX, tgtGY, occupied);
            const simplePath = this._simplifyPath(gridPath);

            // Grid→SVG umrechnen
            const waypoints = simplePath.map(p => ({
              x: HOME_CX + p.x * CELL,
              y: HOME_CY + p.y * CELL
            }));

            // Ersten Punkt an Source-Rand anpassen (Richtung → erster Waypoint)
            if (waypoints.length >= 2) {
              const dx0 = waypoints[1].x - waypoints[0].x;
              const dy0 = waypoints[1].y - waypoints[0].y;
              const d0 = Math.sqrt(dx0*dx0 + dy0*dy0);
              if (d0 > 0.1) {
                const ux0 = dx0 / d0, uy0 = dy0 / d0;
                const sd0 = srcMulti ? this._rayRect(frameHalf, frameHalf, ux0, uy0) : (button ? this._rayRect(srcHW, srcHH, ux0, uy0) : srcHW);
                waypoints[0].x = sx + ux0 * sd0;
                waypoints[0].y = sy + uy0 * sd0;
              } else {
                waypoints[0].x = x1; waypoints[0].y = y1;
              }

              // Letzten Punkt an Target-Rand anpassen (Richtung ← vorletzter Waypoint)
              const lastI = waypoints.length - 1;
              const dxL = waypoints[lastI].x - waypoints[lastI-1].x;
              const dyL = waypoints[lastI].y - waypoints[lastI-1].y;
              const dL = Math.sqrt(dxL*dxL + dyL*dyL);
              if (dL > 0.1) {
                const uxL = dxL / dL, uyL = dyL / dL;
                const tdL = tgtMulti ? this._rayRect(frameHalf, frameHalf, uxL, uyL) : (button ? this._rayRect(tgtHW, tgtHH, uxL, uyL) : tgtHW);
                waypoints[lastI].x = tx - uxL * tdL;
                waypoints[lastI].y = ty - uyL * tdL;
              } else {
                waypoints[lastI].x = x2; waypoints[lastI].y = y2;
              }
            }

            const pts = waypoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
            pathD = `M${pts}`;
          }
        }

        const lColor = this._toHex(srcNode.color) || '#4fc3f7';
        let tgtColor = lColor;
        if (target === 'home') tgtColor = homeColor;
        else {
          const tj = parseInt(target);
          if (!isNaN(tj) && tj < nodes.length) tgtColor = this._toHex(nodes[tj].color) || '#4fc3f7';
        }
        const gradId = `pn-eg-${uid}-${cellKey.replace(',','_')}-${target}`;
        edgeGrads.push(`<linearGradient id="${gradId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${lColor}"/><stop offset="100%" stop-color="${tgtColor}"/></linearGradient>`);
        edgeLines.push(`<path class="pn-edge" data-cell="${cellKey}" d="${pathD}" fill="none" stroke="url(#${gradId})" stroke-width="${lineW}" opacity="${GEOM.EDGE_OPACITY}" stroke-dasharray="${lineW*GEOM.EDGE_DASH},${lineW}" stroke-linecap="butt" stroke-linejoin="round"/>`);
      });
    });
    const edgesSvg = edgeLines.length ? `<g class="pn-edges">${edgeLines.join('')}</g>` : '';
    const gradsSvg = edgeGrads.length ? `<defs>${edgeGrads.join('')}</defs>` : '';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; box-sizing: border-box; font-family: Roboto, sans-serif; background: var(--ha-card-background, var(--card-background-color)); border-radius: var(--ha-card-border-radius, 12px); border: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(128,128,128,0.3))); box-shadow: var(--ha-card-box-shadow, none); }
        .pn-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .pn-svg { width: 88px; height: 88px; overflow: visible; transform: scale(${scale}); transform-origin: center; }
        .pn-home-shape { ${shapeFill} ${shapeStroke} ${shapeFilter} }
        .pn-node-shape { ${shapeFill} ${shapeFilter} ${button ? `stroke: url(#pn-btn-stroke-${uid}); stroke-width: 1.0;` : ''} }
        .pn-home-power { fill: ${homeColor}; text-anchor: middle; font-weight: 600; }
        .pn-home-label { text-anchor: middle; }
        .pn-btn-highlight { fill: rgba(255,255,255,0.20); }
        .pn-cell-frame { stroke: rgba(255,255,255,${GEOM.FRAME_OPACITY}); stroke-width: 1.2; stroke-dasharray: 4,4; fill: none; }
        .pn-node-group { cursor: pointer; }
        /* Flusslinien-Animation: forward = aus Knoten heraus, reverse = in Knoten hinein */
        .pn-edge { animation: pn-flow-fwd 1s linear infinite; }
        .pn-edge.rev { animation: pn-flow-rev 1s linear infinite; }
        .pn-edge.still { animation: none; }
        @keyframes pn-flow-fwd { to { stroke-dashoffset: -${dashTotal}; } }
        @keyframes pn-flow-rev { to { stroke-dashoffset: ${dashTotal}; } }
      </style>
      <div class="pn-container">
        <svg class="pn-svg" viewBox="0 0 100 115" preserveAspectRatio="xMidYMid meet">
          ${buttonDefs}
          ${gradsSvg}
          ${edgesSvg}
          ${nodes.length ? `<g class="pn-nodes">${nodeSvgs}</g>` : ''}
          ${groupFrames ? `<g class="pn-cell-frames">${groupFrames}</g>` : ''}
          <g class="pn-home-group">
            ${button
              ? `<rect class="pn-home-shape" x="${HOME_CX - HOME_HW}" y="${HOME_CY - HOME_HH}" width="${HOME_HW*2}" height="${HOME_HH*2}" rx="${Math.round(GEOM.HOME_CORNER*HOME_SF)}"/>
                 <rect class="pn-btn-highlight" x="${HOME_CX - HOME_HW + 5}" y="${HOME_CY - HOME_HH + 3}" width="${HOME_HW*0.32}" height="${HOME_HH*0.28}" rx="4"/>`
              : `<circle class="pn-home-shape" cx="${HOME_CX}" cy="${HOME_CY}" r="${HOME_HW}"/>`
            }
            <foreignObject x="${homeFoX}" y="${homeFoY}" width="${homeFoSize}" height="${homeFoSize}">
              <div style="transform:scale(${homeIconSc});transform-origin:center;display:flex;align-items:center;justify-content:center;width:${homeFoSize}px;height:${homeFoSize}px;">
                <ha-icon icon="${homeIcon || 'mdi:home'}" style="--mdc-icon-size:${homeIconPx}px;color:${homeColor};"></ha-icon>
              </div>
            </foreignObject>
            <text class="pn-home-label" x="${HOME_CX}" y="${homeLabelY}" fill="${nodeNameColor}" font-size="${homeFontSize}">${homeName || 'Haus'}</text>
            <text class="pn-home-power" x="${HOME_CX}" y="${homePowerY}" font-size="${homeFontSize}"></text>
          </g>
        </svg>
      </div>
    `;

    this._updateValues();

    // Click-Handler: Home
    const homeGroup = this.shadowRoot.querySelector('.pn-home-group');
    homeGroup.style.cursor = 'pointer';
    homeGroup.addEventListener('click', () => {
      const ta = (c.home?.tap_action) || { action: "more-info" };
      if (ta.action === "more-info" && c.home?.entity) {
        this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: c.home.entity } }));
      }
    });

    // Click-Handler: Nodes
    nodes.forEach((n, i) => {
      const ng = this.shadowRoot.querySelector(`.pn-node-${i}`);
      if (!ng) return;
      ng.addEventListener('click', () => {
        const ta = n.tap_action || { action: "more-info" };
        if (ta.action === "more-info" && n.entity) {
          this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: n.entity } }));
        }
      });
    });
  }
}

customElements.define("power-nexus-card", PowerNexus);

// ─── Mehrsprachigkeit (i18n) ─────────────────────────────────────────────────
// Sprachumschaltung: HA-Sprache oder Browser-Sprache. Nur DE/EN, Rest → EN.
const EDITOR_LANG = {
  de: {
    general: 'Allgemeine Einstellungen', home: 'Heim', nodes: 'Knoten',
    addNode: '+ Knoten hinzufügen', removeNode: 'Knoten entfernen',
    moveUp: 'Nach oben', moveDown: 'Nach unten', nodeDefault: 'Knoten',
    zoom: 'Zoom', spacing: 'Knotenabstand', lineWidth: 'Linienstärke',
    buttonMode: 'Button-Modus',
    nodeNameColor: 'Farbe für Knotenname',
    name: 'Name', icon: 'Icon', color: 'Farbe', homeEntity: 'Entität', entity: 'Entität Import',
    entity2: 'Entität Export', size: 'Größe', slot: 'Slot (0–3)',
    xPos: 'X-Position', yPos: 'Y-Position',
    connections: 'Verbindungen', addConn: '+ Verbindung', delConn: 'Verbindung entfernen',
    invertFlow: 'Flussrichtung invertieren',
    sizeS: 'S – Klein', sizeM: 'M – Mittel', sizeL: 'L – Groß',
    entitySumHint: 'Anzeige = Summe aus Import + Export'
  },
  en: {
    general: 'General Settings', home: 'Home', nodes: 'Nodes',
    addNode: '+ Add node', removeNode: 'Remove node',
    moveUp: 'Move up', moveDown: 'Move down', nodeDefault: 'Node',
    zoom: 'Zoom', spacing: 'Node Spacing', lineWidth: 'Line Width',
    buttonMode: 'Button Mode',
    nodeNameColor: 'Color for Node Name',
    name: 'Name', icon: 'Icon', color: 'Color', homeEntity: 'Entity', entity: 'Entity Import',
    entity2: 'Entity Export', size: 'Size', slot: 'Slot (0–3)',
    xPos: 'X Position', yPos: 'Y Position',
    connections: 'Connections', addConn: '+ Connection', delConn: 'Remove connection',
    invertFlow: 'Invert flow direction',
    sizeS: 'S – Small', sizeM: 'M – Medium', sizeL: 'L – Large',
    entitySumHint: 'Display = sum of Import + Export'
  }
};

// ─── Editor-Klasse ────────────────────────────────────────────────────────────
class PowerNexusEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};   // Lokale Kopie der Card-Config
    this._hass = null;
  }

  _t(key) {
    const lang = (this._hass?.language || navigator.language || 'en').startsWith('de') ? 'de' : 'en';
    return EDITOR_LANG[lang]?.[key] || EDITOR_LANG.en[key] || key;
  }

  set hass(h) { this._hass = h; }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));
    if (!this._config.general) this._config.general = { knoten_zoom: 1.0, knoten_abstand: 195, button_mode: false };
    if (!this._config.home) this._config.home = { name: "Haus", icon: "mdi:home", color: "#ffab40", entity: "", entity2: "", tap_action: { action: "more-info" } };
    if (!this._config.nodes) this._config.nodes = [];
    // Fehlende Properties pro Node mit Defaults belegen
    this._config.nodes.forEach(n => { if (!n.connections) n.connections = []; if (!n.size) n.size = "M"; if (n.slot === undefined) n.slot = 0; if (n.invert_flow === undefined) n.invert_flow = false; });
    this._render();
  }

  _fireChange() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      bubbles: true, composed: true,
      detail: { config: this._config }
    }));
  }

  _addNode() {
    const occupied = new Set(this._config.nodes.map(n => `${n.x ?? 0},${n.y ?? 0}`));
    let x = 0, y = 0;
    for (let d = 1; d <= 20; d++) {
      const candidates = [
        [-d, 0], [d, 0], [0, -d], [0, d],
        [-d, -d], [d, -d], [-d, d], [d, d]
      ];
      const free = candidates.find(([cx, cy]) => !occupied.has(`${cx},${cy}`));
      if (free) { x = free[0]; y = free[1]; break; }
    }
    this._config.nodes.push({
      name: this._t('nodeDefault') + " " + (this._config.nodes.length + 1),
      icon: "mdi:help-circle",
      color: "#4fc3f7",
      size: "M",
      slot: 0,
      invert_flow: false,
      entity: "",
      entity2: "",
      tap_action: { action: "more-info" },
      connections: [],
      x, y
    });
    this._fireChange();
    this._render();
  }

  _removeNode(idx) {
    this._config.nodes.splice(idx, 1);
    this._config.nodes.forEach(n => {
      (n.connections || []).forEach(conn => {
        const t = parseInt(conn.target);
        if (!isNaN(t) && t > idx) conn.target = String(t - 1);
        else if (t === idx) conn.target = 'home';
      });
    });
    this._fireChange();
    this._render();
  }

  _moveNode(idx, dir) {
    const nodes = this._config.nodes;
    const other = idx + dir;
    if (other < 0 || other >= nodes.length) return;
    [nodes[idx], nodes[other]] = [nodes[other], nodes[idx]];
    nodes.forEach(n => {
      (n.connections || []).forEach(conn => {
        const t = parseInt(conn.target);
        if (isNaN(t)) return;
        if (t === idx) conn.target = String(other);
        else if (t === other) conn.target = String(idx);
      });
    });
    this._fireChange();
    this._render();
  }

  // ── Verbindungen ───────────────────────────────────────────────────────

  _addConnection(idx) {
    if (isNaN(idx) || idx < 0 || idx >= this._config.nodes.length) return;
    const node = this._config.nodes[idx];
    if (!node.connections) node.connections = [];
    node.connections.push({ target: 'home' });
    this._fireChange();
    this._render();
  }

  _removeConnection(idx, ci) {
    if (isNaN(idx) || isNaN(ci)) return;
    const conns = this._config.nodes[idx]?.connections;
    if (!conns || ci >= conns.length) return;
    conns.splice(ci, 1);
    this._fireChange();
    this._render();
  }

  _renderNodeConns(idx) {
    const node = this._config.nodes[idx];
    const conns = node.connections || [];
    const wrap = this.shadowRoot.getElementById('pn-node-conns-' + idx);
    if (!wrap) return;

    const otherNodes = this._config.nodes;

    wrap.innerHTML = conns.map((conn, ci) => {
      // Optionen pro Connection neu bauen – sonst kein selected auf Nicht-Home-Zielen
      const targetOpts = otherNodes.map((n2, j) =>
        j !== idx ? `<option value="${j}" ${String(conn.target) === String(j) ? 'selected' : ''}>${esc(n2.name || this._t('nodeDefault')+' '+(j+1))}</option>` : ''
      ).join('');
      return `
      <div class="pn-ed-conn-row">
        <select class="pn-ed-conn-target" data-idx="${idx}" data-ci="${ci}">
          <option value="home" ${conn.target === 'home' ? 'selected' : ''}>Haus</option>
          ${targetOpts}
        </select>
        <button class="pn-ed-btn-rm-conn" data-idx="${idx}" data-ci="${ci}" title="${this._t('delConn')}">✕</button>
      </div>
    `}).join('');

    wrap.querySelectorAll('.pn-ed-conn-target').forEach(sel => {
      sel.addEventListener('change', () => {
        const ci = parseInt(sel.dataset.ci);
        if (isNaN(ci)) return;
        const conns = this._config.nodes[idx]?.connections;
        if (conns && ci < conns.length) {
          conns[ci].target = sel.value;
          this._fireChange();
        }
      });
    });

    wrap.querySelectorAll('.pn-ed-btn-rm-conn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeConnection(parseInt(btn.dataset.idx), parseInt(btn.dataset.ci));
      });
    });
  }

  _render() {
    const openBodies = new Set();
    if (this.shadowRoot) {
      this.shadowRoot.querySelectorAll('.pn-ed-card-body:not(.pn-ed-collapsed)').forEach(b => openBodies.add(b.id));
    }

    const c = this._config;
    const nodes = c.nodes || [];

    const nodeCards = nodes.map((n, i) => `
      <div class="pn-ed-card">
        <div class="pn-ed-card-hdr pn-ed-toggle" data-target="pn-node-body-${i}">
          <span class="pn-ed-chevron">▶</span>
          <span class="pn-ed-card-title">${esc(n.name || this._t('nodeDefault') + ' ' + (i+1))}</span>
          <button class="pn-ed-btn-mv" data-idx="${i}" data-dir="-1" title="${this._t('moveUp')}">▲</button>
          <button class="pn-ed-btn-mv" data-idx="${i}" data-dir="1" title="${this._t('moveDown')}">▼</button>
          <button class="pn-ed-btn-rm" data-idx="${i}" title="${this._t('removeNode')}">✕</button>
        </div>
        <div class="pn-ed-card-body pn-ed-collapsed" id="pn-node-body-${i}">
          <div id="pn-node-form-${i}"></div>
        </div>
      </div>
    `).join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 16px; }
        .pn-ed-chevron {
          font-size: 11px; transition: transform 0.2s; display: inline-block; width: 14px;
        }
        .pn-ed-chevron.open { transform: rotate(90deg); }
        .pn-ed-collapsed { display: none; }
        .pn-ed-card {
          border: 1px solid var(--divider-color, #e0e0e0); border-radius: 6px;
          margin-bottom: 8px; background: var(--card-background-color, #fff);
        }
        .pn-ed-card-hdr {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 10px; background: var(--secondary-background-color, #f5f5f5);
          border-radius: 6px; min-height: 22px;
        }
        .pn-ed-card-hdr.pn-ed-toggle { cursor: pointer; user-select: none; }
        .pn-ed-card:has(.pn-ed-collapsed) .pn-ed-card-hdr { border-radius: 6px; }
        .pn-ed-card:not(:has(.pn-ed-collapsed)) .pn-ed-card-hdr { border-radius: 6px 6px 0 0; }
        .pn-ed-card-title { font-weight: 500; font-size: 13px; flex: 1; }
        .pn-ed-btn-rm {
          background: none; border: none; color: var(--error-color, #e53935);
          cursor: pointer; font-size: 15px; padding: 2px 6px; border-radius: 4px;
          flex-shrink: 0;
        }
        .pn-ed-btn-rm:hover { background: rgba(229,57,53,0.1); }
        .pn-ed-btn-mv {
          background: none; border: none; color: var(--secondary-text-color, #999);
          cursor: pointer; font-size: 10px; padding: 2px 4px; border-radius: 3px;
          flex-shrink: 0; line-height: 1;
        }
        .pn-ed-btn-mv:hover { background: var(--divider-color, rgba(128,128,128,0.15)); color: var(--primary-text-color, #212121); }
        .pn-ed-card-body { padding: 10px 12px; }
        .pn-ed-lbl {
          display: block; font-size: 12px; color: var(--secondary-text-color, #757575);
          margin: 10px 0 4px;
        }
        .pn-ed-lbl:first-child { margin-top: 0; }
        .pn-ed-hint { font-size: 11px; color: var(--secondary-text-color, #999); margin: 2px 0 8px; font-style: italic; }
        .pn-ed-inp {
          width: 100%; box-sizing: border-box; padding: 8px 10px;
          border: 1px solid var(--divider-color, #e0e0e0); border-radius: 4px;
          font-size: 13px; background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #212121);
        }
        .pn-ed-inp:focus { border-color: var(--primary-color, #03a9f4); outline: none; }
        .pn-ed-inp[type="color"] { width: 50px; height: 32px; padding: 2px; }
        .pn-ed-chk { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; }
        .pn-ed-slider { display: flex; align-items: center; gap: 10px; }
        .pn-ed-slider input[type="range"] { flex: 1; }
        .pn-ed-slider-val { font-size: 13px; font-weight: 600; min-width: 36px; text-align: right; color: var(--primary-text-color, #212121); }
        ha-icon-picker, ha-entity-picker { width: 100%; display: block; }
        .pn-ed-btn-add {
          width: 100%; padding: 10px; background: var(--primary-color, #03a9f4);
          color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; margin-top: 4px;
        }
        .pn-ed-btn-add:hover { opacity: 0.9; }
        .pn-ed-conn-sec { margin-top: 4px; }
        .pn-ed-conn-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .pn-ed-conn-row select { width: 100px; padding: 6px; border: 1px solid var(--divider-color, #e0e0e0); border-radius: 4px; font-size: 13px; background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); }
        .pn-ed-btn-rm-conn { background: none; border: none; color: var(--error-color, #e53935); cursor: pointer; font-size: 15px; padding: 2px 4px; border-radius: 4px; flex-shrink: 0; }
        .pn-ed-btn-rm-conn:hover { background: rgba(229,57,53,0.1); }
        .pn-ed-btn-conn-add { width: 100%; padding: 6px; background: none; border: 1px dashed var(--divider-color, #ccc); border-radius: 6px; font-size: 12px; cursor: pointer; color: var(--secondary-text-color, #757575); }
        .pn-ed-btn-conn-add:hover { border-color: var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); }
      </style>
      <div class="pn-ed-card">
        <div class="pn-ed-card-hdr pn-ed-toggle" data-target="pn-general-body">
          <span class="pn-ed-chevron">▶</span>
          <span class="pn-ed-card-title">${this._t('general')}</span>
        </div>
        <div class="pn-ed-card-body pn-ed-collapsed" id="pn-general-body">
          <div id="pn-general-form"></div>
        </div>
      </div>
      <div class="pn-ed-sec-hdr" style="cursor:default;border-bottom:none;padding-bottom:4px;margin-top:14px;margin-bottom:6px;">
        <span class="pn-ed-chevron" style="visibility:hidden;">▶</span> ${this._t('nodes')}
      </div>
      <div class="pn-ed-card" style="margin-bottom:18px;">
        <div class="pn-ed-card-hdr pn-ed-toggle" data-target="pn-home-body">
          <span class="pn-ed-chevron">▶</span>
          <span class="pn-ed-card-title">${this._t('home')}</span>
        </div>
        <div class="pn-ed-card-body pn-ed-collapsed" id="pn-home-body">
          <div id="pn-home-form"></div>
        </div>
      </div>
      <div class="pn-ed-sec">
        ${nodeCards}
        <button class="pn-ed-btn-add" id="pn-add-node">${this._t('addNode')}</button>
      </div>
    `;

    // Offene Sections wiederherstellen
    openBodies.forEach(id => {
      const body = this.shadowRoot.getElementById(id);
      if (body) {
        body.classList.remove('pn-ed-collapsed');
        const hdr = this.shadowRoot.querySelector(`[data-target="${id}"]`);
        if (hdr) { const chev = hdr.querySelector('.pn-ed-chevron'); if (chev) chev.classList.add('open'); }
      }
    });

    this.shadowRoot.querySelectorAll('.pn-ed-toggle').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        if (e.target.closest('.pn-ed-btn-rm') || e.target.closest('.pn-ed-btn-mv')) return;
        const targetId = hdr.dataset.target;
        const body = this.shadowRoot.getElementById(targetId);
        const chevron = hdr.querySelector('.pn-ed-chevron');
        if (!body || !chevron) return;
        body.classList.toggle('pn-ed-collapsed');
        chevron.classList.toggle('open');
      });
    });

    // -- Allgemeine Einstellungen --
    const zoomVal = parseFloat(c.general?.knoten_zoom) || 1.0;
    const abstandVal = parseFloat(c.general?.knoten_abstand) || 195;
    const linienVal = parseFloat(c.general?.linien_staerke) || 10;
    const buttonOn = c.general?.button_mode === true;
    const nameColorVal = c.general?.knoten_name_farbe || '#ffffff';
    this.shadowRoot.getElementById('pn-general-form').innerHTML = `
      <label class="pn-ed-lbl">${this._t('zoom')}</label>
      <div class="pn-ed-slider">
        <input type="range" min="0.5" max="2.5" step="0.1" id="pn-knoten-zoom" value="${zoomVal}">
        <span class="pn-ed-slider-val" id="pn-zoom-val">${zoomVal.toFixed(1)}</span>
      </div>
      <label class="pn-ed-lbl">${this._t('spacing')}</label>
      <div class="pn-ed-slider">
        <input type="range" min="120" max="350" step="5" id="pn-knoten-abstand" value="${abstandVal}">
        <span class="pn-ed-slider-val" id="pn-abstand-val">${abstandVal}</span>
      </div>
      <label class="pn-ed-lbl">${this._t('lineWidth')}</label>
      <div class="pn-ed-slider">
        <input type="range" min="2" max="30" step="1" id="pn-linien-staerke" value="${linienVal}">
        <span class="pn-ed-slider-val" id="pn-linien-val">${linienVal}</span>
      </div>
      <label class="pn-ed-chk">
        <input type="checkbox" id="pn-button-mode" ${buttonOn ? 'checked' : ''}> ${this._t('buttonMode')}
      </label>
      <label class="pn-ed-lbl">${this._t('nodeNameColor')}</label>
      <input class="pn-ed-inp" type="color" id="pn-knoten-name-farbe" value="${esc(nameColorVal)}">
    `;
    const zoomSlider = this.shadowRoot.getElementById('pn-knoten-zoom');
    const zoomDisp = this.shadowRoot.getElementById('pn-zoom-val');
    const abstandSlider = this.shadowRoot.getElementById('pn-knoten-abstand');
    const abstandDisp = this.shadowRoot.getElementById('pn-abstand-val');
    const linienSlider = this.shadowRoot.getElementById('pn-linien-staerke');
    const linienDisp = this.shadowRoot.getElementById('pn-linien-val');
    const buttonCb = this.shadowRoot.getElementById('pn-button-mode');
    const nameColorInp = this.shadowRoot.getElementById('pn-knoten-name-farbe');
    zoomSlider.addEventListener('input', () => { zoomDisp.textContent = parseFloat(zoomSlider.value).toFixed(1); });
    abstandSlider.addEventListener('input', () => { abstandDisp.textContent = parseFloat(abstandSlider.value).toFixed(0); });
    linienSlider.addEventListener('input', () => { linienDisp.textContent = parseFloat(linienSlider.value).toFixed(0); });
    const saveGeneral = () => {
      this._config.general.knoten_zoom = parseFloat(zoomSlider.value) || 1.0;
      this._config.general.knoten_abstand = parseFloat(abstandSlider.value) || 195;
      this._config.general.linien_staerke = parseFloat(linienSlider.value) || 10;
      this._config.general.button_mode = buttonCb.checked;
      this._config.general.knoten_name_farbe = nameColorInp.value;
      this._fireChange();
    };
    zoomSlider.addEventListener('change', saveGeneral);
    abstandSlider.addEventListener('change', saveGeneral);
    linienSlider.addEventListener('change', saveGeneral);
    buttonCb.addEventListener('change', saveGeneral);
    nameColorInp.addEventListener('change', saveGeneral);

    // -- Home --
    const h = c.home || {};
    this.shadowRoot.getElementById('pn-home-form').innerHTML = `
      <label class="pn-ed-lbl">${this._t('name')}</label>
      <input class="pn-ed-inp" id="pn-home-name" value="${esc(h.name || 'Haus')}">
      <label class="pn-ed-lbl">${this._t('icon')}</label>
      <div id="pn-home-icon-wrap"></div>
      <label class="pn-ed-lbl">${this._t('color')}</label>
      <input class="pn-ed-inp" type="color" id="pn-home-color" value="${esc(h.color || '#ffab40')}">
      <label class="pn-ed-lbl">${this._t('homeEntity')}</label>
      <div id="pn-home-entity-wrap"></div>
    `;
    // Icon-Picker
    const homeIcon = document.createElement('ha-icon-picker');
    homeIcon.value = h.icon || 'mdi:home';
    homeIcon.style.width = '100%';
    homeIcon.addEventListener('value-changed', (e) => { this._config.home.icon = e.detail.value; this._fireChange(); });
    this.shadowRoot.getElementById('pn-home-icon-wrap').appendChild(homeIcon);
    // Entity-Picker
    const homeEntity = document.createElement('ha-entity-picker');
    homeEntity.setAttribute('allow-custom-entity', '');
    homeEntity.setAttribute('hideClearIcon', '');
    homeEntity.value = h.entity || '';
    homeEntity.hass = this._hass;
    homeEntity.style.width = '100%';
    homeEntity.addEventListener('value-changed', (e) => { this._config.home.entity = e.detail.value; this._fireChange(); });
    this.shadowRoot.getElementById('pn-home-entity-wrap').appendChild(homeEntity);
    const hn = this.shadowRoot.getElementById('pn-home-name');
    const hc = this.shadowRoot.getElementById('pn-home-color');
    hn.addEventListener('change', () => { this._config.home.name = hn.value; this._fireChange(); });
    hc.addEventListener('change', () => { this._config.home.color = hc.value; this._fireChange(); });

    // -- Knoten --
    nodes.forEach((n, i) => {
      const wrap = this.shadowRoot.getElementById('pn-node-form-' + i);
      if (!wrap) return;
      wrap.innerHTML = `
        <label class="pn-ed-lbl">${this._t('name')}</label>
        <input class="pn-ed-inp" data-idx="${i}" data-field="name" value="${esc(n.name || '')}">
        <label class="pn-ed-lbl">${this._t('size')}</label>
        <select class="pn-ed-inp" data-idx="${i}" data-field="size" style="width:100%;">
          <option value="S" ${n.size === 'S' ? 'selected' : ''}>${this._t('sizeS')}</option>
          <option value="M" ${n.size === 'M' ? 'selected' : ''}>${this._t('sizeM')}</option>
          <option value="L" ${n.size === 'L' ? 'selected' : ''}>${this._t('sizeL')}</option>
        </select>
        <label class="pn-ed-lbl">${this._t('slot')}</label>
        <input class="pn-ed-inp" type="number" data-idx="${i}" data-field="slot" value="${n.slot ?? 0}" min="0" max="3" style="width:80px;">
        <label class="pn-ed-chk">
          <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="invert_flow" ${n.invert_flow ? 'checked' : ''}> ${this._t('invertFlow')}
        </label>
        <label class="pn-ed-lbl">${this._t('icon')}</label>
        <div id="pn-node-icon-wrap-${i}"></div>
        <label class="pn-ed-lbl">${this._t('color')}</label>
        <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="color" value="${esc(n.color || '#4fc3f7')}">
        <label class="pn-ed-lbl">${this._t('entity')}</label>
        <div id="pn-node-entity-wrap-${i}"></div>
        <label class="pn-ed-lbl">${this._t('entity2')}</label>
        <div id="pn-node-entity2-wrap-${i}"></div>
        <div class="pn-ed-hint">${this._t('entitySumHint')}</div>
        <label class="pn-ed-lbl">${this._t('xPos')}</label>
        <input class="pn-ed-inp" type="number" data-idx="${i}" data-field="x" value="${n.x ?? -1}" style="width:80px;">
        <label class="pn-ed-lbl">${this._t('yPos')}</label>
        <input class="pn-ed-inp" type="number" data-idx="${i}" data-field="y" value="${n.y ?? 0}" style="width:80px;">
        <div class="pn-ed-conn-sec">
          <label class="pn-ed-lbl" style="margin-top:12px;">${this._t('connections')}</label>
          <div id="pn-node-conns-${i}"></div>
          <button class="pn-ed-btn-conn-add" data-idx="${i}">${this._t('addConn')}</button>
        </div>
      `;
      // Icon-Picker
      const ni = document.createElement('ha-icon-picker');
      ni.value = n.icon || '';
      ni.style.width = '100%';
      ni.addEventListener('value-changed', (e) => { this._config.nodes[i].icon = e.detail.value; this._fireChange(); });
      wrap.querySelector('#pn-node-icon-wrap-' + i).appendChild(ni);
      // Entity-Picker
      const ne = document.createElement('ha-entity-picker');
      ne.setAttribute('allow-custom-entity', '');
      ne.setAttribute('hideClearIcon', '');
      ne.value = n.entity || '';
      ne.hass = this._hass;
      ne.style.width = '100%';
      ne.addEventListener('value-changed', (e) => { this._config.nodes[i].entity = e.detail.value; this._fireChange(); });
      wrap.querySelector('#pn-node-entity-wrap-' + i).appendChild(ne);
      // Entity2-Picker
      const ne2 = document.createElement('ha-entity-picker');
      ne2.setAttribute('allow-custom-entity', '');
      ne2.setAttribute('hideClearIcon', '');
      ne2.value = n.entity2 || '';
      ne2.hass = this._hass;
      ne2.style.width = '100%';
      ne2.addEventListener('value-changed', (e) => { this._config.nodes[i].entity2 = e.detail.value; this._fireChange(); });
      wrap.querySelector('#pn-node-entity2-wrap-' + i).appendChild(ne2);
      this._renderNodeConns(i);
    });

    this.shadowRoot.querySelectorAll('.pn-ed-inp[data-idx]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        const field = inp.dataset.field;
        const value = inp.type === 'number' ? parseFloat(inp.value) : inp.value;
        this._config.nodes[idx][field] = value;
        this._fireChange();
      });
    });

    this.shadowRoot.querySelectorAll('.pn-ed-cb[data-idx]').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.idx);
        const field = cb.dataset.field;
        this._config.nodes[idx][field] = cb.checked;
        this._fireChange();
      });
    });

    this.shadowRoot.getElementById('pn-add-node').addEventListener('click', () => this._addNode());

    this.shadowRoot.querySelectorAll('.pn-ed-btn-conn-add').forEach(btn => {
      btn.addEventListener('click', () => this._addConnection(parseInt(btn.dataset.idx)));
    });

    this.shadowRoot.querySelectorAll('.pn-ed-btn-rm').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._removeNode(parseInt(btn.dataset.idx)); });
    });

    this.shadowRoot.querySelectorAll('.pn-ed-btn-mv').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._moveNode(parseInt(btn.dataset.idx), parseInt(btn.dataset.dir));
      });
    });
  }
}

customElements.define('power-nexus-card-editor', PowerNexusEditor);

// ── HA 2026.6 Scoped-Registry-Patch ──────────────────────────────────────────
// Workaround: HA 2026.6 registriert Custom Cards mit "custom:"-Präfix,
// aber CustomElementRegistry.get findet sie nicht ohne Präfix.
// Diese Monkey-Patches sorgen dafür, dass sowohl "power-nexus-card"
// als auch "custom:power-nexus-card" die Klasse zurückgeben.
const _getCE = CustomElementRegistry.prototype.get;
CustomElementRegistry.prototype.get = function (n) {
  return n === 'power-nexus-card' || n === 'custom:power-nexus-card' ? PowerNexus : _getCE.call(this, n);
};
Object.defineProperty(customElements, 'get', {
  value: function (n) {
    return n === 'power-nexus-card' || n === 'custom:power-nexus-card' ? PowerNexus : _getCE.call(this, n);
  },
  configurable: true,
  writable: true
});
const _ceOrig = document.createElement.bind(document);
document.createElement = function (t, o) {
  const tl = t.toLowerCase();
  return tl === 'power-nexus-card' || tl === 'custom:power-nexus-card' ? new PowerNexus() : _ceOrig(t, o);
};

export { PowerNexus };
