import 'react-native-gesture-handler';
import React from 'react';
import { View, Text, TouchableOpacity, Linking, StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Ionicons from 'react-native-vector-icons/Ionicons';

import { SettingsProvider, useSettings } from './context/SettingsProvider';
import { AuthProvider, useAuth } from './context/AuthProvider';

import DesoUserSearchScreen from './screens/DesoUserSearchScreen';
import UserProfileScreen from './screens/UserProfileScreen';


// Screens
import LoginScreen from './screens/LoginScreen';
import FeedScreen from './screens/FeedScreen';
import ComposeScreen from './screens/ComposeScreen';
import ZoneScreen from './screens/ZoneScreen'; // ostaje, ali pritiskom otvaramo vanjski browser
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import WalletScreen from './screens/WalletScreen';
import BlockedUsersScreen from './screens/BlockedUsersScreen';
import PostDetailScreen from './screens/PostDetailScreen';

const Tab = createBottomTabNavigator();
const FeedStack = createStackNavigator();

// Zone je vidljiv tab
const VISIBLE_TABS = new Set(['Feed', 'Compose', 'Zone', 'Notifications', 'Profile']);

function FullWidthTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const visibleRouteIndexes = state.routes
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => VISIBLE_TABS.has(r.name));

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 6,
        borderTopWidth: 0.5,
        borderTopColor: '#ddd',
        backgroundColor: '#fff',
      }}
    >
      {visibleRouteIndexes.map(({ r: route, i: index }) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;

        const onPress = async () => {
          // Posebno ponašanje za Zone: otvori vanjski browser i ne navigiraj na RN screen
          if (route.name === 'Zone') {
            await Linking.openURL('https://mytalkzone.xyz');
            return; // prekid: ne zovi navigation.navigate
          }
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
        const label = (options.tabBarLabel ?? options.title ?? route.name) as string;

        const iconMap: Record<string, string> = {
          Feed: 'home-outline',
          Compose: 'create-outline',
          Zone: 'videocam-outline', // nova ikona za Zone
          Notifications: 'notifications-outline',
          Profile: 'person-outline',
        };
        const iconName = iconMap[route.name] ?? 'ellipse-outline';

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={iconName} size={22} color={isFocused ? '#0b69ff' : '#7a7a7a'} />
            <Text style={{ color: isFocused ? '#0b69ff' : '#7a7a7a', fontSize: 12, marginTop: 2 }}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function FeedStackNavigator() {
  return (
    <FeedStack.Navigator>
      <FeedStack.Screen name="FeedScreen" component={FeedScreen} options={{ headerShown: false }} />
      <FeedStack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: 'Post' }} />
    </FeedStack.Navigator>
  );
}

function AppTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Feed"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FullWidthTabBar {...props} />}
    >
      <Tab.Screen name="Feed" component={FeedStackNavigator} />
      <Tab.Screen name="Compose" component={ComposeScreen} />
      {/* Zone tab ostaje, ali pritiskom se otvara browser (vidi FullWidthTabBar.onPress) */}
      <Tab.Screen name="Zone" component={ZoneScreen} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      {/* Skriveni tabovi */}
      <Tab.Screen name="Wallet" component={WalletScreen} options={{ tabBarButton: () => null }} />
      <Tab.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ tabBarButton: () => null }} />
<Tab.Screen name="DesoUsers" component={DesoUserSearchScreen} options={{ tabBarButton: () => null }} />
<Tab.Screen name="UserProfile" component={UserProfileScreen} options={{ tabBarButton: () => null }} />
    </Tab.Navigator>
  );
}

function Gate() {
  const { publicKey, authing } = useAuth();
  const { theme } = useSettings();
  if (authing && !publicKey) return <View style={{ flex: 1, backgroundColor: theme === 'dark' ? '#000' : '#fff' }} />;
  if (!publicKey) return <LoginScreen />;
  return <AppTabs />;
}

export default function App() {
  const { theme } = useSettings();
  const barStyle = theme === 'dark' ? 'light-content' : 'dark-content';
  return (
    <AuthProvider>
      <SettingsProvider>
        <NavigationContainer theme={theme === 'dark' ? DarkTheme : DefaultTheme}>
          <Gate />
          <StatusBar barStyle={barStyle} />
        </NavigationContainer>
      </SettingsProvider>
    </AuthProvider>
  );
}
