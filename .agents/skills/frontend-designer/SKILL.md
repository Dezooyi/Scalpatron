---
name: frontend-designer
description: Advanced Frontend Designer skill for production-grade, visually stunning, and memorable user interfaces. Use this when asked to create new UI components, landing pages, dashboards, or any feature that requires "Visual Excellence" and "Rich Aesthetics".
---

# 🎨 Advanced Frontend Designer Skill (Wand Level)

## 🌟 The Philosophy: Visual Excellence

This skill is designed to guide the agent in creating interfaces that go beyond functional "AI slop" and achieve a **"Wow" factor**. We prioritize **Rich Aesthetics**, **Dynamic Design**, and **Meticulous Refinement**.

### Core Pillars:
1.  **Stop using defaults.** No generic reds, blues, or browser-standard fonts.
2.  **Harmonious Complexity.** Use layered backgrounds, subtle textures, and balanced density.
3.  **Alive with Motion.** Every interaction should have a feedback loop (hover, focus, click).
4.  **Semantic & Accessible.** Beauty without compromise on durability or inclusivity.

---

## 🛠️ Technical Stack (Project Optimized)

-   **Frontend**: React 19 + Vite
-   **Styling**: Tailwind CSS v4 (Modern architecture)
-   **Components**: Radix UI (Headless, accessible)
-   **Animations**: GSAP (High performance) / Framer Motion
-   **Icons**: Lucide React / Tabler Icons

---

## 🎨 Aesthetic Guidelines

### 1. Typography (The Voice)
-   **Primary Fonts**: Use modern, high-character fonts from Google Fonts:
    -   *Display*: **Outfit**, **Clash Display**, **Bento**
    -   *Body*: **Inter**, **Hanken Grotesk**, **Plus Jakarta Sans**
    -   *Mono*: **JetBrains Mono**, **Fira Code**
-   **Scale**: Use a logical type scale. Oversize headings (e.g., `text-6xl`) with tight line heights (`leading-tight`) for impact.

### 2. Color & Glassmorphism
-   **Palette**: Use Tailwind v4's extended palette. Prefer HSL for programmatic control.
-   **Dark Mode**: Not just black. Use deep, saturated grays (`#0a0a0b`, `#0f172a`) with subtle glows.
-   **Glassmorphism**: 
    -   `bg-white/10` or `bg-black/20`
    -   `backdrop-blur-md`
    -   `border border-white/10`
    -   `shadow-xl`

### 3. Backgrounds & Textures
-   **Gradients**: Avoid 2-color linear gradients. Use **Mesh Gradients** or tiered overlays.
-   **Depth**: use `noise-texture` overlays (SVG filters) to add a premium feel.
-   **Glows**: Use `radial-gradient` for subtle spotlight effects behind key cards.

---

## ✨ Animation & Interaction (GSAP Powered)

Use GSAP for complex orchestrations and CSS/Tailwind for simple transitions.

```javascript
// GSAP Entrance Example
gsap.from(".card", {
  y: 30,
  opacity: 0,
  duration: 0.8,
  stagger: 0.1,
  ease: "power3.out"
});
```

### Micro-interactions:
-   **Buttons**: Scale down slightly on click (`active:scale-95`).
-   **Cards**: Elevate and glow on hover.
-   **Inputs**: Subtle border shadow glow on focus.

---

## 📐 Layout & Composition
-   **Grid-Breaking**: Overlap elements slightly to create depth.
-   **Asymmetry**: Use a single asymmetric accent in otherwise clean grids.
-   **Whitespace**: Be bold with negative space. Don't crowd the interface.

---

## 🛡️ Best Practices & Quality Control

1.  **Mobile First**: Ensure responsiveness using Tailwind's `sm:`, `md:`, `lg:` prefixes.
2.  **Semantic HTML**: Use `<header>`, `<main>`, `<footer>`, `<section>`.
3.  **Accessibility (a11y)**: Every image needs `alt`, buttons need `aria-label` if they only contain icons.
4.  **No Placeholders**: Use `generate_image` or actual stock data for a real preview.

---

### Command Checklist for the Agent:
- [ ] Is the color palette cohesive?
- [ ] Is the typography distinct and paired?
- [ ] Are there entrance animations for the elements?
- [ ] Does the UI feel "alive" on hover?
- [ ] is it responsive across devices?
