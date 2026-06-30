// ─── Power Nexus Card ─────────────────────────────────────────────────────────
// Home Assistant Lovelace Custom Card zur Visualisierung von Energieflüssen
// Version 0.3.19

const CARD_VERSION = "0.3.19";
console.log(`PowerNexusCard v${CARD_VERSION} geladen`, new Date().toLocaleTimeString());

// ─── Geometrie-Konstanten ─────────────────────────────────────────────────────
const GEOM = {
  BASE_R: 50,           // Basis-Radius / Halbe Breite eines M-Knotens (in SVG-Einheiten)
  FO_SIZE: 52,          // foreignObject-Größe (Container für ha-icon im SVG)
  ICON_PX: 22,          // Icon-Pixelgröße (--mdc-icon-size)
  FONT_SIZE: 17,        // Schriftgröße für Knotenname und Leistungswert
  ICON_SCALE: 1.0,      // Icon-Skalierungsfaktor (transform:scale auf Wrapper-Div)
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
const _htmlEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Power Nexus Card – Energiefluss-Visualisierung für Home Assistant
window.customCards = window.customCards || [];
window.customCards.push({
  type: "power-nexus-card",
  name: "Power Nexus Card",
  preview: true,
});

// ─── Card-Klasse ──────────────────────────────────────────────────────────────
class PowerNexus extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._hass = null; this._uid = ++PowerNexus._instances; }
  static _instances = 0;

  // Migrationen alter Keys in neue Struktur
  setConfig(c) {
    c = JSON.parse(JSON.stringify(c || {}));
    // Migration: soc_as_graphic → soc_display
    if (c.general && c.general.soc_as_graphic !== undefined && c.general.soc_display === undefined) {
      c.general.soc_display = c.general.soc_as_graphic ? 'graphic' : 'text';
    }
    if (c.general && c.general.soc_display === undefined) {
      c.general.soc_display = 'text';
    }
    if (c.nodes?.length) {
      c.nodes = c.nodes.map(n => {
        // Migration: entity/entity2 → entity_input/entity_output
        if (n.entity_input === undefined && n.entity !== undefined) { n.entity_input = n.entity; delete n.entity; }
        if (n.entity_output === undefined && n.entity2 !== undefined) { n.entity_output = n.entity2; delete n.entity2; }
        // Migration: x/y → x_position/y_position
        if (n.x_position === undefined && n.x !== undefined) { n.x_position = n.x; delete n.x; }
        if (n.y_position === undefined && n.y !== undefined) { n.y_position = n.y; delete n.y; }
        const node = { size: "M", slot: 0, invert_flow: false, subtract_output: false, hide_mode: "hide", fade_hide_edges: false, nexus_relevant: false, aux_entity: "", aux_bg_color: "#000000", aux_bg_transparent: false, bg_color: "#000000", bg_transparent: false, icon_color: "", power_color: "", aux_color: "", soc_color: "", name_color: "", name_size: 100, icon_size: 100, power_size: 100, aux_size: 100, soc_size: 100, soc_stroke_width: 5, ...n };
        node.slot = Math.max(0, Math.min(3, node.slot ?? 0));
        node.hide_threshold = Math.max(0, node.hide_threshold ?? 0);
        return node;
      });
    }
    c.home = { bg_color: "#000000", bg_transparent: false, size: "L", icon_color: "", power_color: "", name_color: "", name_size: 100, icon_size: 100, power_size: 100, ...(c.home || {}) };
    // Migration: altes bg_opacity → bg_transparent
    if (c.home.bg_opacity !== undefined) { c.home.bg_transparent = c.home.bg_opacity === 0; delete c.home.bg_opacity; }
    this.c = c;
    this._pcache = null; // Cache leeren bei Config-Wechsel
    // Render erst wenn Element im DOM sitzt
    if (this.isConnected) {
      this._render();
    }
  }

  connectedCallback() {
  // Wird aufgerufen sobald Element ins DOM eingefügt wird
    if (this.c) {
      this._render();
    }
  }
  set hass(h) {
    this._hass = h;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._updateValues(), 100);
  }

  _fmtPower(w) {
    const n = parseFloat(w);
    if (isNaN(n)) return "";
    if (!this._pcache) this._pcache = new Map();
    const fullWatt = this.c?.general?.full_watt_display === true;
    const ck = fullWatt ? 'F' + n : String(n);
    const c = this._pcache.get(ck);
    if (c !== undefined) return c;
    const r = fullWatt
      ? n.toFixed(0) + " W"
      : (Math.abs(n) < 1000 ? n.toFixed(0) + " W" : (n / 1000).toFixed(1) + " kW");
    if (this._pcache.size < 80) this._pcache.set(ck, r);
    return r;
  }

  // Prüft ob eine Entität nicht erreichbar ist (unavailable/unknown)
  _isEntityNA(eid) {
    if (!eid || !this._hass?.states[eid]) return false;
    const s = this._hass.states[eid].state;
    return s === 'unavailable' || s === 'unknown';
  }

  // Netto-Leistung eines Knotens (v1 + v2, optional subtrahieren)
  _calcNetPower(v1, v2, subtract) {
    return (v1 || 0) + (subtract ? -1 : 1) * (v2 || 0);
  }

  // Prüft ob ein Knoten unter seinen auto_hide-Schwellwert gefallen ist
  _isNodeBelowThreshold(n) {
    if (!n.auto_hide) return false;
    if (this._isEntityNA(n.entity_input) || this._isEntityNA(n.entity_output)) return false;
    if ((n.entity_input && !this._hass?.states[n.entity_input]) || (n.entity_output && !this._hass?.states[n.entity_output])) return false;
    const threshold = parseFloat(n.hide_threshold) || 0;
    if (threshold <= 0) return false;
    const v1 = (n.entity_input && this._hass?.states[n.entity_input]) ? parseFloat(this._hass.states[n.entity_input].state) || 0 : 0;
    const v2 = (n.entity_output && this._hass?.states[n.entity_output]) ? parseFloat(this._hass.states[n.entity_output].state) || 0 : 0;
    return Math.abs(this._calcNetPower(v1, v2, n.subtract_output)) < threshold;
  }

  static getStubConfig() {
    return {
      general: {
        knoten_zoom: 0.5,
        knoten_abstand: 195,
        button_mode: false,
        flow_speed_by_value: true,
        soc_display: "text",
        full_watt_display: false,
        flow_animation: true,
        show_version: false,
        linien_staerke: 10,
        knoten_name_farbe: "#ffffff"
      },
      home: {
        name: "Nexus",
        icon: "mdi:home",
        color: "#ffab40",
        entity: "",
        size: "L",
        bg_color: "#000000",
        bg_transparent: false,
        icon_color: "",
        power_color: "",
        name_color: "",
        name_size: 100,
        icon_size: 100,
        power_size: 100
      },
      nodes: [
        { name: "Solar", icon: "mdi:solar-power", color: "#ffab40", x_position: -1, y_position: 0, size: "M", auto_hide: false, hide_threshold: 0, fade_hide_edges: false, nexus_relevant: false, aux_entity: "", aux_bg_color: "#000000", aux_bg_transparent: false, bg_color: "#000000", bg_transparent: false, icon_color: "", power_color: "", aux_color: "", soc_color: "", name_color: "", name_size: 100, icon_size: 100, power_size: 100, aux_size: 100, soc_size: 100, soc_stroke_width: 5, subtract_output: false, entity_input: "", entity_output: "", soc_entity: "", connections: [{ target: "home" }] },
        { name: "Battery", icon: "mdi:battery", color: "#4fc3f7", x_position: 1, y_position: 0, size: "M", auto_hide: false, hide_threshold: 0, fade_hide_edges: false, nexus_relevant: false, aux_entity: "", aux_bg_color: "#000000", aux_bg_transparent: false, bg_color: "#000000", bg_transparent: false, icon_color: "", power_color: "", aux_color: "", soc_color: "", name_color: "", name_size: 100, icon_size: 100, power_size: 100, aux_size: 100, soc_size: 100, soc_stroke_width: 5, subtract_output: false, entity_input: "", entity_output: "", soc_entity: "", connections: [{ target: "home" }] },
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
            { name: "knoten_abstand", selector: { number: { min: 120, max: 350, step: 5 } } },
            { name: "button_mode", selector: { boolean: {} } },
            { name: "flow_speed_by_value", selector: { boolean: {} } },
            { name: "soc_display", selector: { select: { options: [{ value: "text", label: "Text" }, { value: "graphic", label: "Grafisch" }, { value: "both", label: "Beides" }] } } },
            { name: "full_watt_display", selector: { boolean: {} } },
            { name: "flow_animation", selector: { boolean: {} } },
            { name: "show_version", selector: { boolean: {} } },
            { name: "linien_staerke", selector: { number: { min: 2, max: 30, step: 1 } } },
            { name: "knoten_name_farbe", selector: { text: { type: "color" } } }
          ]
        },
        {
          type: "expandable",
          name: "home",
          title: "Nexus",
          schema: [
            { name: "name", selector: { text: {} } },
            { name: "icon", selector: { icon: {} } },
            { name: "size", selector: { select: { options: [{ value: "S", label: "S – Klein" }, { value: "M", label: "M – Mittel" }, { value: "L", label: "L – Groß" }] } } },
            { name: "color", selector: { text: { type: "color" } } },
            { name: "entity", selector: { entity: {} } }
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

  _toHex(v, fallback = "#ffab40") {
    if (!v) return fallback;
    if (typeof v === "string") {
      // Theme-Variable (var(--...)) unverändert durchreichen
      if (v.startsWith("var(--")) return v;
      const h = v.replace(/^#/, "");
      if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(h)) return "#" + h;
    }
    return fallback;
  }

  _updateValues() {
    const root = this.shadowRoot;
    if (!root) return;

    const homeEl = this._homeEl;
    if (homeEl) {
      const eid = this.c?.home?.entity;
      let val = "";
      if (eid && this._hass?.states[eid]) {
        const v = parseFloat(this._hass.states[eid].state);
        if (!isNaN(v)) val = this._fmtPower(v);
      } else if (eid) {
        val = "?"; // Entität konfiguriert, aber nicht gefunden
      }
      if (homeEl._pnLast !== val) { homeEl._pnLast = val; homeEl.textContent = val; }
    }

    (this.c?.nodes || []).forEach((n, i) => {
      const cache = this._nodeCache?.[i];
      if (!cache) return;
      const el = cache.powerEl;
      const ng = cache.nodeEl;
      if (el) {
        const na1 = this._isEntityNA(n.entity_input);
        const na2 = this._isEntityNA(n.entity_output);
        const anyNA = na1 || na2;
        const anySet = (n.entity_input && this._hass?.states[n.entity_input]) || (n.entity_output && this._hass?.states[n.entity_output]);
        const v1 = (n.entity_input && this._hass?.states[n.entity_input] && !na1) ? parseFloat(this._hass.states[n.entity_input].state) || 0 : null;
        const v2 = (n.entity_output && this._hass?.states[n.entity_output] && !na2) ? parseFloat(this._hass.states[n.entity_output].state) || 0 : null;
        // Rohwert für Nexus-Summe cachen (vor Formatierung)
        cache._rawPower = anyNA ? null : (anySet ? this._calcNetPower(v1, v2, n.subtract_output) : null);
        if (anyNA) {
          if (el._pnLast !== 'N/A') { el._pnLast = 'N/A'; el.textContent = 'N/A'; }
        } else if (anySet) {
          const pwrTxt = this._fmtPower(this._calcNetPower(v1, v2, n.subtract_output));
          if (el._pnLast !== pwrTxt) { el._pnLast = pwrTxt; el.textContent = pwrTxt; }
        } else {
          const txt = (n.entity_input || n.entity_output) ? '?' : ''; // Entität konfiguriert, aber nicht gefunden
          if (el._pnLast !== txt) { el._pnLast = txt; el.textContent = txt; }
        }
        // Automatisch ausblenden/ausgrauen unterhalb Schwellwert (nicht bei N/A)
        if (ng) {
          const rawPower = this._calcNetPower(v1, v2, n.subtract_output);
          const threshold = parseFloat(n.hide_threshold) || 0;
          ng.classList.remove('pn-hidden', 'pn-faded');
          if (!anyNA && n.auto_hide && threshold > 0 && Math.abs(rawPower) < threshold) {
            const mode = n.hide_mode || 'hide';
          const targetCls = mode === 'fade' ? 'pn-faded' : 'pn-hidden';
          const otherCls = mode === 'fade' ? 'pn-hidden' : 'pn-faded';
          if (ng.classList.contains(otherCls)) ng.classList.remove(otherCls);
          if (!ng.classList.contains(targetCls)) ng.classList.add(targetCls);
          }
          // Icon im Overlay mit aus-/einblenden
          const iw = cache.iconWrap || this.shadowRoot.querySelector(`.pn-icon-node_${i}`);
          if (iw) {
            iw.classList.remove('pn-hidden', 'pn-faded');
            if (ng.classList.contains('pn-hidden')) iw.classList.add('pn-hidden');
            else if (ng.classList.contains('pn-faded')) iw.classList.add('pn-faded');
          }
        }
        // Ladestand (SoC)
        const socEl = cache.socEl;
        const socRing = cache.socRing;
        const socBar = cache.socBar;
        const socBarBg = cache.socBarBg;
        const hasSoc = n.soc_entity && this._hass?.states[n.soc_entity];
        const socNA = this._isEntityNA(n.soc_entity);
        const socVal = (hasSoc && !socNA) ? parseFloat(this._hass.states[n.soc_entity].state) || 0 : 0;
        const socPct = Math.max(0, Math.min(100, socVal)) / 100; // 0..1
        const displayMode = this.c?.general?.soc_display || 'text';
        const graphicMode = (displayMode === 'graphic' || displayMode === 'both') && hasSoc;
        const isButton = this.c?.general?.button_mode === true;

        if (socRing) {
          if (graphicMode && !isButton) {
            if (socRing.style.display !== '') socRing.style.display = '';
            const r = parseFloat(socRing.getAttribute('r'));
            const circ = 2 * Math.PI * r;
            const newDash = circ * (1 - socPct);
            if (socRing._pnDash !== newDash) { socRing._pnDash = newDash; socRing.setAttribute('stroke-dashoffset', newDash); }
          } else {
            if (socRing.style.display !== 'none') socRing.style.display = 'none';
          }
        }
        // Hintergrund-Ring / -Balken separat steuern
        const socRingBg = cache.socRingBg;
        if (socRingBg) {
          const dsp = (graphicMode && !isButton) ? '' : 'none';
          if (socRingBg.style.display !== dsp) socRingBg.style.display = dsp;
        }
        if (socBarBg) {
          if (graphicMode && isButton) {
            if (socBarBg.style.display !== '') { socBarBg.style.display = ''; socBar.style.display = ''; }
            const maxW = parseFloat(socBarBg.getAttribute('width'));
            const newW = maxW * socPct;
            if (socBar._pnBarW !== newW) { socBar._pnBarW = newW; socBar.setAttribute('width', newW); }
          } else {
            if (socBarBg.style.display !== 'none') { socBarBg.style.display = 'none'; socBar.style.display = 'none'; }
          }
        }
        if (socEl) {
          if (socNA) {
            if (socEl._pnLast !== 'N/A') { socEl._pnLast = 'N/A'; socEl.textContent = 'N/A'; }
            if (socEl.style.display !== '') socEl.style.display = '';
          } else if ((displayMode === 'text' || displayMode === 'both') && hasSoc) {
            const socTxt = this._hass.states[n.soc_entity].state + '%';
            if (socEl._pnLast !== socTxt) { socEl._pnLast = socTxt; socEl.textContent = socTxt; }
            if (socEl.style.display !== '') socEl.style.display = '';
          } else if (!hasSoc) {
            const txt = n.soc_entity ? '?' : ''; // SoC-Entität konfiguriert, aber nicht gefunden
            if (socEl._pnLast !== txt) { socEl._pnLast = txt; socEl.textContent = txt; }
            if (socEl.style.display !== '') socEl.style.display = '';
          } else {
            if (socEl.style.display !== 'none') socEl.style.display = 'none';
          }
        }
        // Zusatz-Entität (Aux)
        const auxEl = cache.auxEl;
        const auxGrp = cache.auxGroup;
        if (auxEl && auxGrp) {
          const hasAux = n.aux_entity && this._hass?.states[n.aux_entity];
          const auxNA = this._isEntityNA(n.aux_entity);
          if (!hasAux) {
            if (auxGrp.style.display !== 'none') auxGrp.style.display = 'none';
          } else {
            if (auxGrp.style.display !== '') auxGrp.style.display = '';
            if (auxNA) {
              if (auxEl._pnLast !== 'N/A') { auxEl._pnLast = 'N/A'; auxEl.textContent = 'N/A'; }
            } else {
              const raw = this._hass.states[n.aux_entity].state;
              const num = parseFloat(raw);
              let txt;
              if (isNaN(num)) {
                txt = String(raw);
              } else {
                const unit = this._hass.states[n.aux_entity].attributes?.unit_of_measurement || '';
                const fmt = Number(num.toFixed(2));
                txt = unit ? `${fmt} ${unit}` : String(fmt);
              }
              if (auxEl._pnLast !== txt) { auxEl._pnLast = txt; auxEl.textContent = txt; }
            }
          }
        }
      }
    });

    // Nexus-Leistung: Summe aller nexus_relevant-Knoten → überschreibt Home-Entität
    const nexusNodes = (this.c?.nodes || []).filter(n => n.nexus_relevant === true);
    if (nexusNodes.length > 0 && homeEl) {
      let nexusSum = 0;
      let hasNA = false;
      nexusNodes.forEach(n => {
        const i = (this.c?.nodes || []).indexOf(n);
        const cache = this._nodeCache?.[i];
        if (cache && cache._rawPower !== null && cache._rawPower !== undefined) {
          nexusSum += cache._rawPower;
        } else if (cache && cache._rawPower === null) {
          hasNA = true;
        }
      });
      const nexusVal = hasNA ? 'N/A' : this._fmtPower(nexusSum);
      if (homeEl._pnLast !== nexusVal) { homeEl._pnLast = nexusVal; homeEl.textContent = nexusVal; }
    } else if (nexusNodes.length === 0 && homeEl) {
      // Fallback: normale Home-Entity (bereits oben gesetzt, hier nur bestätigen)
      // Falls oben noch nicht gesetzt (kein nexus aber Home-Entity vorhanden), nachholen
      const eid = this.c?.home?.entity;
      if (eid && this._hass?.states[eid]) {
        const v = parseFloat(this._hass.states[eid].state);
        if (!isNaN(v)) {
          const val = this._fmtPower(v);
          if (homeEl._pnLast !== val) { homeEl._pnLast = val; homeEl.textContent = val; }
        }
      }
    }

    // Zell-Summen & Hidden-Status einmalig vorberechnen (statt pro Edge zu wiederholen)
    const allNodes = this.c?.nodes || [];
    const cellSums = new Map();
    const cellAllHidden = new Map();
    const cellEdgesHidden = new Map();
    const cellEdgesFaded = new Map();
    const cellGroups = {};
    allNodes.forEach(n => {
      const ck = `${n.x_position??0},${n.y_position??0}`;
      if (!cellGroups[ck]) { cellGroups[ck] = []; cellSums.set(ck, 0); }
      cellGroups[ck].push(n);
      if (!n.entity_input && !n.entity_output) return;
      const v1 = (n.entity_input && this._hass?.states[n.entity_input]) ? parseFloat(this._hass.states[n.entity_input].state) || 0 : 0;
      const v2 = (n.entity_output && this._hass?.states[n.entity_output]) ? parseFloat(this._hass.states[n.entity_output].state) || 0 : 0;
      const net = this._calcNetPower(v1, v2, n.subtract_output);
      cellSums.set(ck, cellSums.get(ck) + (n.invert_flow ? -net : net));
    });
    Object.entries(cellGroups).forEach(([ck, cNodes]) => {
      const hidden = cNodes.length > 0 && cNodes.every(n => {
        if ((n.hide_mode || 'hide') === 'fade') return false;
        return this._isNodeBelowThreshold(n);
      });
      cellAllHidden.set(ck, hidden);
      // Kanten ausblenden auch bei faded + fade_hide_edges
      const edgesHidden = cNodes.length > 0 && cNodes.every(n => {
        if (!this._isNodeBelowThreshold(n)) return false;
        const mode = n.hide_mode || 'hide';
        if (mode === 'hide') return true;
        if (mode === 'fade') return n.fade_hide_edges === true;
        return false;
      });
      cellEdgesHidden.set(ck, edgesHidden);
      // Kanten ausgrauen wenn ALLE Knoten faded (nicht hide) und nicht alle fade_hide_edges
      const edgesFaded = cNodes.length > 0 && cNodes.every(n => this._isNodeBelowThreshold(n))
        && !cNodes.some(n => (n.hide_mode || 'hide') === 'hide')
        && !cNodes.every(n => n.fade_hide_edges === true);
      cellEdgesFaded.set(ck, edgesFaded);
    });

    root.querySelectorAll('.pn-edge').forEach((edge, eIdx) => {
      const cellKey = edge.dataset.cell;
      if (!cellKey) return;
      const sum = cellSums.get(cellKey) || 0;
      if (cellAllHidden.get(cellKey) || cellEdgesHidden.get(cellKey)) { if (!edge.classList.contains('pn-hidden')) edge.classList.add('pn-hidden'); return; }
      edge.classList.remove('rev', 'still', 'pn-hidden', 'pn-faded');
      // Ausgegraute Kanten wenn Knoten faded ohne fade_hide_edges
      if (cellEdgesFaded.get(cellKey)) {
        if (!edge.classList.contains('pn-faded')) edge.classList.add('pn-faded');
        return;
      }
      if (sum === 0 || isNaN(sum)) { if (!edge.classList.contains('pn-hidden')) edge.classList.add('pn-hidden'); return; }
      edge.classList.remove('pn-hidden');
      if (sum > 0) { if (!edge.classList.contains('rev')) edge.classList.add('rev'); }
      else { edge.classList.remove('rev'); }
      // Statische Pfeile vs. animierte Linien
      const flowAnimOff = this.c?.general?.flow_animation === false;
      if (flowAnimOff) {
        if (!edge.classList.contains('pn-static')) edge.classList.add('pn-static');
        edge.setAttribute('stroke-dasharray', 'none');
        edge.setAttribute('stroke', 'none');
        const fwdG = root.querySelector(`.pn-arrow-fwd-${eIdx}`);
        const revG = root.querySelector(`.pn-arrow-rev-${eIdx}`);
        if (sum > 0) {
          if (fwdG) fwdG.style.display = '';
          if (revG) revG.style.display = 'none';
        } else {
          if (fwdG) fwdG.style.display = 'none';
          if (revG) revG.style.display = '';
        }
      } else {
        edge.classList.remove('pn-static');
        edge.setAttribute('stroke-dasharray', edge.dataset.dash);
        edge.setAttribute('stroke', edge.dataset.stroke);
        const fwdG = root.querySelector(`.pn-arrow-fwd-${eIdx}`);
        const revG = root.querySelector(`.pn-arrow-rev-${eIdx}`);
        if (fwdG) fwdG.style.display = 'none';
        if (revG) revG.style.display = 'none';
      }
      // Flussgeschwindigkeit: wertabhängig (50W→1,8s, 4000W→0,2s) oder fix 2s
      if (this.c?.general?.flow_speed_by_value !== false) {
        const absSum = Math.abs(sum);
        const dur = (Math.max(0.2, Math.min(3, 2 * Math.exp(-absSum / 600)))).toFixed(2) + 's';
        if (edge._pnDur !== dur) { edge._pnDur = dur; edge.style.animationDuration = dur; }
      } else {
        if (edge._pnDur !== '0.8s') { edge._pnDur = '0.8s'; edge.style.animationDuration = '0.8s'; }
      }
    });

    // Zellen-Frames ausblenden wenn alle Knoten der Zelle versteckt sind
    root.querySelectorAll('.pn-cell-frame').forEach(frame => {
      const cellKey = frame.dataset.cell;
      if (!cellKey) return;
      const [gx, gy] = cellKey.split(',').map(Number);
      const cellNodes = (this.c?.nodes || []).filter(n => (n.x_position??0) === gx && (n.y_position??0) === gy);
      if (cellNodes.length === 0) return;
      const allAutoHide = cellNodes.every(n => n.auto_hide);
      const anyVisible = cellNodes.some(n => {
        if (!n.auto_hide) return true;
        if ((n.hide_mode || 'hide') === 'fade') return true;
        return !this._isNodeBelowThreshold(n);
      });
      if (allAutoHide && !anyVisible) {
        if (!frame.classList.contains('pn-hidden')) frame.classList.add('pn-hidden');
      } else {
        frame.classList.remove('pn-hidden');
      }
    });
  }

  // Strahl-Rechteck-Intersection
  _rayRect(hw, hh, ux, uy) {
    const tx = ux !== 0 ? hw / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? hh / Math.abs(uy) : Infinity;
    return Math.min(tx, ty);
  }

  // ─── Grid-Routing: Flusslinien um Knoten herumführen ─────────────────────

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
    let iters = 0;
    const MAX_ITERS = 15000;
    while (queue.length > 0) {
      if (++iters > MAX_ITERS) break;
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

  // Erzeugt Pfeil-Polygone (▷-Form) entlang eines SVG-Pfads
  _generateArrows(pathD, size, color, reverse) {
    const ptsStr = pathD.replace(/^M/, '').split(' L');
    let pts = ptsStr.map(s => { const [x,y] = s.split(',').map(Number); return {x,y}; });
    if (pts.length < 2) return '';
    if (reverse) pts.reverse();
    const spacing = size * 2.8;
    const arrowLen = size * 1.6;
    const arrowHalf = size * 0.7;
    let arrows = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i+1];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const segLen = Math.sqrt(dx*dx + dy*dy);
      if (segLen < 1) continue;
      const ux = dx / segLen, uy = dy / segLen;
      const n = Math.max(1, Math.round(segLen / spacing));
      const step = segLen / n;
      for (let j = 0; j < n; j++) {
        const t = step * (j + 0.5);
        const cx = p1.x + ux * t, cy = p1.y + uy * t;
        const tipX = cx + ux * arrowLen * 0.5, tipY = cy + uy * arrowLen * 0.5;
        const baseX = cx - ux * arrowLen * 0.5, baseY = cy - uy * arrowLen * 0.5;
        const px = -uy * arrowHalf, py = ux * arrowHalf;
        arrows += `<polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${(baseX+px).toFixed(1)},${(baseY+py).toFixed(1)} ${(baseX-px).toFixed(1)},${(baseY-py).toFixed(1)}" fill="${color}" opacity="0.85"/>`;
      }
    }
    return arrows;
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
    const flowAnim = g.flow_animation !== false; // Default: true (animiert)
    const dashTotal = lineW * (1 + GEOM.EDGE_DASH); // Musterlänge für nahtlose Dash-Animation

    // SVG viewBox: 0 0 100 115, Home bei (50,50)
    const HOME_CX = 50, HOME_CY = 50;
    const SIZE_FACTOR = { S: GEOM.SIZE_S, M: GEOM.SIZE_M, L: GEOM.SIZE_L };
    const HOME_SF = SIZE_FACTOR[h.size] || SIZE_FACTOR.L;
    const HOME_HW = Math.round(GEOM.BASE_R * HOME_SF);
    const HOME_HH = Math.round(HOME_HW * GEOM.BTN_HEIGHT);
    const homeIconSizeMul = ((h.icon_size !== undefined ? h.icon_size : 100)) / 100;
    const homeNameSizeMul = ((h.name_size !== undefined ? h.name_size : 100)) / 100;
    const homePowerSizeMul = ((h.power_size !== undefined ? h.power_size : 100)) / 100;
    const homeFoSize = Math.round(GEOM.FO_SIZE * HOME_SF * homeIconSizeMul);
    const homeFoOff = homeFoSize / 2;
    const homeFoX = HOME_CX - homeFoOff;
    const homeFoY = HOME_CY - homeFoOff;
    const homeIconSc = (GEOM.ICON_SCALE * HOME_SF * homeIconSizeMul).toFixed(2);
    const homeIconPx = Math.round(GEOM.ICON_PX * HOME_SF * homeIconSizeMul);
    const homeBaseFontSize = Math.round(GEOM.FONT_SIZE * HOME_SF);
    const homeNameFontSize = Math.round(homeBaseFontSize * homeNameSizeMul);
    const homePowerFontSize = Math.round(homeBaseFontSize * homePowerSizeMul);
    // Text-Positionierung
    const homeNameCapHalf = homeNameFontSize * GEOM.CAP_FRAC;
    const homePowerCapHalf = homePowerFontSize * GEOM.CAP_FRAC;
    const homeVisIconHalf = homeIconPx * parseFloat(homeIconSc) / 2;
    const homeSpace = (button ? HOME_HH : HOME_HW) - homeVisIconHalf;
    const homeOffset = homeSpace * (button ? GEOM.OFFSET_BUTTON : GEOM.OFFSET_CIRCLE);
    const homeLabelY = HOME_CY - ((button ? HOME_HH : HOME_HW) + homeVisIconHalf) / 2 + homeNameCapHalf + homeOffset;
    const homePowerY = HOME_CY + (homeVisIconHalf + (button ? HOME_HH : HOME_HW)) / 2 + homePowerCapHalf - homeOffset;
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
    const shapeFill = button ? `fill: url(#pn-btn-fill-${uid});` : '';
    const shapeStroke = button
      ? `stroke: url(#pn-btn-stroke-${uid}); stroke-width: 1.0;`
      : `stroke: ${homeColor}; stroke-width: 2.5;`;
    const shapeFilter = button ? `filter: url(#pn-btn-shadow-${uid});` : '';

    // Zellen-Häufigkeiten + besetzte Zellen + gruppierte Nodes (ein Durchlauf)
    const cellCount = {};
    const occupied = new Set(['0,0']); // Home ist immer besetzt
    const cellNodes = {};
    nodes.forEach((n, i) => {
      const k = `${n.x_position??0},${n.y_position??0}`;
      cellCount[k] = (cellCount[k] || 0) + 1;
      occupied.add(k);
      if (!cellNodes[k]) cellNodes[k] = [];
      cellNodes[k].push({ ...n, idx: i });
    });

    this._auxBoxes = []; // Für separate Z-Order der Aux-Boxen
    this._iconMeta = {};  // Icon-Metadaten für DOM-API-Erstellung (Safari-Kompatibilität)

    this._ctx = { button, HOME_CX, HOME_CY, CELL, SIZE_FACTOR, nodeNameColor, cellCount,
      HOME_HW, HOME_HH, homeFoSize, homeFoX, homeFoY, homeIconSc, homeIconPx,
      homeNameFontSize, homePowerFontSize, homeLabelY, homePowerY, homeColor, homeName, homeIcon, uid,
      homeBgColor: this._toHex(h.bg_color, '#000000'),
      homeBgTransparent: h.bg_transparent === true,
      homeSize: h.size || 'L',
      homeIconColor: h.icon_color ? this._toHex(h.icon_color) : homeColor,
      homePowerColor: h.power_color ? this._toHex(h.power_color) : homeColor,
      homeNameColor: h.name_color ? this._toHex(h.name_color) : nodeNameColor,
      _auxBoxes: undefined };

    const nodeSvgs = nodes.map((n, i) => this._buildNodeSvg(n, i)).join('');

    // Gestrichelte Rahmen für Multi-Node-Zellen
    const groupFrames = Object.entries(cellCount)
      .filter(([, cnt]) => cnt > 1)
      .map(([key]) => {
        const [gx, gy] = key.split(',').map(Number);
        const gcx = HOME_CX + gx * CELL;
        const gcy = HOME_CY + gy * CELL;
        const fh = CELL * GEOM.FRAME_HALF;
        return `<rect class="pn-cell-frame" data-cell="${key}" x="${gcx - fh}" y="${gcy - fh}" width="${fh*2}" height="${fh*2}" rx="10" fill="none"/>`;
      }).join('');

    // Farben aller Nodes vorberechnen (für Edge-Gradienten)
    const nodeHex = nodes.map(n => this._toHex(n.color, '#4fc3f7'));

    // Verbindungslinien pro Zelle (mit Routing um Knoten herum)
    const edgeLines = [];
    const edgeGrads = [];
    const edgeArrowGroups = [];
    let edgeCnt = 0;
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
          tx = HOME_CX + (tn.x_position || 0) * CELL;
          ty = HOME_CY + (tn.y_position || 0) * CELL;
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
            const tKey = `${nodes[tj].x_position??0},${nodes[tj].y_position??0}`;
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
            tgtGX = nodes[tj].x_position || 0;
            tgtGY = nodes[tj].y_position || 0;
          }
        }

        // Prüfen ob direkte Linie durch besetzte Zellen führt
        let pathD;
        let gx1 = x1, gy1 = y1, gx2 = x2, gy2 = y2; // Gradient-Koordinaten (default: direkt)
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

            // Gradient an ersten/letzten Waypoint des gerouteten Pfads ausrichten
            gx1 = waypoints[0].x; gy1 = waypoints[0].y;
            gx2 = waypoints[waypoints.length - 1].x; gy2 = waypoints[waypoints.length - 1].y;

            const pts = waypoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
            pathD = `M${pts}`;
          }
        }

        const lColor = nodeHex[srcNode.idx];
        let tgtColor = lColor;
        if (target === 'home') tgtColor = homeColor;
        else {
          const tj = parseInt(target);
          if (!isNaN(tj) && tj < nodes.length) tgtColor = nodeHex[tj];
        }
        const gradId = `pn-eg-${uid}-${cellKey.replace(',','_')}-${target}`;
        edgeGrads.push(`<linearGradient id="${gradId}" x1="${gx1}" y1="${gy1}" x2="${gx2}" y2="${gy2}" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${lColor}"/><stop offset="100%" stop-color="${tgtColor}"/></linearGradient>`);
        const dashVal = `${lineW*GEOM.EDGE_DASH},${lineW}`;
        edgeLines.push(`<path class="pn-edge" data-edge="${edgeCnt}" data-cell="${cellKey}" data-dash="${dashVal}" data-stroke="url(#${gradId})" d="${pathD}" fill="none" stroke="url(#${gradId})" stroke-width="${lineW}" opacity="${GEOM.EDGE_OPACITY}" stroke-dasharray="${dashVal}" stroke-linecap="butt" stroke-linejoin="round"/>`);
        if (!flowAnim) {
          edgeArrowGroups.push({
            fwd: this._generateArrows(pathD, lineW, lColor),
            rev: this._generateArrows(pathD, lineW, lColor, true),
            idx: edgeCnt, cellKey
          });
        }
        edgeCnt++;
      });
    });
    const edgesSvg = edgeLines.length ? `<g class="pn-edges">${edgeLines.join('')}</g>` : '';
    const arrowsSvg = edgeArrowGroups.length ? `<g class="pn-arrows">${edgeArrowGroups.map(a => `<g class="pn-arrow-fwd-${a.idx}" data-cell="${a.cellKey}" style="display:none">${a.fwd}</g><g class="pn-arrow-rev-${a.idx}" data-cell="${a.cellKey}" style="display:none">${a.rev}</g>`).join('')}</g>` : '';
    const gradsSvg = edgeGrads.length ? `<defs>${edgeGrads.join('')}</defs>` : '';

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; box-sizing: border-box; font-family: Roboto, sans-serif; background: var(--ha-card-background, var(--card-background-color)); border-radius: var(--ha-card-border-radius, 12px); border: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(128,128,128,0.3))); box-shadow: var(--ha-card-box-shadow, none); }
        .pn-container { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .pn-card-inner { position: relative; width: 88px; height: 88px; transform: scale(${scale}); transform-origin: center; }
        .pn-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; }
        .pn-icon-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
        .pn-home-shape { ${shapeFill} ${shapeStroke} ${shapeFilter} }
        .pn-node-shape { ${shapeFill} ${shapeFilter} ${button ? `stroke: url(#pn-btn-stroke-${uid}); stroke-width: 1.0;` : ''} }
        .pn-home-power { text-anchor: middle; font-weight: 600; }
        .pn-home-label { text-anchor: middle; }
        .pn-btn-highlight { fill: rgba(255,255,255,0.20); }
        .pn-cell-frame { stroke: rgba(255,255,255,${GEOM.FRAME_OPACITY}); stroke-width: 1.2; stroke-dasharray: 4,4; fill: none; }
        .pn-node-group { cursor: pointer; }
        /* Flusslinien-Animation: forward = aus Knoten heraus, reverse = in Knoten hinein */
        .pn-edge { animation: pn-flow-fwd 1s linear infinite; }
        .pn-edge.rev { animation: pn-flow-rev 1s linear infinite; }
        .pn-edge.still { animation: none; }
        .pn-edge.pn-static { animation: none; }
        .pn-node-group.pn-hidden { display: none; }
        .pn-node-group.pn-faded { opacity: 0.25; }
        .pn-edge.pn-hidden { display: none; }
        .pn-edge.pn-faded { opacity: 0.35; animation: none; stroke-dasharray: 4,6; }
        .pn-cell-frame.pn-hidden { display: none; }
        .pn-icon-wrap.pn-hidden { display: none; }
        .pn-icon-wrap.pn-faded { opacity: 0.25; }
        .pn-icon-wrap { display: flex; align-items: center; justify-content: center; }
        .pn-version-badge { position: absolute; top: 4px; left: 6px; font-size: 9px; color: var(--secondary-text-color, #888); opacity: 0.55; pointer-events: none; z-index: 10; }
        @keyframes pn-flow-fwd { to { stroke-dashoffset: -${dashTotal}; } }
        @keyframes pn-flow-rev { to { stroke-dashoffset: ${dashTotal}; } }
      </style>
      <div class="pn-container">
        ${g.show_version === true ? `<div class="pn-version-badge">v${CARD_VERSION}</div>` : ''}
        <div class="pn-card-inner">
          <svg class="pn-svg" viewBox="0 0 100 115" preserveAspectRatio="xMidYMid meet">
            ${buttonDefs}
            ${gradsSvg}
            ${edgesSvg}
            ${arrowsSvg}
            ${this._auxBoxes.length ? `<g class="pn-aux-boxes">${this._auxBoxes.map(b => `<g transform="translate(${b.cx},${b.cy})">${b.html}</g>`).join('')}</g>` : ''}
            ${nodes.length ? `<g class="pn-nodes">${nodeSvgs}</g>` : ''}
            ${groupFrames ? `<g class="pn-cell-frames">${groupFrames}</g>` : ''}
            ${this._buildHomeSvg()}
          </svg>
          <div class="pn-icon-overlay"></div>
        </div>
      </div>
    `;

    this._ctx = null;

    // Icons per DOM-API ausserhalb des SVG erstellen (Safari: foreignObject unbrauchbar)
    const iconOverlay = this.shadowRoot.querySelector('.pn-icon-overlay');
    if (iconOverlay && this._iconMeta) {
      Object.entries(this._iconMeta).forEach(([key, meta]) => {
        const css = this._svgToCss(meta.cx, meta.cy);
        const cssSize = meta.foSize * css.scale;
        const wrap = document.createElement('div');
        wrap.className = `pn-icon-wrap pn-icon-${key}`;
        wrap.style.cssText = `position:absolute;left:${(css.x - cssSize/2).toFixed(1)}px;top:${(css.y - cssSize/2).toFixed(1)}px;width:${cssSize.toFixed(1)}px;height:${cssSize.toFixed(1)}px;`;
        const haIcon = document.createElement('ha-icon');
        haIcon.setAttribute('icon', meta.icon);
        haIcon.style.cssText = `--mdc-icon-size:${meta.iconPx}px;color:${meta.iconColor};transform:scale(${meta.iconSc});transform-origin:50% 50%;`;
        wrap.appendChild(haIcon);
        iconOverlay.appendChild(wrap);
      });
    }
    this._iconMeta = null;

    // DOM-Referenzen cachen – vermeidet querySelector-Lawine in _updateValues
    this._homeEl = this.shadowRoot.querySelector('.pn-home-power');
    this._nodeCache = (this.c?.nodes || []).map((_, i) => ({
      powerEl: this.shadowRoot.querySelector(`.pn-node-power-${i}`),
      nodeEl: this.shadowRoot.querySelector(`.pn-node-${i}`),
      auxEl: this.shadowRoot.querySelector(`.pn-node-aux-${i}`),
      auxGroup: this.shadowRoot.querySelector(`.pn-node-aux-group-${i}`),
      socEl: this.shadowRoot.querySelector(`.pn-node-soc-${i}`),
      socRing: this.shadowRoot.querySelector(`.pn-node-soc-ring-${i}`),
      socRingBg: this.shadowRoot.querySelector(`.pn-node-soc-ring-bg-${i}`),
      socBar: this.shadowRoot.querySelector(`.pn-node-soc-bar-${i}`),
      socBarBg: this.shadowRoot.querySelector(`.pn-node-soc-bar-bg-${i}`),
      iconWrap: this.shadowRoot.querySelector(`.pn-icon-node_${i}`),
    }));

    // Erst nach DOM-Cache aktualisieren – sonst landen Updates auf alten Elementen
    this._updateValues();

    // Click-Handler: Home – immer more-info bei gesetzter Entität
    const homeGroup = this.shadowRoot.querySelector('.pn-home-group');
    homeGroup.style.cursor = 'pointer';
    homeGroup.addEventListener('click', () => {
      if (c.home?.entity) {
        this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: c.home.entity } }));
      }
    });

    // Click-Handler: Nodes – immer more-info bei gesetzter Entität
    nodes.forEach((n, i) => {
      const ng = this.shadowRoot.querySelector(`.pn-node-${i}`);
      if (!ng) return;
      ng.addEventListener('click', () => {
        if (n.entity_input) {
          this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: n.entity_input } }));
        }
      });
      // Click-Handler: Aux-Box – öffnet Zusatz-Entität statt Knoten-Entität
      const auxGrp = this.shadowRoot.querySelector(`.pn-node-aux-group-${i}`);
      if (auxGrp) {
        auxGrp.addEventListener('click', (e) => {
          e.stopPropagation();
          if (n.aux_entity) {
            this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: n.aux_entity } }));
          }
        });
      }
      // Click-Handler: SoC – öffnet soc_entity-Verlauf
      const socEl = this.shadowRoot.querySelector(`.pn-node-soc-${i}`);
      if (socEl && n.soc_entity) {
        socEl.style.cursor = 'pointer';
        socEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: n.soc_entity } }));
        });
      }
    });
  }

  // SVG-viewBox → CSS-Pixel-Mapping (für Icon-Overlay)
  _svgToCss(sx, sy) {
    const vbW = 100, vbH = 115, el = 88;
    const s = Math.min(el / vbW, el / vbH);
    const cw = vbW * s, ch = vbH * s;
    const ox = (el - cw) / 2, oy = (el - ch) / 2;
    return { x: ox + sx * s, y: oy + sy * s, scale: s };
  }

  _buildNodeSvg(n, i) {
    const ctx = this._ctx;
    const sx = n.x_position || 0, sy = n.y_position || 0;
    const cellKey = `${sx},${sy}`;
    const hasNeighbors = (ctx.cellCount[cellKey] || 0) > 1;
    const slot = n.slot ?? 0;
    const d = GEOM.SLOT_DIST;
    const SLOT_DX = [-d, d, -d, d];
    const SLOT_DY = [-d, -d, d, d];
    const cx = ctx.HOME_CX + sx * ctx.CELL + (hasNeighbors ? SLOT_DX[slot] * ctx.CELL : 0);
    const cy = ctx.HOME_CY + sy * ctx.CELL + (hasNeighbors ? SLOT_DY[slot] * ctx.CELL : 0);
    const nColor = this._toHex(n.color, '#4fc3f7');
    const iconColor = n.icon_color ? this._toHex(n.icon_color) : nColor;
    const powerColor = n.power_color ? this._toHex(n.power_color) : nColor;
    const auxColor = n.aux_color ? this._toHex(n.aux_color) : nColor;
    const auxBgColor = this._toHex(n.aux_bg_color, '#000000');
    const socColor = n.soc_color ? this._toHex(n.soc_color) : nColor;
    const nameColor = n.name_color ? this._toHex(n.name_color) : ctx.nodeNameColor;
    const bgColor = this._toHex(n.bg_color, '#000000');
    const nName = n.name || 'Node';
    const nIcon = n.icon || 'mdi:help-circle';
    const sf = ctx.SIZE_FACTOR[n.size] || 1.0;
    const nR = GEOM.BASE_R * sf;
    const halfH = ctx.button ? nR * GEOM.BTN_HEIGHT : nR;
    const nodeNameMul = ((n.name_size !== undefined ? n.name_size : 100)) / 100;
    const nodeIconMul = ((n.icon_size !== undefined ? n.icon_size : 100)) / 100;
    const nodePowerMul = ((n.power_size !== undefined ? n.power_size : 100)) / 100;
    const nodeAuxMul = ((n.aux_size !== undefined ? n.aux_size : 100)) / 100;
    const nodeSocMul = ((n.soc_size !== undefined ? n.soc_size : 100)) / 100;
    const socSw = n.soc_stroke_width ?? 5;  // SoC-Ring/Bar-Strichstärke
    const foSize = Math.round(GEOM.FO_SIZE * sf * nodeIconMul);
    const foOff = foSize / 2;
    const iconSc = (GEOM.ICON_SCALE * sf * nodeIconMul).toFixed(2);
    const iconPx = Math.round(GEOM.ICON_PX * sf * nodeIconMul);
    const baseFontSize = Math.round(GEOM.FONT_SIZE * sf);
    const nameFontSize = Math.round(baseFontSize * nodeNameMul);
    const powerFontSize = Math.round(baseFontSize * nodePowerMul);
    const nameCapHalf = nameFontSize * GEOM.CAP_FRAC;
    const powerCapHalf = powerFontSize * GEOM.CAP_FRAC;
    const visIconHalf = iconPx * parseFloat(iconSc) / 2;
    const space = halfH - visIconHalf;
    const offset = space * (ctx.button ? GEOM.OFFSET_BUTTON : GEOM.OFFSET_CIRCLE);
    const labelY = -(halfH + visIconHalf) / 2 + nameCapHalf + offset;
    const powerY = (visIconHalf + halfH) / 2 + powerCapHalf - offset;
    const shapeEl = ctx.button
      ? `<rect class="pn-node-shape" x="${-nR}" y="${-halfH}" width="${nR*2}" height="${halfH*2}" rx="${Math.round(GEOM.BTN_CORNER*sf)}"/>`
      : `<circle class="pn-node-shape" cx="0" cy="0" r="${nR}" fill="${n.bg_transparent ? 'none' : bgColor}" stroke="${nColor}" stroke-width="2.5"/>`;
    const highlightEl = ctx.button
      ? `<rect class="pn-btn-highlight" x="${-nR+5}" y="${-halfH+2}" width="${nR*0.32}" height="${halfH*0.28}" rx="3"/>`
      : '';
    // Zusatz-Entität (Aux)
    const auxBoxW = Math.round(nR * 1.6);
    const auxBoxH = ctx.button ? Math.round(22 * sf) : Math.round(44 * sf);
    const auxBoxX = -Math.round(auxBoxW / 2);
    const auxBoxY = ctx.button ? Math.round(halfH) - 1 : Math.round(Math.sqrt(Math.max(0, nR * nR - auxBoxX * auxBoxX)));
    const auxBoxFont = Math.round(14 * sf * nodeAuxMul);
    const auxCr = ctx.button ? Math.round(8 * sf) : Math.round(8 * sf);
    const auxFill = ctx.button ? `fill="#1a1d2e" filter="url(#pn-btn-shadow-${ctx.uid})"` : `fill="${n.aux_bg_transparent ? 'none' : auxBgColor}"`;
    const auxStroke = ctx.button ? `stroke="url(#pn-btn-stroke-${ctx.uid})" stroke-width="1.0"` : `stroke="${auxColor}" stroke-width="2"`;
    const auxPath = `M${auxBoxX},${auxBoxY} L${auxBoxX},${auxBoxY+auxBoxH-auxCr} a${auxCr},${auxCr} 0 0,0 ${auxCr},${auxCr} L${auxBoxX+auxBoxW-auxCr},${auxBoxY+auxBoxH} a${auxCr},${auxCr} 0 0,0 ${auxCr},${-auxCr} L${auxBoxX+auxBoxW},${auxBoxY}`;
    const auxValY = ctx.button ? 0.50 : 0.72;
    const auxSvgInner = `<path d="${auxPath}" ${auxFill} ${auxStroke} stroke-linejoin="round"/><text class="pn-node-aux-${i}" x="0" y="${auxBoxY + auxBoxH*auxValY}" font-size="${auxBoxFont}" fill="${auxColor}" text-anchor="middle" dy="0.35em"></text>`;
    // Aux-Box für separate Z-Order vormerken
    if (this._auxBoxes) this._auxBoxes.push({ cx, cy, html: `<g class="pn-node-aux-group-${i}" style="display:none">${auxSvgInner}</g>` });
    // Icon-Metadaten für DOM-API-Erstellung speichern (Safari-Kompatibilität)
    if (this._iconMeta) this._iconMeta[`node_${i}`] = { icon: nIcon, iconSc, iconPx, iconColor, foSize, cx, cy };
    return `
        <g class="pn-node-group pn-node-${i}" transform="translate(${cx},${cy})">
          ${shapeEl}
          ${highlightEl}
          <text class="pn-node-label" x="0" y="${labelY}" font-size="${nameFontSize}" fill="${nameColor}" text-anchor="middle">${_htmlEscape(nName)}</text>
          <text class="pn-node-power-${i}" x="0" y="${powerY}" font-size="${powerFontSize}" fill="${powerColor}" text-anchor="middle" font-weight="600"></text>
          <text class="pn-node-soc-${i}" x="${foOff - 8}" y="0" font-size="${Math.round(baseFontSize * nodeSocMul * 0.75)}" fill="${socColor}" text-anchor="start" dy="0.3em" opacity="0.85"></text>
          ${ctx.button
            ? `<rect class="pn-node-soc-bar-bg-${i}" x="${-nR + 8}" y="${halfH - 4 - socSw}" width="${nR*2 - 16}" height="${socSw}" rx="${(socSw/2).toFixed(1)}" fill="${socColor}" opacity="0.2" style="display:none;"/>
               <rect class="pn-node-soc-bar-${i}" x="${-nR + 8}" y="${halfH - 4 - socSw}" width="0" height="${socSw}" rx="${(socSw/2).toFixed(1)}" fill="${socColor}" opacity="0.85" style="display:none;"/>`
            : `<circle class="pn-node-soc-ring-bg-${i}" cx="0" cy="0" r="${(nR + socSw/2).toFixed(1)}" fill="none" stroke="${socColor}" stroke-width="${socSw}" opacity="0.2" style="display:none;"/>
               <circle class="pn-node-soc-ring-${i}" cx="0" cy="0" r="${(nR + socSw/2).toFixed(1)}" fill="none" stroke="${socColor}" stroke-width="${socSw}" opacity="0.85" stroke-dasharray="${(2 * Math.PI * (nR + socSw/2)).toFixed(1)}" stroke-dashoffset="0" transform="rotate(-90)" style="display:none;"/>`
          }
        </g>
      `;
  }

  _buildHomeSvg() {
    const ctx = this._ctx;
    // Icon-Metadaten für DOM-API-Erstellung speichern (Safari-Kompatibilität)
    if (this._iconMeta) this._iconMeta.home = { icon: ctx.homeIcon || 'mdi:home', iconSc: ctx.homeIconSc, iconPx: ctx.homeIconPx, iconColor: ctx.homeIconColor, foSize: ctx.homeFoSize, cx: ctx.HOME_CX, cy: ctx.HOME_CY };
    return `
          <g class="pn-home-group">
            ${ctx.button
              ? `<rect class="pn-home-shape" x="${ctx.HOME_CX - ctx.HOME_HW}" y="${ctx.HOME_CY - ctx.HOME_HH}" width="${ctx.HOME_HW*2}" height="${ctx.HOME_HH*2}" rx="${Math.round(GEOM.HOME_CORNER * GEOM.SIZE_L)}"/>
                 <rect class="pn-btn-highlight" x="${ctx.HOME_CX - ctx.HOME_HW + 5}" y="${ctx.HOME_CY - ctx.HOME_HH + 3}" width="${ctx.HOME_HW*0.32}" height="${ctx.HOME_HH*0.28}" rx="4"/>`
              : `<circle class="pn-home-shape" cx="${ctx.HOME_CX}" cy="${ctx.HOME_CY}" r="${ctx.HOME_HW}" fill="${ctx.homeBgTransparent ? 'none' : ctx.homeBgColor}"/>`
            }
            <text class="pn-home-label" x="${ctx.HOME_CX}" y="${ctx.homeLabelY}" fill="${ctx.homeNameColor}" font-size="${ctx.homeNameFontSize}">${ctx.homeName || 'Haus'}</text>
            <text class="pn-home-power" x="${ctx.HOME_CX}" y="${ctx.homePowerY}" font-size="${ctx.homePowerFontSize}" fill="${ctx.homePowerColor}"></text>
          </g>`;
  }
}

customElements.define("power-nexus-card", PowerNexus);

// ─── Mehrsprachigkeit (i18n) ─────────────────────────────────────────────────
// Sprachumschaltung: HA-Sprache oder Browser-Sprache. Nur DE/EN, Rest → EN.
const EDITOR_LANG = {
  de: {
    general: 'Allgemeine Einstellungen', home: 'Nexus', nodes: 'Knoten', colors: 'Farben', sizes: 'Größen',
    addNode: '+ Knoten hinzufügen', removeNode: 'Knoten entfernen',
    moveUp: 'Nach oben', moveDown: 'Nach unten', nodeDefault: 'Knoten',
    zoom: 'Zoom', spacing: 'Knotenabstand', lineWidth: 'Linienstärke',
    buttonMode: 'Button-Modus',
    flowSpeedByValue: 'Wertabhängige Geschwindigkeit',
    socDisplay: 'Ladestandsanzeige', socDisplayText: 'Text', socDisplayGraphic: 'Grafisch', socDisplayBoth: 'Beides',
    fullWattDisplay: 'Immer volle Watt-Anzeige',
    flowAnimation: 'Fluss-Animation',
    showVersion: 'Version anzeigen',
    nodeNameColor: 'Farbe für Knotenname',
    name: 'Name', icon: 'Icon', color: 'Rahmen', homeEntity: 'Entität',
    homeSourceEntity: 'Quelle: Entität', homeSourceNexus: 'Quelle: Summe der Nexus-Knoten',
    homeNexusHint: 'Die Anzeige zeigt den Wert dieser Entität – oder die Summe aller Nexus-relevanten Knoten, sobald mindestens einer aktiviert ist.',
    entityInput: 'Entität Input',
    entityOutput: 'Entität Output', size: 'Größe', slot: 'Slot (0–3)',
    subtractOutput: 'Entität Output subtrahieren',
    subtractOutputHint: 'Zieht Entität Output von Entität Input ab (für Geräte die beide Werte positiv melden, z.B. Akku)',
    socEntity: 'Entität Ladestand',
    auxEntity: 'Zusatz-Entität',
    auxBgColor: 'Hintergrund der Zusatzentität',
    iconColor: 'Icon', powerColor: 'Entität', auxColor: 'Zusatz',
    socColor: 'Ladestand', nameColor: 'Name',
    bgColor: 'Hintergrund', bgTransparent: 'Transparent', bgOpacity: 'Deckkraft',
    nameSize: 'Schrift Name', iconSize: 'Icon-Größe', powerSize: 'Schrift Entität', auxSize: 'Schrift Zusatz', socSize: 'Schrift Ladestand', socStrokeWidth: 'Dicke SoC-Grafik',
    xPos: 'X-Position', yPos: 'Y-Position',
    connections: 'Verbindungen', addConn: '+ Verbindung', delConn: 'Verbindung entfernen',
    invertFlow: 'Flussrichtung invertieren',
    autoHide: 'Automatisch ausblenden bei Leistung kleiner:', autoHideThreshold: 'Schwellwert (W)',
    // Nexus-Leistung: Summe aller nexus_relevant-Knoten → überschreibt Home-Entität
    nexusRelevant: 'Für Nexus-Leistung relevant',
    hideMode: 'Ausblendemodus', hideModeHide: 'Ausblenden', hideModeFade: 'Ausgrauen',
    fadeHideEdges: 'Auch Flusslinien ausblenden',
    sizeS: 'S – Klein', sizeM: 'M – Mittel', sizeL: 'L – Groß',
    entitySumHint: 'Standard: Anzeige = Input + Output (abziehbar via Checkbox)',
    dupWarning: 'Doppelte Position',
    dupWarningHint: 'Diese Knoten haben dieselbe Position & denselben Slot – sie überlagern sich. Bitte X/Y oder Slot ändern.'
  },
  en: {
    general: 'General Settings', home: 'Nexus', nodes: 'Nodes', colors: 'Colors', sizes: 'Sizes',
    addNode: '+ Add node', removeNode: 'Remove node',
    moveUp: 'Move up', moveDown: 'Move down', nodeDefault: 'Node',
    zoom: 'Zoom', spacing: 'Node Spacing', lineWidth: 'Line Width',
    buttonMode: 'Button Mode',
    flowSpeedByValue: 'Value-dependent speed',
    socDisplay: 'SoC Display', socDisplayText: 'Text', socDisplayGraphic: 'Graphic', socDisplayBoth: 'Both',
    fullWattDisplay: 'Always show full Watts',
    flowAnimation: 'Flow Animation',
    showVersion: 'Show Version',
    nodeNameColor: 'Color for Node Name',
    name: 'Name', icon: 'Icon', color: 'Frame', homeEntity: 'Entity',
    homeSourceEntity: 'Source: Entity', homeSourceNexus: 'Source: Sum of nexus nodes',
    homeNexusHint: 'The display shows the value of this entity – or the sum of all nexus-relevant nodes once at least one is enabled.',
    entityInput: 'Entity Input',
    entityOutput: 'Entity Output', size: 'Size', slot: 'Slot (0–3)',
    subtractOutput: 'Subtract Entity Output',
    subtractOutputHint: 'Subtracts Entity Output from Input (for devices reporting both values as positive, e.g. battery)',
    socEntity: 'Entity State of Charge',
    auxEntity: 'Aux Entity',
    auxBgColor: 'Aux Entity Background',
    iconColor: 'Icon', powerColor: 'Entity', auxColor: 'Aux',
    socColor: 'SoC', nameColor: 'Name',
    bgColor: 'Background', bgTransparent: 'Transparent', bgOpacity: 'Opacity',
    nameSize: 'Font Name', iconSize: 'Icon Size', powerSize: 'Font Entity', auxSize: 'Font Aux', socSize: 'Font SoC', socStrokeWidth: 'SoC Graphic Thickness',
    xPos: 'X Position', yPos: 'Y Position',
    connections: 'Connections', addConn: '+ Connection', delConn: 'Remove connection',
    invertFlow: 'Invert flow direction',
    autoHide: 'Auto-hide when power below:', autoHideThreshold: 'Threshold (W)',
    // Nexus-Leistung: Summe aller nexus_relevant-Knoten → überschreibt Home-Entität
    nexusRelevant: 'Relevant for Nexus power',
    hideMode: 'Hide mode', hideModeHide: 'Hide', hideModeFade: 'Fade',
    fadeHideEdges: 'Also hide flow lines',
    sizeS: 'S – Small', sizeM: 'M – Medium', sizeL: 'L – Large',
    entitySumHint: 'Default: Display = Input + Output (can be subtracted via checkbox)',
    dupWarning: 'Duplicate position',
    dupWarningHint: 'These nodes share the same position & slot – they overlap. Please change X/Y or slot.'
  }
};

// ─── Editor-Klasse ────────────────────────────────────────────────────────────
class PowerNexusEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    // CSS einmalig – _render() tauscht nur #pn-ed-root
    this.shadowRoot.innerHTML = `<style>
        :host { display: block; padding: 16px; }
        .pn-ed-chevron { font-size: 11px; transition: transform 0.2s; display: inline-block; width: 14px; }
        .pn-ed-chevron.open { transform: rotate(90deg); }
        .pn-ed-collapsed { display: none; }
        .pn-ed-card { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 6px; margin-bottom: 8px; background: var(--card-background-color, #fff); }
        .pn-ed-card-hdr { display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: var(--secondary-background-color, #f5f5f5); border-radius: 6px; min-height: 22px; }
        .pn-ed-card-hdr.pn-ed-toggle { cursor: pointer; user-select: none; }
        .pn-ed-card:has(.pn-ed-collapsed) .pn-ed-card-hdr { border-radius: 6px; }
        .pn-ed-card:not(:has(.pn-ed-collapsed)) .pn-ed-card-hdr { border-radius: 6px 6px 0 0; }
        .pn-ed-card-title { font-weight: 500; font-size: 13px; flex: 1; }
        .pn-ed-btn-rm { background: none; border: none; color: var(--error-color, #e53935); cursor: pointer; font-size: 15px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
        .pn-ed-btn-rm:hover { background: rgba(229,57,53,0.1); }
        .pn-ed-btn-mv { background: none; border: none; color: var(--secondary-text-color, #999); cursor: pointer; font-size: 10px; padding: 2px 4px; border-radius: 3px; flex-shrink: 0; line-height: 1; }
        .pn-ed-btn-mv:hover { background: var(--divider-color, rgba(128,128,128,0.15)); color: var(--primary-text-color, #212121); }
        .pn-ed-card-body { padding: 10px 12px; }
        .pn-ed-lbl { display: block; font-size: 12px; color: var(--secondary-text-color, #757575); margin: 10px 0 4px; }
        .pn-ed-lbl:first-child { margin-top: 0; }
        .pn-ed-hint { font-size: 11px; color: var(--secondary-text-color, #999); margin: 2px 0 8px; font-style: italic; }
        .pn-ed-inp { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--divider-color, #e0e0e0); border-radius: 4px; font-size: 13px; background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); }
        .pn-ed-inp:focus { border-color: var(--primary-color, #03a9f4); outline: none; }
        .pn-ed-inp[type="color"] { width: 50px; height: 32px; padding: 2px; }
        .pn-ed-chk { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; }
        .pn-ed-row { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
        .pn-ed-slider { display: flex; align-items: center; gap: 10px; }
        .pn-ed-slider input[type="range"] { flex: 1; }
        .pn-ed-slider-val { font-size: 13px; font-weight: 600; min-width: 36px; text-align: right; color: var(--primary-text-color, #212121); }
        ha-icon-picker, ha-entity-picker { width: 100%; display: block; }
        .pn-ed-btn-add { width: 100%; padding: 10px; background: var(--primary-color, #03a9f4); color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; margin-top: 4px; }
        .pn-ed-btn-add:hover { opacity: 0.9; }
        .pn-ed-conn-sec { margin-top: 4px; }
        .pn-ed-conn-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .pn-ed-conn-row select { width: 100px; padding: 6px; border: 1px solid var(--divider-color, #e0e0e0); border-radius: 4px; font-size: 13px; background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121); }
        .pn-ed-btn-rm-conn { background: none; border: none; color: var(--error-color, #e53935); cursor: pointer; font-size: 15px; padding: 2px 4px; border-radius: 4px; flex-shrink: 0; }
        .pn-ed-btn-rm-conn:hover { background: rgba(229,57,53,0.1); }
        .pn-ed-btn-conn-add { width: 100%; padding: 6px; background: none; border: 1px dashed var(--divider-color, #ccc); border-radius: 6px; font-size: 12px; cursor: pointer; color: var(--secondary-text-color, #757575); }
        .pn-ed-btn-conn-add:hover { border-color: var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); }
        .pn-ed-sec-hdr { cursor: default; border-bottom: none; padding-bottom: 4px; margin-top: 14px; margin-bottom: 6px; }
        .pn-ed-sec-hdr .pn-ed-chevron { visibility: hidden; }
        .pn-ed-home-wrap { margin-bottom: 18px; }
        .pn-ed-warning { background: rgba(255,152,0,0.12); border: 1px solid rgba(255,152,0,0.4); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: var(--primary-text-color, #212121); line-height: 1.5; }
        .pn-ed-warning small { color: var(--secondary-text-color, #757575); }
        .pn-ed-dup-inp { border-color: var(--error-color, #e53935) !important; background: rgba(229,57,53,0.05) !important; }
        .pn-ed-dup-hint { color: var(--error-color, #e53935); font-size: 11px; margin-top: 4px; }
      </style><div id="pn-ed-root"></div>`;
  }

  _t(key) {
    const lang = (this._hass?.language || navigator.language || 'en').startsWith('de') ? 'de' : 'en';
    return EDITOR_LANG[lang]?.[key] || EDITOR_LANG.en[key] || key;
  }

  set hass(h) { this._hass = h; }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));
    // Migration: soc_as_graphic → soc_display
    if (this._config.general && this._config.general.soc_as_graphic !== undefined && this._config.general.soc_display === undefined) {
      this._config.general.soc_display = this._config.general.soc_as_graphic ? 'graphic' : 'text';
    }
    if (this._config.general && this._config.general.soc_display === undefined) {
      this._config.general.soc_display = 'text';
    }
    if (!this._config.general) this._config.general = { knoten_zoom: 1.0, knoten_abstand: 195, button_mode: false };
    if (!this._config.home) this._config.home = { name: "Haus", icon: "mdi:home", color: "#ffab40", entity: "", size: "L", bg_color: "#000000", bg_transparent: false, icon_color: "", power_color: "", name_color: "" };
    if (!this._config.nodes) this._config.nodes = [];
    // Migration für alte Keys
    this._config.nodes.forEach(n => {
      if (n.entity_input === undefined && n.entity !== undefined) { n.entity_input = n.entity; delete n.entity; }
      if (n.entity_output === undefined && n.entity2 !== undefined) { n.entity_output = n.entity2; delete n.entity2; }
      if (n.x_position === undefined && n.x !== undefined) { n.x_position = n.x; delete n.x; }
      if (n.y_position === undefined && n.y !== undefined) { n.y_position = n.y; delete n.y; }
    });
    // Fehlende Properties pro Node mit Defaults belegen
    this._config.nodes.forEach(n => { if (!n.connections) n.connections = []; if (!n.size) n.size = "M"; if (n.slot === undefined) n.slot = 0; if (n.invert_flow === undefined) n.invert_flow = false; if (n.subtract_output === undefined) n.subtract_output = false; if (!n.hide_mode) n.hide_mode = "hide"; });
    this._render();
  }

  _fireChange(immediate) {
    const dispatch = () => this.dispatchEvent(new CustomEvent('config-changed', {
      bubbles: true, composed: true,
      detail: { config: this._config }
    }));
    if (immediate) { clearTimeout(this._debTimer); dispatch(); }
    else { clearTimeout(this._debTimer); this._debTimer = setTimeout(dispatch, 250); }
  }

  _addNode() {
    const occupied = new Set(this._config.nodes.map(n => `${n.x_position ?? 0},${n.y_position ?? 0}`));
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
      subtract_output: false,
      auto_hide: false,
      hide_mode: "hide",
      fade_hide_edges: false,
      nexus_relevant: false,
      aux_entity: "",
      aux_bg_color: "#000000",
      aux_bg_transparent: false,
      bg_color: "#000000",
      bg_transparent: false,
      icon_color: "",
      power_color: "",
      aux_color: "",
      soc_color: "",
      name_color: "",
      name_size: 100,
      icon_size: 100,
      power_size: 100,
      aux_size: 100,
      hide_threshold: 0,
      soc_entity: "",
      entity: "",
      entity2: "",
      connections: [],
      x, y
    });
    this._fireChange(true);
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
    this._fireChange(true);
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
    this._fireChange(true);
    this._render();
  }

  // ── Verbindungen ───────────────────────────────────────────────────────

  _addConnection(idx) {
    if (isNaN(idx) || idx < 0 || idx >= this._config.nodes.length) return;
    const node = this._config.nodes[idx];
    if (!node.connections) node.connections = [];
    node.connections.push({ target: 'home' });
    this._fireChange(true);
    this._render();
  }

  _removeConnection(idx, ci) {
    if (isNaN(idx) || isNaN(ci)) return;
    const conns = this._config.nodes[idx]?.connections;
    if (!conns || ci >= conns.length) return;
    conns.splice(ci, 1);
    this._fireChange(true);
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
        j !== idx ? `<option value="${j}" ${String(conn.target) === String(j) ? 'selected' : ''}>${_htmlEscape(n2.name || this._t('nodeDefault')+' '+(j+1))}</option>` : ''
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
          <span class="pn-ed-card-title">${_htmlEscape(n.name || this._t('nodeDefault') + ' ' + (i+1))}</span>
          <button class="pn-ed-btn-mv" data-idx="${i}" data-dir="-1" title="${this._t('moveUp')}">▲</button>
          <button class="pn-ed-btn-mv" data-idx="${i}" data-dir="1" title="${this._t('moveDown')}">▼</button>
          <button class="pn-ed-btn-rm" data-idx="${i}" title="${this._t('removeNode')}">✕</button>
        </div>
        <div class="pn-ed-card-body pn-ed-collapsed" id="pn-node-body-${i}">
          <div id="pn-node-form-${i}"></div>
        </div>
      </div>
    `).join('');

    // Duplikate prüfen: gleiche (x, y, slot)-Kombination
    const posMap = {};
    const duplicates = [];
    const dupIndices = new Set();
    nodes.forEach((n, i) => {
      const key = `${n.x_position??0},${n.y_position??0},${n.slot??0}`;
      if (posMap[key] !== undefined) { duplicates.push([posMap[key], i]); dupIndices.add(posMap[key]); dupIndices.add(i); }
      else posMap[key] = i;
    });
    const dupWarning = duplicates.length ? `
      <div class="pn-ed-warning">
        ⚠ ${this._t('dupWarning')}: ${duplicates.map(([a,b]) => `"${_htmlEscape(nodes[a].name||this._t('nodeDefault')+' '+(a+1))}" &amp; "${_htmlEscape(nodes[b].name||this._t('nodeDefault')+' '+(b+1))}"`).join(', ')}
        <br><small>${this._t('dupWarningHint')}</small>
      </div>
    ` : '';

    const root = this.shadowRoot.getElementById('pn-ed-root');
    root.innerHTML = `
      ${dupWarning}
      <div class="pn-ed-card">
        <div class="pn-ed-card-hdr pn-ed-toggle" data-target="pn-general-body">
          <span class="pn-ed-chevron">▶</span>
          <span class="pn-ed-card-title">${this._t('general')}</span>
        </div>
        <div class="pn-ed-card-body pn-ed-collapsed" id="pn-general-body">
          <div id="pn-general-form"></div>
        </div>
      </div>
      <div class="pn-ed-sec-hdr">
        <span class="pn-ed-chevron">▶</span> ${this._t('nodes')}
      </div>
      <div class="pn-ed-card pn-ed-home-wrap">
        <div class="pn-ed-card-hdr pn-ed-toggle" data-target="pn-home-body">
          <span class="pn-ed-chevron">▶</span>
          <span class="pn-ed-card-title">${this._t('home')}</span>
        </div>
        <div class="pn-ed-card-body pn-ed-collapsed" id="pn-home-body">
          <div id="pn-home-form"></div>
        </div>
      </div>
      <div>
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
    const speedByVal = c.general?.flow_speed_by_value !== false; // Default: true
    const socDisplay = c.general?.soc_display || 'text';
    const fullWattOn = c.general?.full_watt_display === true;
    const flowAnimOn = c.general?.flow_animation !== false;
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
      <label class="pn-ed-chk">
        <input type="checkbox" id="pn-flow-speed-by-value" ${speedByVal ? 'checked' : ''}> ${this._t('flowSpeedByValue')}
      </label>
      <label class="pn-ed-lbl">${this._t('socDisplay')}</label>
      <select class="pn-ed-inp" id="pn-soc-display" style="width:50%;">
        <option value="text" ${socDisplay === 'text' ? 'selected' : ''}>${this._t('socDisplayText')}</option>
        <option value="graphic" ${socDisplay === 'graphic' ? 'selected' : ''}>${this._t('socDisplayGraphic')}</option>
        <option value="both" ${socDisplay === 'both' ? 'selected' : ''}>${this._t('socDisplayBoth')}</option>
      </select>
      <label class="pn-ed-chk">
        <input type="checkbox" id="pn-full-watt-display" ${fullWattOn ? 'checked' : ''}> ${this._t('fullWattDisplay')}
      </label>
      <label class="pn-ed-chk">
        <input type="checkbox" id="pn-flow-animation" ${flowAnimOn ? 'checked' : ''}> ${this._t('flowAnimation')}
      </label>
      <label class="pn-ed-chk">
        <input type="checkbox" id="pn-show-version" ${c.general?.show_version === true ? 'checked' : ''}> ${this._t('showVersion')}
      </label>
      <div style="text-align:right;font-size:10px;color:var(--secondary-text-color,#999);margin-top:14px;opacity:0.5">Power Nexus Card v${CARD_VERSION}</div>
    `;
    const zoomSlider = this.shadowRoot.getElementById('pn-knoten-zoom');
    const zoomDisp = this.shadowRoot.getElementById('pn-zoom-val');
    const abstandSlider = this.shadowRoot.getElementById('pn-knoten-abstand');
    const abstandDisp = this.shadowRoot.getElementById('pn-abstand-val');
    const linienSlider = this.shadowRoot.getElementById('pn-linien-staerke');
    const linienDisp = this.shadowRoot.getElementById('pn-linien-val');
    const buttonCb = this.shadowRoot.getElementById('pn-button-mode');
    const speedCb = this.shadowRoot.getElementById('pn-flow-speed-by-value');
    const socDisplaySel = this.shadowRoot.getElementById('pn-soc-display');
    const fullWattCb = this.shadowRoot.getElementById('pn-full-watt-display');
    const flowAnimCb = this.shadowRoot.getElementById('pn-flow-animation');
    const showVersionCb = this.shadowRoot.getElementById('pn-show-version');
    zoomSlider.addEventListener('input', () => { zoomDisp.textContent = parseFloat(zoomSlider.value).toFixed(1); });
    abstandSlider.addEventListener('input', () => { abstandDisp.textContent = parseFloat(abstandSlider.value).toFixed(0); });
    linienSlider.addEventListener('input', () => { linienDisp.textContent = parseFloat(linienSlider.value).toFixed(0); });
    const saveGeneral = () => {
      this._config.general.knoten_zoom = parseFloat(zoomSlider.value) || 1.0;
      this._config.general.knoten_abstand = parseFloat(abstandSlider.value) || 195;
      this._config.general.linien_staerke = parseFloat(linienSlider.value) || 10;
      this._config.general.button_mode = buttonCb.checked;
      this._config.general.flow_speed_by_value = speedCb.checked;
      this._config.general.soc_display = socDisplaySel.value;
      this._config.general.full_watt_display = fullWattCb.checked;
      this._config.general.flow_animation = flowAnimCb.checked;
      this._config.general.show_version = showVersionCb.checked;
      this._fireChange();
    };
    zoomSlider.addEventListener('change', saveGeneral);
    abstandSlider.addEventListener('change', saveGeneral);
    linienSlider.addEventListener('change', saveGeneral);
    buttonCb.addEventListener('change', saveGeneral);
    speedCb.addEventListener('change', saveGeneral);
    socDisplaySel.addEventListener('change', saveGeneral);
    fullWattCb.addEventListener('change', saveGeneral);
    flowAnimCb.addEventListener('change', saveGeneral);
    showVersionCb.addEventListener('change', saveGeneral);

    // -- Home --
    const h = c.home || {};
    const nexusActive = nodes.some(n => n.nexus_relevant === true);
    const homeSource = nexusActive ? this._t('homeSourceNexus') : this._t('homeSourceEntity');
    this.shadowRoot.getElementById('pn-home-form').innerHTML = `
      <label class="pn-ed-lbl">${this._t('name')}</label>
      <input class="pn-ed-inp" id="pn-home-name" value="${_htmlEscape(h.name || 'Haus')}">
      <label class="pn-ed-lbl">${this._t('homeEntity')}</label>
      <div id="pn-home-entity-wrap"></div>
      <div class="pn-ed-hint" style="font-weight:600;color:var(--primary-color,#03a9f4);">${homeSource}</div>
      <label class="pn-ed-lbl">${this._t('icon')}</label>
      <div id="pn-home-icon-wrap"></div>
      <label class="pn-ed-lbl">${this._t('size')}</label>
      <select class="pn-ed-inp" id="pn-home-size" style="width:100%;">
        <option value="S" ${(h.size || 'L') === 'S' ? 'selected' : ''}>${this._t('sizeS')}</option>
        <option value="M" ${(h.size || 'L') === 'M' ? 'selected' : ''}>${this._t('sizeM')}</option>
        <option value="L" ${(h.size || 'L') === 'L' ? 'selected' : ''}>${this._t('sizeL')}</option>
      </select>
      <div style="display:flex;margin-top:10px;margin-bottom:4px;">
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;">
          <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('color')}</span>
          <input class="pn-ed-inp" type="color" id="pn-home-color" value="${_htmlEscape(h.color || '#ffab40')}">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;">
          <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('iconColor')}</span>
          <input class="pn-ed-inp" type="color" id="pn-home-icon-color" value="${_htmlEscape(h.icon_color || '')}">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;">
          <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('powerColor')}</span>
          <input class="pn-ed-inp" type="color" id="pn-home-power-color" value="${_htmlEscape(h.power_color || '')}">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;">
          <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('nameColor')}</span>
          <input class="pn-ed-inp" type="color" id="pn-home-name-color" value="${_htmlEscape(h.name_color || '')}">
        </div>
      </div>
      <div style="display:flex;align-items:flex-start;margin-bottom:2px;">
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;">
          <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('bgColor')}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <input class="pn-ed-inp" type="color" id="pn-home-bg-color" value="${_htmlEscape(h.bg_color || '#000000')}">
            <label class="pn-ed-chk" style="margin-top:0;">
              <input type="checkbox" id="pn-home-bg-transparent" ${h.bg_transparent ? 'checked' : ''}> ${this._t('bgTransparent')}
            </label>
          </div>
        </div>
      </div>
      <label class="pn-ed-lbl">${this._t('nameSize')}</label>
      <div class="pn-ed-slider">
        <input type="range" min="50" max="200" step="5" id="pn-home-name-size" value="${h.name_size ?? 100}">
        <span class="pn-ed-slider-val" id="pn-home-name-size-val">${h.name_size ?? 100}%</span>
      </div>
      <label class="pn-ed-lbl">${this._t('iconSize')}</label>
      <div class="pn-ed-slider">
        <input type="range" min="50" max="200" step="5" id="pn-home-icon-size" value="${h.icon_size ?? 100}">
        <span class="pn-ed-slider-val" id="pn-home-icon-size-val">${h.icon_size ?? 100}%</span>
      </div>
      <label class="pn-ed-lbl">${this._t('powerSize')}</label>
      <div class="pn-ed-slider">
        <input type="range" min="50" max="200" step="5" id="pn-home-power-size" value="${h.power_size ?? 100}">
        <span class="pn-ed-slider-val" id="pn-home-power-size-val">${h.power_size ?? 100}%</span>
      </div>
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
    const hbg = this.shadowRoot.getElementById('pn-home-bg-color');
    const hbgt = this.shadowRoot.getElementById('pn-home-bg-transparent');
    if (hbg) hbg.addEventListener('change', () => { this._config.home.bg_color = hbg.value; this._fireChange(); });
    if (hbgt) hbgt.addEventListener('change', () => { this._config.home.bg_transparent = hbgt.checked; this._fireChange(); });
    const hSize = this.shadowRoot.getElementById('pn-home-size');
    if (hSize) hSize.addEventListener('change', () => { this._config.home.size = hSize.value; this._fireChange(); });
    const hiCol = this.shadowRoot.getElementById('pn-home-icon-color');
    const hpCol = this.shadowRoot.getElementById('pn-home-power-color');
    const hnCol = this.shadowRoot.getElementById('pn-home-name-color');
    if (hiCol) hiCol.addEventListener('change', () => { this._config.home.icon_color = hiCol.value; this._fireChange(); });
    if (hpCol) hpCol.addEventListener('change', () => { this._config.home.power_color = hpCol.value; this._fireChange(); });
    if (hnCol) hnCol.addEventListener('change', () => { this._config.home.name_color = hnCol.value; this._fireChange(); });
    const hns = this.shadowRoot.getElementById('pn-home-name-size');
    const his = this.shadowRoot.getElementById('pn-home-icon-size');
    const hps = this.shadowRoot.getElementById('pn-home-power-size');
    const hnsv = this.shadowRoot.getElementById('pn-home-name-size-val');
    const hisv = this.shadowRoot.getElementById('pn-home-icon-size-val');
    const hpsv = this.shadowRoot.getElementById('pn-home-power-size-val');
    if (hns) { hns.addEventListener('input', () => { if (hnsv) hnsv.textContent = hns.value + '%'; }); hns.addEventListener('change', () => { this._config.home.name_size = parseFloat(hns.value) || 100; this._fireChange(); }); }
    if (his) { his.addEventListener('input', () => { if (hisv) hisv.textContent = his.value + '%'; }); his.addEventListener('change', () => { this._config.home.icon_size = parseFloat(his.value) || 100; this._fireChange(); }); }
    if (hps) { hps.addEventListener('input', () => { if (hpsv) hpsv.textContent = hps.value + '%'; }); hps.addEventListener('change', () => { this._config.home.power_size = parseFloat(hps.value) || 100; this._fireChange(); }); }

    // -- Knoten --
    nodes.forEach((n, i) => {
      const wrap = this.shadowRoot.getElementById('pn-node-form-' + i);
      if (!wrap) return;
      wrap.innerHTML = `
        <label class="pn-ed-lbl">${this._t('name')}</label>
        <input class="pn-ed-inp" data-idx="${i}" data-field="name" value="${_htmlEscape(n.name || '')}">
        <label class="pn-ed-lbl">${this._t('icon')}</label>
        <div id="pn-node-icon-wrap-${i}"></div>
        <div class="pn-ed-row">
          <div style="flex:1;">
            <label class="pn-ed-lbl">${this._t('size')}</label>
            <select class="pn-ed-inp" data-idx="${i}" data-field="size" style="width:100%;">
              <option value="S" ${n.size === 'S' ? 'selected' : ''}>${this._t('sizeS')}</option>
              <option value="M" ${n.size === 'M' ? 'selected' : ''}>${this._t('sizeM')}</option>
              <option value="L" ${n.size === 'L' ? 'selected' : ''}>${this._t('sizeL')}</option>
            </select>
          </div>
          <div style="flex:1;">
            <label class="pn-ed-lbl">${this._t('slot')}</label>
            <input class="pn-ed-inp ${dupIndices.has(i) ? 'pn-ed-dup-inp' : ''}" type="number" data-idx="${i}" data-field="slot" value="${n.slot ?? 0}" min="0" max="3" style="width:100%;">
          </div>
        </div>
        <div class="pn-ed-row">
          <div>
            <label class="pn-ed-lbl">${this._t('xPos')}</label>
            <input class="pn-ed-inp ${dupIndices.has(i) ? 'pn-ed-dup-inp' : ''}" type="number" data-idx="${i}" data-field="x_position" value="${n.x_position ?? -1}" style="width:80px;">
          </div>
          <div>
            <label class="pn-ed-lbl">${this._t('yPos')}</label>
            <input class="pn-ed-inp ${dupIndices.has(i) ? 'pn-ed-dup-inp' : ''}" type="number" data-idx="${i}" data-field="y_position" value="${n.y_position ?? 0}" style="width:80px;">
          </div>
        </div>
        ${dupIndices.has(i) ? `<div class="pn-ed-dup-hint">⚠ ${this._t('dupWarning')} – ${this._t('dupWarningHint')}</div>` : ''}
        <label class="pn-ed-lbl">${this._t('entityInput')}</label>
        <div id="pn-node-entity-wrap-${i}"></div>
        <label class="pn-ed-chk">
          <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="nexus_relevant" ${n.nexus_relevant ? 'checked' : ''}> ${this._t('nexusRelevant')}
        </label>
        <label class="pn-ed-lbl">${this._t('entityOutput')}</label>
        <div id="pn-node-entity2-wrap-${i}"></div>
        <div class="pn-ed-hint">${this._t('entitySumHint')}</div>
        <label class="pn-ed-chk">
          <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="subtract_output" ${n.subtract_output ? 'checked' : ''}> ${this._t('subtractOutput')}
        </label>
        <div class="pn-ed-hint">${this._t('subtractOutputHint')}</div>
        <label class="pn-ed-lbl">${this._t('socEntity')}</label>
        <div id="pn-node-soc-wrap-${i}"></div>
        <label class="pn-ed-lbl">${this._t('auxEntity')}</label>
        <div id="pn-node-aux-wrap-${i}"></div>
        <label class="pn-ed-chk">
          <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="invert_flow" ${n.invert_flow ? 'checked' : ''}> ${this._t('invertFlow')}
        </label>
        <div class="pn-ed-row">
          <label class="pn-ed-chk" style="margin-top:0;">
            <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="auto_hide" ${n.auto_hide ? 'checked' : ''}> ${this._t('autoHide')}
          </label>
          <input class="pn-ed-inp" type="number" data-idx="${i}" data-field="hide_threshold" value="${n.hide_threshold ?? 0}" min="0" step="1" style="width:65px;"> W
        </div>
        <div class="pn-ed-row">
          <div style="flex:1;">
            <label class="pn-ed-lbl">${this._t('hideMode')}</label>
            <select class="pn-ed-inp" data-idx="${i}" data-field="hide_mode" style="width:100%;">
              <option value="hide" ${(n.hide_mode || 'hide') === 'hide' ? 'selected' : ''}>${this._t('hideModeHide')}</option>
              <option value="fade" ${n.hide_mode === 'fade' ? 'selected' : ''}>${this._t('hideModeFade')}</option>
            </select>
          </div>
          <label class="pn-ed-chk" style="margin-top:0;align-self:flex-end;padding-bottom:8px;">
            <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="fade_hide_edges" ${n.fade_hide_edges ? 'checked' : ''}> ${this._t('fadeHideEdges')}
          </label>
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--secondary-text-color,#757575);margin-top:14px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">${this._t('colors')}</div>
        <div style="display:flex;margin-top:0;margin-bottom:4px;">
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('color')}</span>
            <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="color" value="${_htmlEscape(n.color || '#4fc3f7')}">
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('iconColor')}</span>
            <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="icon_color" value="${_htmlEscape(n.icon_color || '')}">
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('powerColor')}</span>
            <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="power_color" value="${_htmlEscape(n.power_color || '')}">
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('nameColor')}</span>
            <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="name_color" value="${_htmlEscape(n.name_color || '')}">
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('auxColor')}</span>
            <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="aux_color" value="${_htmlEscape(n.aux_color || '')}">
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('socColor')}</span>
            <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="soc_color" value="${_htmlEscape(n.soc_color || '')}">
          </div>
        </div>
        <div style="display:flex;margin-top:10px;">
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('bgColor')}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="bg_color" value="${_htmlEscape(n.bg_color || '#000000')}">
              <label class="pn-ed-chk" style="margin-top:0;">
                <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="bg_transparent" ${n.bg_transparent ? 'checked' : ''}> ${this._t('bgTransparent')}
              </label>
            </div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
            <span style="font-size:10px;color:var(--secondary-text-color,#757575);">${this._t('auxBgColor')}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <input class="pn-ed-inp" type="color" data-idx="${i}" data-field="aux_bg_color" value="${_htmlEscape(n.aux_bg_color || '#000000')}">
              <label class="pn-ed-chk" style="margin-top:0;">
                <input type="checkbox" class="pn-ed-cb" data-idx="${i}" data-field="aux_bg_transparent" ${n.aux_bg_transparent ? 'checked' : ''}> ${this._t('bgTransparent')}
              </label>
            </div>
          </div>
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--secondary-text-color,#757575);margin-top:14px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">${this._t('sizes')}</div>
        <label class="pn-ed-lbl">${this._t('nameSize')}</label>
        <div class="pn-ed-slider">
          <input type="range" min="50" max="200" step="5" class="pn-ed-inp pn-ed-sld" data-idx="${i}" data-field="name_size" value="${n.name_size ?? 100}">
          <span class="pn-ed-slider-val">${n.name_size ?? 100}%</span>
        </div>
        <label class="pn-ed-lbl">${this._t('iconSize')}</label>
        <div class="pn-ed-slider">
          <input type="range" min="50" max="200" step="5" class="pn-ed-inp pn-ed-sld" data-idx="${i}" data-field="icon_size" value="${n.icon_size ?? 100}">
          <span class="pn-ed-slider-val">${n.icon_size ?? 100}%</span>
        </div>
        <label class="pn-ed-lbl">${this._t('powerSize')}</label>
        <div class="pn-ed-slider">
          <input type="range" min="50" max="200" step="5" class="pn-ed-inp pn-ed-sld" data-idx="${i}" data-field="power_size" value="${n.power_size ?? 100}">
          <span class="pn-ed-slider-val">${n.power_size ?? 100}%</span>
        </div>
        <label class="pn-ed-lbl">${this._t('auxSize')}</label>
        <div class="pn-ed-slider">
          <input type="range" min="50" max="200" step="5" class="pn-ed-inp pn-ed-sld" data-idx="${i}" data-field="aux_size" value="${n.aux_size ?? 100}">
          <span class="pn-ed-slider-val">${n.aux_size ?? 100}%</span>
        </div>
        <label class="pn-ed-lbl">${this._t('socSize')}</label>
        <div class="pn-ed-slider">
          <input type="range" min="50" max="200" step="5" class="pn-ed-inp pn-ed-sld" data-idx="${i}" data-field="soc_size" value="${n.soc_size ?? 100}">
          <span class="pn-ed-slider-val">${n.soc_size ?? 100}%</span>
        </div>
        <label class="pn-ed-lbl">${this._t('socStrokeWidth')}</label>
        <div class="pn-ed-slider">
          <input type="range" min="1" max="20" step="0.5" class="pn-ed-inp pn-ed-sld" data-idx="${i}" data-field="soc_stroke_width" value="${n.soc_stroke_width ?? 5}">
          <span class="pn-ed-slider-val">${n.soc_stroke_width ?? 5}</span>
        </div>
        <div class="pn-ed-conn-sec">
          <div style="font-size:11px;font-weight:600;color:var(--secondary-text-color,#757575);margin-top:14px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">${this._t('connections')}</div>
          <div id="pn-node-conns-${i}"></div>
          <button class="pn-ed-btn-conn-add" data-idx="${i}">${this._t('addConn')}</button>
        </div>
      `;
      // Icon-Picker
      const ni = document.createElement('ha-icon-picker');
      ni.value = n.icon || '';
      ni.style.width = '100%';
      ni.addEventListener('value-changed', (e) => { this._config.nodes[i].icon = e.detail.value; this._fireChange(); });
      this.shadowRoot.getElementById('pn-node-icon-wrap-' + i).appendChild(ni);
      // Entity-Picker
      const ne = document.createElement('ha-entity-picker');
      ne.setAttribute('allow-custom-entity', '');
      ne.setAttribute('hideClearIcon', '');
      ne.value = n.entity_input || '';
      ne.hass = this._hass;
      ne.style.width = '100%';
      ne.addEventListener('value-changed', (e) => { this._config.nodes[i].entity_input = e.detail.value; this._fireChange(); });
      this.shadowRoot.getElementById('pn-node-entity-wrap-' + i).appendChild(ne);
      // Entity-Output-Picker
      const ne2 = document.createElement('ha-entity-picker');
      ne2.setAttribute('allow-custom-entity', '');
      ne2.setAttribute('hideClearIcon', '');
      ne2.value = n.entity_output || '';
      ne2.hass = this._hass;
      ne2.style.width = '100%';
      ne2.addEventListener('value-changed', (e) => { this._config.nodes[i].entity_output = e.detail.value; this._fireChange(); });
      this.shadowRoot.getElementById('pn-node-entity2-wrap-' + i).appendChild(ne2);
      // SoC-Picker
      const ns = document.createElement('ha-entity-picker');
      ns.setAttribute('allow-custom-entity', '');
      ns.setAttribute('hideClearIcon', '');
      ns.value = n.soc_entity || '';
      ns.hass = this._hass;
      ns.style.width = '100%';
      ns.addEventListener('value-changed', (e) => { this._config.nodes[i].soc_entity = e.detail.value; this._fireChange(); });
      this.shadowRoot.getElementById('pn-node-soc-wrap-' + i).appendChild(ns);
      // Aux-Entity-Picker
      const na = document.createElement('ha-entity-picker');
      na.setAttribute('allow-custom-entity', '');
      na.setAttribute('hideClearIcon', '');
      na.value = n.aux_entity || '';
      na.hass = this._hass;
      na.style.width = '100%';
      na.addEventListener('value-changed', (e) => { this._config.nodes[i].aux_entity = e.detail.value; this._fireChange(); });
      const auxWrap = this.shadowRoot.getElementById('pn-node-aux-wrap-' + i);
      if (auxWrap) auxWrap.appendChild(na);
      this._renderNodeConns(i);
    });

    this.shadowRoot.querySelectorAll('.pn-ed-inp[data-idx]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        const field = inp.dataset.field;
        const value = inp.type === 'number' || inp.type === 'range' ? parseFloat(inp.value) : inp.value;
        this._config.nodes[idx][field] = value;
        this._fireChange();
      });
    });
    // Slider-Live-Update
    this.shadowRoot.querySelectorAll('.pn-ed-sld[data-idx]').forEach(sld => {
      sld.addEventListener('input', () => {
        const disp = sld.parentElement.querySelector('.pn-ed-slider-val');
        if (disp) disp.textContent = parseFloat(sld.value) + '%';
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
export { PowerNexus };