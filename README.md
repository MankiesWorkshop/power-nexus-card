# Power Nexus Card

**Home Assistant Lovelace Custom Card – Energieflüsse flexibel visualisieren.**

---

## 🇩🇪 Deutsch

### Beschreibung

Die Power Nexus Card ist eine Custom Card für Home Assistant zur Visualisierung von Energieflüssen im Smart Home. Im Zentrum steht ein frei definierbares Energiesystem mit einem zentralen Haus-Knoten (Nexus), um den beliebig viele Energiequellen und Verbraucher angeordnet werden.

- SVG-basiertes Rendering mit animierten Energieflüssen
- Frei konfigurierbare Knoten (PV, Batterie, Netz, Verbraucher …)
- Drei Grössenstufen (S / M / L)
- Dynamische Sichtbarkeit (Schwellwert-basiert)
- Responsives Grid-Layout für Section Dashboards
- GUI-Editor zur Konfiguration

### Installation (manuell)

1. `power-nexus-card.js` in dein `config/www/`-Verzeichnis kopieren
2. In der Lovelace-Ressourcenliste hinzufügen:

```yaml
url: /local/power-nexus-card.js
type: module
```

### Minimalkonfiguration

```yaml
type: custom:power-nexus-card
nodes:
  - name: PV
    icon: mdi:solar-power
    size: L
    power_entity: sensor.pv_power
  - name: Netz
    icon: mdi:transmission-tower
    size: L
    power_entity: sensor.grid_power
  - name: Waschmaschine
    icon: mdi:washing-machine
    size: S
    power_entity: sensor.washing_machine_power
```

### Node-Eigenschaften

| Eigenschaft | Typ | Beschreibung |
|---|---|---|
| `name` | string | Anzeigename |
| `icon` | string | MDI-Icon (z.B. `mdi:solar-power`) |
| `size` | string | `S`, `M` oder `L` |
| `power_entity` | string | Entity mit Leistungswert (signed) |
| `slot` | number | Slot-Position (0–3) |
| `invert_flow` | boolean | Flussrichtung umkehren |

---

## 🇬🇧 English

### Description

Power Nexus Card is a custom Lovelace card for Home Assistant that visualizes energy flows in your smart home. At its center is a freely definable energy system with a central house node (Nexus), around which any number of energy sources and consumers can be arranged.

- SVG-based rendering with animated energy flows
- Freely configurable nodes (PV, battery, grid, appliances …)
- Three size levels (S / M / L)
- Dynamic visibility (threshold-based)
- Responsive grid layout for section dashboards
- GUI editor for configuration

### Installation (Manual)

1. Copy `power-nexus-card.js` into your `config/www/` directory
2. Add to your Lovelace resource list:

```yaml
url: /local/power-nexus-card.js
type: module
```

### Minimal Configuration

```yaml
type: custom:power-nexus-card
nodes:
  - name: PV
    icon: mdi:solar-power
    size: L
    power_entity: sensor.pv_power
  - name: Grid
    icon: mdi:transmission-tower
    size: L
    power_entity: sensor.grid_power
  - name: Washing Machine
    icon: mdi:washing-machine
    size: S
    power_entity: sensor.washing_machine_power
```

### Node Properties

| Property | Type | Description |
|---|---|---|
| `name` | string | Display name |
| `icon` | string | MDI icon (e.g. `mdi:solar-power`) |
| `size` | string | `S`, `M` or `L` |
| `power_entity` | string | Entity with power value (signed) |
| `slot` | number | Slot position (0–3) |
| `invert_flow` | boolean | Reverse flow direction |

---

## Lizenz / License

MIT
