# Routelo Glass Ops Design System

Date: 2026-07-04

## Intent

Routelo Glass Ops adapts the Liquid Glass idea into an operational delivery
dashboard. Glass is used as a functional control layer, not as decoration.

The rule is simple:

- delivery data, profit data, OCR review data, and time-critical information use
  solid or semi-solid surfaces for readability;
- navigation, top controls, filters, floating actions, and sheets may use glass
  surfaces to separate controls from content;
- urgent delivery deadlines and event/wedding times always receive the highest
  visual priority.

## Applied layers

### Content surfaces

Delivery cards, calendar profit cards, agenda rows, notification rows, settings
groups, and OCR review fields use raised solid surfaces. These areas avoid
heavy transparency so address, phone, fee, and schedule text remain readable.

### Glass control surfaces

The main app now uses glass-style surfaces for:

- screen headers;
- filter and calendar mode controls;
- floating bottom navigation;
- floating OCR scan button;
- modal bottom sheets;
- secondary action buttons.

These surfaces use translucent fills, bright borders, soft shadows, and rounded
geometry. If blur is unavailable, the translucent token still falls back to a
readable tinted surface.

## Accessibility rules

- Never rely on color only: badges, icons, and labels remain part of the status
  system.
- Critical times use stronger weight, larger size, and semantic color.
- The bottom navigation is floating above the Android system navigation area and
  the main content has extra bottom padding to prevent overlap.
- Solid surfaces remain the default for text-heavy content.

## Current implementation notes

The implementation currently uses React Native surface tokens rather than a
native blur dependency. This keeps Expo CI stable while giving the UI the
intended glass hierarchy. A later polish PR can introduce `expo-blur` or a
native blur fallback if we want stronger frosted-glass rendering on supported
devices.
