import { useEffect, useState } from 'react';
import {
  NotoSansJP_400Regular,
  NotoSansJP_700Bold,
  useFonts,
} from '@expo-google-fonts/noto-sans-jp';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from './src/lib/supabase';
import { fetchIsAdministrator } from './src/lib/exampleReportsApi';
import { AuthScreen } from './src/screens/AuthScreen';
import { AdminReportsScreen } from './src/screens/AdminReportsScreen';
import { CertMainScreen } from './src/screens/CertMainScreen';
import { CertSelectScreen } from './src/screens/CertSelectScreen';
import { colors } from './src/theme/colors';
import type { Certification } from './src/types/certification';

type Screen = 'select' | 'main' | 'admin';

export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSansJP_400Regular,
    NotoSansJP_700Bold,
  });
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('select');
  const [activeCertification, setActiveCertification] =
    useState<Certification | null>(null);
  const [isAdministrator, setIsAdministrator] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[auth] getSession', error);
      }
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        if (!nextSession) {
          setScreen('select');
          setActiveCertification(null);
          setIsAdministrator(false);
        }
      },
    );

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdministrator(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const admin = await fetchIsAdministrator();
        if (!cancelled) setIsAdministrator(admin);
      } catch (error) {
        console.error('[auth] is_administrator', error);
        if (!cancelled) setIsAdministrator(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleSelect = (certification: Certification) => {
    setActiveCertification(certification);
    setScreen('main');
  };

  const handleBack = () => {
    setScreen('select');
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[auth] signOut', error);
    }
  };

  if (!fontsLoaded || !authReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <StatusBar style="dark" />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.root}>
        <AuthScreen onAuthenticated={() => undefined} />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {screen === 'admin' ? (
        <AdminReportsScreen onBack={() => setScreen('select')} />
      ) : screen === 'select' || !activeCertification ? (
        <View style={styles.selectWrap}>
          <View style={styles.topBar}>
            <Text style={styles.topBarEmail} numberOfLines={1}>
              {session.user.email}
            </Text>
            <View style={styles.topBarActions}>
              {isAdministrator ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setScreen('admin')}
                  style={({ pressed }) => [
                    styles.adminButton,
                    pressed && styles.adminButtonPressed,
                  ]}
                >
                  <Text style={styles.adminButtonLabel}>管理者</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={handleSignOut}
                style={({ pressed }) => [
                  styles.signOutButton,
                  pressed && styles.signOutButtonPressed,
                ]}
              >
                <Text style={styles.signOutLabel}>ログアウト</Text>
              </Pressable>
            </View>
          </View>
          <CertSelectScreen onSelect={handleSelect} />
        </View>
      ) : (
        <CertMainScreen certification={activeCertification} onBack={handleBack} />
      )}
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.mist,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mist,
  },
  selectWrap: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    zIndex: 2,
  },
  topBarEmail: {
    flex: 1,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adminButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  adminButtonPressed: {
    backgroundColor: colors.accent,
  },
  adminButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  signOutButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  signOutButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  signOutLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
});
