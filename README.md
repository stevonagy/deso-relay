# DeSo Mobile App v2.2

A **React Native + Expo** mobile app for interacting with the [DeSo blockchain](https://deso.com).  
It includes identity login, feed browsing, posting, profiles, notifications, wallet view, node switching, theming, and more.

> **Note on Chat:** A `ChatScreen.tsx` exists in the codebase but is **not wired into navigation and not considered production‑ready** in this version. Chat is therefore **disabled** by default.

---

## 🧭 Navigation & Available Screens

Bottom tabs & stacks currently registered in `App.tsx`:

- **Feed** (`FeedStackNavigator`)
  - `FeedScreen` — main timeline
  - `PostDetail` — single post view (replies/engagement)
- **Compose** — create a new post
- **Zone** — custom/community zone (experimental UI)
- **Notifications** — likes, diamonds, reposts, replies
- **Profile** — your profile
- **Wallet** — wallet balances & basic actions
- **BlockedUsers** — manage blocked accounts
- **DesoUsers** — search DeSo users
- **UserProfile** — view other users’ profiles

_Not registered (not shipped in UI):_ `ChatScreen`

---

## ✨ Features

### Identity & Security
- **DeSo Identity login** via in‑app WebViews and modal flows
- **Key derivation** (spending limits, expiration) through Identity (Derive modals)
- **Secure storage** of keys/tokens using **expo‑secure‑store**

### Social
- **Feed browsing** with navigation into **Post Detail**
- **Create posts** from **Compose** (text, basic media via Expo pickers)
- **Profiles**
  - Own profile view
  - **User search** and **User profile** view
- **Notifications**: likes, diamonds, reposts, replies
- **Blocked users** management

### Wallet
- **Read‑only wallet view** (balances & basic info)

### App Controls
- **Node management**: change the active node (default is `https://desocialworld.com`)
- **Light/Dark theme** persisted across sessions

### Experimental / Misc
- **Zone** screen: a sandbox/custom area for future features
- **deso‑relay** HTML pages for local identity/derive flows:
  - `deso-relay.html`
  - `deso-relay-webview.html`

---

## 📦 Tech Stack & Dependencies

**Runtime & Framework**
- `react` **19.0.0**
- `react-native` **0.79.5**
- `expo` **~53.0.22**
- TypeScript (**~5.8.3**)

**Navigation**
- `@react-navigation/native` **^7.1.17**
- `@react-navigation/bottom-tabs` **^7.4.6**
- `@react-navigation/stack` **^7.4.8**
- `react-native-gesture-handler` **~2.24.0**
- `react-native-reanimated` **~3.17.4**
- `react-native-screens` **~4.11.1**
- `react-native-safe-area-context` **5.4.0**

**UI & Utilities**
- `@expo/vector-icons` **^14.1.0**
- `expo-status-bar` **~2.2.3**
- `nativewind` **^4.1.23** (Tailwind‑style RN)

**Device & Platform**
- `expo-constants` **~17.1.7**
- `expo-linking` **~7.1.7**
- `expo-secure-store` **~14.2.4**
- `expo-image-picker` **~16.1.4**
- `expo-image-manipulator` **~13.1.7**
- `expo-web-browser` **~14.2.0**
- `expo-auth-session` **~6.2.1**
- `expo-dev-client` **~5.2.4**
- `expo-crypto` **~14.1.5**
- `expo-av` **~15.1.7**
- `react-native-webview` **13.13.5**
- `zustand` **^5.0.8**

> See `package.json` for the authoritative list.

---

## 🗂 Project Structure

```
Deso_mobile_app_v2.2/
│── App.tsx
│── index.ts
│── app.json
│── tsconfig.json
│── package.json
│── deso-relay.html
│── deso-relay-webview.html
│── assets/...
│── components/...
│── context/...
│── lib/
│   ├── deso.ts                 # Node base + DeSo REST helpers
│   ├── identity.ts             # Identity helpers & types
│   ├── identityAuth.ts         # Login/derive helpers
│   └── secureStore.ts          # Secure key/value storage
│── screens/
│   ├── FeedScreen.tsx
│   ├── PostDetailScreen.tsx
│   ├── ComposeScreen.tsx
│   ├── NotificationsScreen.tsx
│   ├── ProfileScreen.tsx
│   ├── WalletScreen.tsx
│   ├── BlockedUsersScreen.tsx
│   ├── DesoUserSearchScreen.tsx
│   ├── UserProfileScreen.tsx
│   └── ChatScreen.tsx          # present but NOT enabled in UI
│── ui/
│   └── PostCard.tsx
└── README.md
```

---

## ⚙️ Configuration

- **Default node**: set in `lib/deso.ts` — `https://desocialworld.com`  
  You can change this in‑app (Settings/Nodes) or programmatically with `setNodeBase(url)`.
- **Theming**: `SettingsProvider` & `ThemeProvider` persist light/dark mode.
- **Identity**: local relay pages are included; WebViews bridge to the DeSo Identity flow.

---

## ▶️ Getting Started

1) **Install dependencies**
```bash
npm install
```

2) **Run in development**
```bash
npm start
```

3) **Open on device/emulator**
- Use the Expo app or a dev build (`expo run:android` / `expo run:ios`).

> If you modify native modules or need custom permissions, prefer `expo run:*` (prebuild) workflows.

---

## 🧪 Status & Roadmap

- ✅ Feed, Post Detail, Compose, Profiles, User Search, Notifications, Wallet (read‑only), Blocked Users, Node switch, Theming
- 🚧 **Chat**: code present but **not enabled** in navigation; requires additional backend/identity decryption work & QA before release
- 🧪 Zone: experimental surface for future features

---

## 🤝 Contributing

1. Fork → branch → commit → PR.  
2. Please include reproduction steps and screenshots where relevant.

---

## 📝 License

This project is provided as‑is under an open‑source license. See repository for details.

---

_Last updated: 2025-09-13_
