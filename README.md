# Datura

A modern, privacy-first mobile app for discovering and connecting with people who share your interests. Built with Expo, React Native, TypeScript, and Supabase, Datura enables secure, end-to-end encrypted (E2EE) direct messaging and a vibrant discovery feed for finding new connections.

## Features

- **Discovery Feed**: Browse, search, and filter user-generated posts by interests, tags, and location.
- **Create Discovery Posts**: Share your interests, description, and location (optional) with the community.
- **E2EE Direct Messaging**: Start secure, encrypted chats with users who share your interests.
- **Interest Tagging**: Use a rich set of tags to describe your interests and find like-minded people.
- **Location Sharing**: Optionally add your location to posts for local discovery.
- **Datura Pro**: Unlock premium features (like viewing and connecting with users) via RevenueCat subscriptions and free trials.
- **Responsive UI**: Beautiful, accessible, and mobile-first design with dark mode support.
- **Performance**: Optimized for fast load times, smooth animations, and minimal resource usage.

## Tech Stack

- **Expo** (Managed Workflow)
- **React Native** (TypeScript, functional components)
- **Supabase** (Postgres, Auth, Realtime)
- **RevenueCat** (Subscriptions, free trials)
- **react-native-elements** (UI components)
- **react-navigation** (Routing)
- **styled-components** or **Tailwind CSS** (Styling)
- **expo-location** (Location permissions)
- **expo-secure-store** (Secure storage)
- **Zod** (Validation)
- **Jest** & **React Native Testing Library** (Testing)

## Project Structure

```
app/
  (tabs)/
    discover/
      index.tsx         # Discovery feed and post creation modal
    home/
    profile/
    ...
components/
  modals/              # Modal components (e.g., CreateGroupModal)
  ui/                  # UI primitives (e.g., Button, TabBar)
constants/             # Theme, colors, etc.
contexts/              # React Context providers
hooks/                 # Custom hooks (e.g., useCurrentUser)
providers/             # App-wide providers (e.g., RevenueCatProvider)
services/              # API, messaging, and Supabase logic
utils/                 # Utility functions
```

## Setup & Installation

1. **Clone the repo**

```sh
git clone https://github.com/your-org/datura.git
cd datura
```

2. **Install dependencies**

```sh
npm install
# or
yarn install
```

3. **Configure environment variables**

- Copy `.env.example` to `.env` and fill in your Supabase and RevenueCat keys.
- For Expo, use `app.json` or `app.config.js` for public config.

4. **Run the app**

```sh
npx expo start
```

5. **iOS/Android setup**

- For iOS: `npx expo run:ios`
- For Android: `npx expo run:android`

6. **Testing**

```sh
npm test
```

## RevenueCat Integration

- RevenueCat is used for managing subscriptions and free trials.
- API keys are set via environment variables (`EXPO_PUBLIC_RC_IOS_KEY`, `EXPO_PUBLIC_RC_ANDROID_KEY`).
- The `RevenueCatProvider` initializes the SDK and logs events.
- The paywall UI fetches available packages and prices dynamically from RevenueCat.
- See [RevenueCat React Native docs](https://www.revenuecat.com/docs/getting-started/installation/reactnative) for more.

## Supabase Schema (Discovery Table)

```
discovery (
  id uuid PRIMARY KEY,
  user_id uuid,
  created_at timestamptz,
  tags text[],
  latitude jsonb,
  longitude jsonb,
  profile_pic text,
  description text,
  link text,
  title text
)
```
- No foreign key is required, but if you want to join with users, add a FK on `user_id`.

## Coding Conventions

- TypeScript strict mode, interfaces over types, no enums (use maps)
- Functional, declarative React components
- Modular file structure, named exports
- Use Expo's SafeAreaProvider and SafeAreaView for layout
- Responsive design with Flexbox and useWindowDimensions
- Accessibility: ARIA roles, native props
- Error handling: Zod, early returns, global error boundaries
- Secure storage: expo-secure-store
- Testing: Jest, React Native Testing Library, Detox for E2E

## Security & Privacy

- All DMs are end-to-end encrypted
- Sensitive data is stored securely
- All API calls use HTTPS
- User input is sanitized and validated

## Deployment

- Use Expo's managed workflow for builds and OTA updates
- See [Expo Distribution Guide](https://docs.expo.dev/distribution/introduction/)

## License

MIT
