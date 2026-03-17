# SCALPATRON: Design System Specification v1.0

## 1. Vision & Identity
SCALPATRON is a high-performance trading suite for the Solana ecosystem. The design must reflect **Speed, Transparency, and Neural-Network Sophistication**.

---

## 2. Typography System (The Source of Truth)
We use a **Double-Token Typography System** to eliminate font variance and ensure accessibility (Min: 10px).

| Token | Size Class | Weight | Letter Spacing | Use Case |
| :--- | :--- | :--- | :--- | :--- |
| `text-h1` | `32px` | 900 | `-0.05em` | Lead Market Prices, Main Balances |
| `text-h2` | `18px` | 700 | `-0.025em` | Component Titles, Section Headers |
| `text-body`| `13px` | 400 | `default` | Data Values, Analysis Text |
| `text-mono`| `12px` | 500 | `0` | Log Content, TX Hashes, Addresses |
| `text-label`| `11px` | 700 | `0.1em` | Metadata Labels, Field Categories |
| `text-micro`| `10px` | 600 | `0.05em` | Telemetry, Small Auxiliary Status |

### CSS Implementation (index.css)
```css
@theme {
  --font-size-micro: 10px;
  --font-size-label: 11px;
  --font-size-body: 13px;
  --font-size-h2: 18px;
  --font-size-h1: 32px;
  --tracking-micro: 0.1em;
  --tracking-label: 0.15em;
}
```

---

## 3. Color Architecture
A high-contrast, professional palette optimized for dark mode environments.

| Semantic | Token | Hex | Role |
| :--- | :--- | :--- | :--- |
| **Primary** | `primary` | `#00F2FF` | Active Feed, Critical UI Points, Cyan Glow |
| **Status Ok** | `green-400` | `#4ADE80` | Profits, Synced Engine, Success |
| **Status Err**| `red-400` | `#F87171` | Losses, Terminal Errors, Disconnects |
| **Surface 1**| `zinc-900` | `#18181B` | Main Cards, Section Backgrounds |
| **Surface 2**| `black/40` | `rgba(0,0,0,0.4)` | Sub-panels, Glass Inlays |

---

## 4. Component Anatomy
### A. The Data Card (Glassmorphism)
- **Background**: `bg-zinc-900/40` with `backdrop-blur-md`.
- **Border**: `border-primary/20` or `border-white/10`.
- **Scanlines**: Every major terminal-like component must feature the `.scanline` animation.

### B. The Terminal Log
- **Layout**: Timestamp (Mono/Micro) | Level (Bold/Micro) | Message (Body).
- **Behavior**: Latest entry highlighted with `bg-primary/5` and `border-l-2`.

---

## 5. Layout Grid Specification
- **Dashboard Grid**: 60 / 40 Split.
  - **Left (60%)**: Interactive Data, Charts, Control Console.
  - **Right (40%)**: Real-time Stream Logs, Engine Telemetry.
- **Padding**: Standard `p-6` for containers, `p-3` for secondary cards.
