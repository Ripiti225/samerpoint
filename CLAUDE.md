# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Samtrackly** (internally called *SamerPoint*) is a React Native / Expo restaurant management app for tracking daily operations across multiple restaurant locations. It targets web (deployed via Expo web) and iOS, with primary real-world usage on iOS Safari.

The app manages: daily shift points (pointage), sales (ventes), expenses (dépenses), supplier invoices (fournisseurs), inventory (inventaire), staff attendance (présences), deliveries (livraisons), HR, and management dashboards.

## Commands

```bash
# Start dev server (web + QR for mobile)
npm start

# Run on iOS simulator
npm run ios

# Lint
npm run lint

# Build via EAS
eas build --profile development
eas build --profile production
```

There is no test suite. Verification is manual via the running app.

## Architecture

### Routing

Expo Router (file-based). All screens live in `app/`. The root layout (`app/_layout.tsx`) wraps the entire tree in three providers:

```
ThemeProvider → AppProvider → NetworkProvider → SessionGuard + Stack
```

`SessionGuard` (inside `_layout.tsx`) handles iOS Safari page-reload recovery: it reads `localStorage` to restore session state and redirects to the last-visited route when the React context has been wiped by a page reload.

### State Management — `context/AppContext.js`

Single global context holding **all daily operational data** for the active shift:

- Identity: `roleActif`, `restaurantId`, `userId`, etc.
- Shift data: `ventesJour`, `depensesJour`, `presencesJour`, `fournisseursJour`, `livraisonsJour`, `inventaireJour`, `paiesJour`
- Manager/gérant cash data: `depensesGerantCaisse`, `fournisseursGerantCaisse`, `paiesGerantCaisse`

Key lifecycle functions:
- `resetJour()` — clears all shift data; called only after shift validation, never on logout
- `deconnecter()` — clears identity only; daily data persists until `resetJour()`
- `resetShift()` — partial reset for caissier (cashier) after their shift is validated

Session is persisted to `localStorage` (web only) under key `samerpoint_session` with an 8-hour TTL.

### Database — Supabase (`lib/supabase.js`)

The Supabase URL and anon key are hardcoded as fallbacks in both `lib/supabase.js` and `lib/api.js`. Prefer setting `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`.

**Main tables:** `restaurants`, `utilisateurs`, `travailleurs`, `points`, `points_shifts`, `sequences`, `depenses`, `presences`, `commandes`, `transactions_fournisseurs`, `inventaires`, `fournisseurs`, `journal_activite`

A `point` is the daily record for one restaurant on one date. It must be created before any sub-records (depenses, presences, etc.) can be saved.

### Offline Support

All API functions in `lib/api.js` check `isOnlineNow()` (from `lib/networkStatus.js`) first. When offline:
- Read operations return cached data from `lib/offlineCache.js` (uses AsyncStorage)
- Write operations are enqueued via `lib/offlineQueue.js` (AsyncStorage key `samtrackly_offline_queue`)

`NetworkContext` (`context/NetworkContext.js`) monitors connectivity via `@react-native-community/netinfo` and auto-syncs the queue 1.5 seconds after reconnection. Point validation (`validerPoint`) is online-only and never queued.

### Roles

Five roles with different screen access: `manager`, `directeur`, `rh`, `gerant`, `caissier`. Login flow (`app/login.js`) is PIN-based — no email/password. Global roles (manager, rh, directeur) are not tied to a specific restaurant.

`isManager` in `AppContext` bypasses all `estBloque()` locks. The manager role has access to admin screens (parametres, equipe, rh, charges, documents, journal, rapports, etc.).

### Theming — `context/ThemeContext.js`

Three modes: `light`, `dark`, `auto` (follows system). Color palettes defined in `lib/theme.js` as `LIGHT` and `DARK`. Every screen computes its styles via `useMemo(() => makeStyles(colors), [colors])` to avoid re-renders.

### Photo Uploads

`lib/usePhoto.js` provides a `usePhoto()` hook. Photos are uploaded directly to Supabase Storage bucket `photos` via raw `fetch` (not the supabase-js client) to support both web blob URLs and React Native file URIs. On iOS web, the native file picker is triggered directly without a custom modal to avoid Safari blocking.

### Constants (`lib/constants.js`)

- `CATEGORIES_INVENTAIRE` — full product catalog with IDs, names, and prices; IDs must remain stable (used as DB keys)
- `COEFFICIENTS` — commission rates per delivery channel (Yango: 0.77, Glovo: 0.705, OM/Wave/Djamo: 0.99)
- `CATEGORIES_DEPENSES` — expense categories: Marché, Légumes, Fruits, Dépenses annexes

### Activity Journal (`lib/journal.js`)

All significant user actions are logged to `journal_activite` table via `journaliser()`. Calls are always `.catch(() => {})` — the journal must never block business operations.

### Key Screen Flows

- **Login** (`app/login.js`) → restaurant selection → user selection → PIN → role-based redirect
- **Gérant flow**: `choix-date` → `accueil` → individual data screens → `dashboard` → validate point
- **Caissier flow**: `gerant-caissier` → `point-shift` (saves `points_shifts` record + depenses + fournisseurs for that shift)
- **Manager flow**: Accueil shows admin menu; can view all restaurants via `dashboard-global`

Draft auto-save for caissier shift uses `localStorage` key `samerpoint_shift_draft`.

## iOS Web Specifics

The app runs as a web app pinned to the iOS home screen. Several workarounds exist:
- Page reload recovery in `SessionGuard` (routes restored from `localStorage`)
- `pagehide` event listener in `AppContext` saves session on app background
- Photo picker bypasses custom modals (Safari blocks `<input type="file">` inside custom modals)
- `lastRoute` is tracked and restored so users land back on the correct screen after camera use
