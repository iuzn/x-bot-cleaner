# Picker Design Language

Purpose-built for the picker panel, this document captures the minimalist visual system, interaction patterns, and reusable decisions that shape every surface in the extension. Use it as direction whenever we extend the UI to new contexts.

## Core Principles

- **Calm clarity** – Primary content always outweighs chrome. Borders are hairline (`0.5px`) and colors lean on translucent neutrals so interactions feel light instead of gadget-like (see `ImagePanelHeader` in `src/components/ImagePanelHeader.tsx`).
- **Soft depth** – We rely on layered translucency, large radii (20–36px), and saturated blurs to suggest elevation instead of heavy drop shadows (`ControlPanel` surfaces in `src/components/ControlPanel.tsx`).
- **Focused contrast** – Brand cyan (`xbc` palette) is reserved for affirmational actions, while warm rose handles destructive affordances and emerald highlights conversion-driven actions (`DownloadSection` in `src/components/ControlPanel/DownloadSection.tsx`).
- **State-first motion** – Animations clarify state changes with short dissolve + blur transitions; nothing moves for decoration (`motionVariants` in `src/lib/panel/motionVariants.ts`).

## Layout Architecture

### Floating Panel Stack

- The compact panel is a 300px floating card with a consistent 24px interior gutter. Its two states (“compact” vs. “expanded”) share the same shell to avoid context jumps; the body simply reveals more content when expanded (`ControlPanel` at lines 528–614).
- Expanded mode occupies the right edge with a full-height column capped at 360px width, keeping vertical rhythm with a header, scrollable content, and a footer bar (`ControlPanel` lines 484–523). Even here we keep the same rounded shell; only the width and height adapt.
- Panels sit on top of everything via the Shadow DOM root and explicit z-index, which ensures legibility over any host site content (`src/pages/content/ui/root.tsx`).

### Content Hierarchy

- We rely on stacked cards to separate semantic regions: header, primary actions, data surfaces, and supportive info. Each card gets its own muted background token (e.g., `bg-50` and `text-700` in `ExpandedPanelContent`).
- Micro layouts use 12px increments for breathing room. Spacers are animated so sections never jump abruptly (`CompactPanelContent` lines 107–227).

## Color System

### Brand Spectrum

- The `xbc` palette (50–950) is a cyan-to-teal gradient defined as CSS variables inside the Shadow DOM (`src/assets/style/theme.scss:6-35`). Lighter steps energize highlights and badges; darker steps support text/icons.

### Neutral Spine

- Neutral Tailwind tokens stay dominant for structure. Base fills are white/black blends with 5–20% opacity, keeping the UI adaptable over arbitrary backgrounds.
- Surface layers blend subtle tints (e.g., `bg-white/90`, `bg-neutral-100/50`), never full-solid, to maintain the floating sensation while guaranteeing contrast on both light and dark host pages.

### Accent Roles

- **Emerald** elevates confirmation flows (download buttons). Combine with translucent white backgrounds and emerald borders for a soft but readable CTA.
- **Rose** is exclusively for destructive micro-actions like “Cancel saved images” links.
- When accenting an icon, wrap it in a neutral container so the color reads as intent rather than decoration (`DownloadButtons` emerald glass buttons).

## Dark Mode Strategy

- Dark mode comes “for free” via SCSS loops that mirror every `bg/text/border` utility with a dark counterpart (`theme.scss:171-243`). Apply semantic classes like `.bg-default`/`.text-default` whenever possible to avoid manual overrides.
- Surfaces never flip to pure black; instead, we use translucent black overlays with preserved blur so the floating effect survives (`ControlPanel` dark classes on lines 487–533).
- Brand accents invert automatically: `.bg-w-500` becomes `.bg-w-400` in dark mode, maintaining WCAG contrast (`theme.scss:187-243`).

## Typography & Microcopy

- Inter is enforced across the Shadow DOM to prevent host-page overrides, including in pseudo-elements (`theme.scss:36-157` and `src/pages/content/ui/root.tsx` font injection).
- Display size is locked to 16px, so rem calculations stay predictable across hosts (`root.tsx` lines 12–20, 74–77).
- Headlines and labels use uppercase with wide tracking (0.08–0.2em) to create structure without adding new colors (e.g., header titles and “Downloads” section labels).
- Body copy tops out at 14px inside the panel, keeping the panel airy while remaining legible against blurred backgrounds.

## Surface Language

- **Glass shells** – Every primary container combines: translucent neutral fill (`bg-white/80`), 0.5–1px border (`border-white/20`), 18–32px radius, heavy blur (`backdrop-blur-2xl`), and soft multi-stop shadows. This gives a consistent “floating hardware” feeling (`ControlPanel.tsx` lines 484–538).
- **Embedded cards** – Secondary cards (image lists, download trays) use slightly more opaque fills and rounded corners (20–26px) to create nested depth without new shadows (`CompactPanelContent` download wrapper).
- **Buttons** – Action buttons are pill-shaped (32–40px height) with dual-state backgrounds: idle states are translucent neutrals, active states infuse the appropriate accent while keeping the blurred glass underlay visible (`DownloadButtons` styles around lines 95–142).
- **Modal canvas** – Full-screen experiences follow the same ingredients scaled up: tinted backdrop (`bg-black/50` + blur) and a central board with a 32px radius, border, and layered shadow (`SelectionGalleryModal.tsx` lines 146–199).

## Motion & Feedback

- We animate opacity, blur, and height together so sections feel like they dissolve in/out instead of sliding mechanically (`CompactPanelContent` variants at lines 8–45).
- Primary view changes use spring curves (damping 25, stiffness 200) to ensure fast settling without bounce (`expandedPanelVariants` in `motionVariants.ts:39-64`).
- Micro controls (icons, toggle buttons) scale subtly on hover/tap via Framer Motion for tactile feedback without visual noise (`ImagePanelHeader` close button).
- Timings stay under 400ms, using the `[0.22, 1, 0.36, 1]` cubic curve for a “material dissolving” feel.

## Focus, Accessibility & System Integration

- Focus states rely on an inset monochrome indicator (`--focus-indicator-color`) instead of rings so they layer cleanly over translucent surfaces (`theme.scss:86-141`).
- Scroll indicators are slim (6px) to avoid clutter but remain keyboard-visible (`theme.scss:159-168`).
- Cursor cues respect the host page by scoping to our Shadow DOM root. We only override document-level cursors for specific modes via data attributes (`root.tsx` lines 52–77).

## Modal & Overlay Pattern

- Backdrops always combine color and blur to soften the host site instead of obscuring it entirely (`SelectionGalleryModal.tsx:146-166`).
- Content stays vertically centered with generous breathing room (80vh height cap, 32px radius). Internal grids adopt flexible Masonry gaps (18px) so the modal scales gracefully across aspect ratios.
- Floating action clusters (e.g., download buttons) sit on the modal edges with pointer-events isolation, maintaining the floating hardware metaphor even inside modals.

## Implementation Checklist

1. Start with a neutral glass container: translucent fill, 0.5px border, 24px radius minimum, heavy blur.
2. Apply semantic color helpers (`bg-default`, `.text-700`, accent utilities) to inherit automatic dark-mode behavior.
3. Use Inter with uppercase, tracked labels for section headers; keep body copy ≤14px.
4. Structure content into stacked cards separated by 12–16px animated spacers.
5. When adding motion, pair opacity, blur, and height changes, and reuse the standard easing curves.
6. Validate focus handling and cursor states inside the Shadow DOM so host pages cannot leak their styles into our surfaces.

Following these guidelines keeps every new surface unmistakably “us”: calm, minimal, and ready to sit on top of any website without competing with it.
