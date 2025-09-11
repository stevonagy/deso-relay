# DeSo Mobile App v2.2

This project is a **React Native mobile application** designed to interact with the [DeSo blockchain](https://deso.com).  
It provides social, wallet, and notification features with authentication and blockchain connectivity.

---

## 📂 Project Structure

```
Deso_mobile_app_v2.2/
│── tsconfig.json               # TypeScript configuration
│── app.json                    # App configuration (name, icons, etc.)
│── App.tsx                     # Main entry point of the application
│── deso-relay.html             # Local relay page for DeSo identity/auth
│── index.ts                    # Root index file
│── package.json                # Node dependencies and scripts
│── package-lock.json           # Lockfile for npm dependencies
│── readme.dm                   # Old/temporary readme notes
│── README_CHANGELOG.txt        # Changelog for recent updates
│
├── assets/                     # Static images and icons
│   ├── adaptive-icon.png
│   ├── avatar-placeholder.png
│   ├── favicon.png
│   ├── icon.png
│   ├── splash-icon.png
│   └── icons/                  # Additional app icons
│
├── components/                 # Reusable UI and logic components
│   ├── ApproveWebView.tsx
│   ├── DeriveModal.tsx
│   ├── DeriveWebView.tsx
│   ├── DeSoSimpleAuthModal.tsx
│   ├── DesoWindowFlow.tsx
│   ├── IdentityAuthModal.tsx
│   ├── IdentityBridgeWebView.tsx
│   ├── IdentityDeriveModal.tsx
│   ├── LoginWebView.tsx
│
├── context/                    # Global context providers
│   ├── AuthProvider.tsx        # Authentication state handling
│   ├── SettingsProvider.tsx    # User settings and preferences
│   ├── ThemeProvider.tsx       # Theming (light/dark mode)
│
├── screens/                    # App screens (pages)
│   ├── BlockedUsersScreen.tsx
│   ├── ChatScreen.tsx
│   ├── ComposeScreen.tsx
│   ├── ComposeScreen_working.tsx
│   ├── FeedScreen.tsx
│   ├── HelpScreen.tsx
│   ├── LoginScreen.tsx
│   ├── NodesScreen.tsx
│   ├── NotificationsScreen.tsx
│   ├── PostDetailScreen.tsx
│   ├── ProfileScreen.tsx
│   ├── WalletScreen.tsx
│   ├── ZoneScreen.tsx
│   └── arhiva/                 # Archived/experimental versions of screens
│       ├── FeedScreen_06092025_2200_radi.tsx
│       ├── FeedScreen_comment.tsx
│       ├── FeedScreen_no coment_load radi.tsx
│       ├── FeedScreen_no_load.tsx
│       ├── FeedScreen_no_search.tsx
│       ├── FeedScreen_Recent_working_OK.tsx
│       ├── FeedScreen_sa_searchom.tsx
│       ├── NotificationsScreen_arhiva.tsx
│       ├── NotificationsScreen_radi.tsx
│       ├── NotificationsScreen_testiranje.tsx
│       ├── ProfileScreen_.tsx
│       └── ProfileScreen_orginal.tsx
│
└── ui/                         # User interface elements
    └── PostCard.tsx            # Card component for displaying posts
```

---

## 🚀 Features

- **Authentication**: Supports DeSo identity login via WebView and modals.  
- **Feed**: Browse posts from the blockchain with options for load more, comments, and filtering.  
- **Profile**: View and manage your DeSo profile.  
- **Wallet**: Basic wallet functionality for balances and transactions.  
- **Chat**: Simple chat screen integrated with blockchain identity.  
- **Notifications**: Get updates (likes, diamonds, reposts, replies).  
- **Nodes Management**: Switch and configure nodes.  
- **Settings & Theming**: Light/dark mode and customizable preferences.  

---

## 📦 Dependencies

The project relies on common **React Native** and **Expo** libraries, along with DeSo-specific authentication tools.  
Dependencies include (but are not limited to):

- `react`, `react-native` – Core React Native framework  
- `expo` – Development and build environment  
- `react-navigation` – Navigation between screens  
- `@react-native-async-storage/async-storage` – Local storage  
- `axios` – API requests  
- `deso-protocol` – Blockchain interaction  

*(Check `package.json` for full list.)*

---

## ▶️ Running the App

1. **Install dependencies**
   ```sh
   npm install
   ```

2. **Run on development server**
   ```sh
   npm start
   ```

3. **Launch on Android/iOS emulator or device**
   - Use Expo Go app to scan QR code (if running with Expo).

---

## 📖 Notes

- Archived screens in `/screens/arhiva/` contain older working/tested versions.  
- `deso-relay.html` is important for handling identity/authentication bridge.  
- The project uses **TypeScript** for type safety and better maintainability.  

---

## 📝 Changelog

See **README_CHANGELOG.txt** for recent updates and fixes.

---

## 💡 Contribution

Contributions are welcome! Fork the repo, create a new branch, and submit a PR.  

---

## 📜 License

This project is provided as-is under an open-source license (check repository for details).  
