import { useCallback, useEffect, useState } from 'react';
import {
  NotoSansJP_400Regular,
  NotoSansJP_700Bold,
  useFonts,
} from '@expo-google-fonts/noto-sans-jp';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { NotificationBell } from './src/components/NotificationBell';
import { fetchCertifications } from './src/lib/certificationsApi';
import {
  getAppRoute,
  navigateAppRoute,
  parseAppRoute,
  pathForRoute,
  sanitizeNextPath,
  subscribeAppRoute,
  type AppRoute,
} from './src/lib/appRouting';
import { supabase } from './src/lib/supabase';
import { fetchIsAdministrator } from './src/lib/exampleReportsApi';
import { AuthScreen } from './src/screens/AuthScreen';
import { AdminReportsScreen } from './src/screens/AdminReportsScreen';
import { CertMainScreen } from './src/screens/CertMainScreen';
import { CertSelectScreen } from './src/screens/CertSelectScreen';
import { CertSettingScreen } from './src/screens/CertSettingScreen';
import { colors } from './src/theme/colors';
import type { Certification } from './src/types/certification';
import type { UserNotification } from './src/types/notification';

function routeFromNext(next: string | undefined): AppRoute {
  const safe = sanitizeNextPath(next);
  if (!safe) return { name: 'select' };
  return parseAppRoute(safe, '');
}

export default function App() {
  const { width } = useWindowDimensions();
  const [fontsLoaded] = useFonts({
    NotoSansJP_400Regular,
    NotoSansJP_700Bold,
  });
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => getAppRoute());
  const [activeCertification, setActiveCertification] =
    useState<Certification | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [pendingExampleId, setPendingExampleId] = useState<string | null>(
    null,
  );
  const [notificationNotice, setNotificationNotice] = useState<string | null>(
    null,
  );

  useEffect(() => {
    return subscribeAppRoute(() => {
      setRoute(getAppRoute());
    });
  }, []);

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
          setActiveCertification(null);
          setIsAdministrator(false);
          setAdminReady(false);
          setPendingExampleId(null);
          navigateAppRoute({ name: 'login' }, 'replace');
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
      setAdminReady(false);
      return;
    }
    let cancelled = false;
    setAdminReady(false);
    void (async () => {
      try {
        const admin = await fetchIsAdministrator();
        if (!cancelled) setIsAdministrator(admin);
      } catch (error) {
        console.error('[auth] is_administrator', error);
        if (!cancelled) setIsAdministrator(false);
      } finally {
        if (!cancelled) setAdminReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!authReady) return;

    if (!session) {
      if (route.name !== 'login') {
        const intended = pathForRoute(route);
        navigateAppRoute(
          {
            name: 'login',
            next: intended === '/login' ? undefined : intended,
          },
          'replace',
        );
      }
      return;
    }

    if (route.name === 'login') {
      navigateAppRoute(routeFromNext(route.next), 'replace');
    }
  }, [authReady, session, route]);

  useEffect(() => {
    if (!session) return;

    if (route.name === 'login') {
      setRouteLoading(false);
      return;
    }

    if (route.name === 'admin') {
      if (!adminReady) {
        setRouteLoading(true);
        return;
      }
      if (!isAdministrator) {
        navigateAppRoute({ name: 'select' }, 'replace');
      }
      setActiveCertification(null);
      setRouteLoading(false);
      return;
    }

    if (route.name === 'select') {
      setActiveCertification(null);
      setRouteLoading(false);
      return;
    }

    if (route.name === 'settings') {
      if (!route.certificationId) {
        setActiveCertification(null);
        setRouteLoading(false);
        return;
      }

      if (activeCertification?.id === route.certificationId) {
        setRouteLoading(false);
        return;
      }

      let cancelled = false;
      setRouteLoading(true);
      void (async () => {
        try {
          const certs = await fetchCertifications();
          if (cancelled) return;
          const cert = certs.find((item) => item.id === route.certificationId);
          if (!cert) {
            setActiveCertification(null);
            navigateAppRoute({ name: 'settings' }, 'replace');
            return;
          }
          setActiveCertification(cert);
        } catch (error) {
          console.error('[routing] load certification for settings', error);
          if (!cancelled) {
            setActiveCertification(null);
            navigateAppRoute({ name: 'settings' }, 'replace');
          }
        } finally {
          if (!cancelled) setRouteLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    if (route.name !== 'main') {
      setRouteLoading(false);
      return;
    }

    const certificationId = route.certificationId;
    if (activeCertification?.id === certificationId) {
      setRouteLoading(false);
      return;
    }

    let cancelled = false;
    setRouteLoading(true);
    void (async () => {
      try {
        const certs = await fetchCertifications();
        if (cancelled) return;
        const cert = certs.find((item) => item.id === certificationId);
        if (!cert) {
          setNotificationNotice(
            '指定された資格が見つからないため、選択画面に戻ります。',
          );
          setActiveCertification(null);
          navigateAppRoute({ name: 'select' }, 'replace');
          return;
        }
        setActiveCertification(cert);
      } catch (error) {
        console.error('[routing] load certification', error);
        if (!cancelled) {
          setNotificationNotice('資格の読み込みに失敗しました。');
          navigateAppRoute({ name: 'select' }, 'replace');
        }
      } finally {
        if (!cancelled) setRouteLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    session,
    route,
    isAdministrator,
    adminReady,
    activeCertification?.id,
  ]);

  const handleSelect = (certification: Certification) => {
    setActiveCertification(certification);
    navigateAppRoute(
      { name: 'main', certificationId: certification.id },
      'push',
    );
  };

  const handleBack = () => {
    setPendingExampleId(null);
    navigateAppRoute({ name: 'select' }, 'push');
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[auth] signOut', error);
    }
  };

  const handleAuthenticated = () => {
    const current = getAppRoute();
    if (current.name === 'login') {
      navigateAppRoute(routeFromNext(current.next), 'replace');
      return;
    }
    navigateAppRoute({ name: 'select' }, 'replace');
  };

  const handleOpenFromNotification = useCallback(
    async (notification: UserNotification) => {
      setNotificationNotice(null);

      if (!notification.exampleId) {
        setNotificationNotice(
          '関連する例題が見つかりません（削除済みの可能性があります）。',
        );
        return;
      }

      if (!notification.certificationId) {
        setNotificationNotice('関連する資格情報がないため、例題を開けません。');
        return;
      }

      try {
        const alreadyActive =
          activeCertification?.id === notification.certificationId;

        if (alreadyActive && activeCertification) {
          setPendingExampleId(notification.exampleId);
          navigateAppRoute(
            {
              name: 'main',
              certificationId: notification.certificationId,
            },
            'push',
          );
          return;
        }

        const certs = await fetchCertifications();
        const cert = certs.find(
          (item) => item.id === notification.certificationId,
        );
        if (!cert) {
          setNotificationNotice(
            '関連する資格が選択一覧にないため、例題を開けません。',
          );
          return;
        }

        setActiveCertification(cert);
        setPendingExampleId(notification.exampleId);
        navigateAppRoute(
          { name: 'main', certificationId: cert.id },
          'push',
        );
      } catch (error) {
        console.error('[notifications] open example', error);
        setNotificationNotice('例題を開けませんでした。');
      }
    },
    [activeCertification],
  );

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
        <AuthScreen onAuthenticated={handleAuthenticated} />
        <StatusBar style="dark" />
      </View>
    );
  }

  if (routeLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {route.name === 'admin' && isAdministrator ? (
        <AdminReportsScreen
          onBack={() => navigateAppRoute({ name: 'select' }, 'push')}
        />
      ) : route.name === 'settings' ? (
        <CertSettingScreen
          showSignOut={Boolean(route.certificationId)}
          onSignOut={handleSignOut}
          onBack={() => {
            if (route.certificationId) {
              navigateAppRoute(
                { name: 'main', certificationId: route.certificationId },
                'push',
              );
              return;
            }
            navigateAppRoute({ name: 'select' }, 'push');
          }}
        />
      ) : route.name === 'main' && activeCertification ? (
        <CertMainScreen
          certification={activeCertification}
          onBack={handleBack}
          onOpenSettings={() =>
            navigateAppRoute(
              {
                name: 'settings',
                certificationId: activeCertification.id,
              },
              'push',
            )
          }
          openExampleId={pendingExampleId}
          onOpenExampleConsumed={() => setPendingExampleId(null)}
          onOpenFromNotification={handleOpenFromNotification}
          externalNotice={notificationNotice}
          onDismissExternalNotice={() => setNotificationNotice(null)}
        />
      ) : (
          <View style={styles.selectWrap}>
          <View
            style={[
              styles.topBar,
              width < 720 && styles.topBarPhone,
            ]}
          >
            <Text style={styles.topBarEmail} numberOfLines={1}>
              {session.user.email}
            </Text>
            <View
              style={[
                styles.topBarActions,
                width < 720 && styles.topBarActionsPhone,
              ]}
            >
              <NotificationBell onOpenExample={handleOpenFromNotification} />
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  navigateAppRoute({ name: 'settings' }, 'push')
                }
                style={({ pressed }) => [
                  styles.settingsButton,
                  pressed && styles.settingsButtonPressed,
                ]}
              >
                <Text style={styles.settingsButtonLabel}>設定</Text>
              </Pressable>
              {isAdministrator ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    navigateAppRoute({ name: 'admin' }, 'push')
                  }
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
          {notificationNotice ? (
            <View style={styles.noticeBar}>
              <Text style={styles.noticeText}>{notificationNotice}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setNotificationNotice(null)}
              >
                <Text style={styles.noticeDismiss}>閉じる</Text>
              </Pressable>
            </View>
          ) : null}
          <CertSelectScreen onSelect={handleSelect} />
        </View>
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
  topBarPhone: {
    paddingHorizontal: 12,
    paddingTop: 8,
    flexWrap: 'wrap',
  },
  topBarEmail: {
    flex: 1,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
    minWidth: 0,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topBarActionsPhone: {
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  settingsButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  settingsButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  settingsButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
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
  noticeBar: {
    marginHorizontal: 20,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: '#FFF1EC',
    borderWidth: 1,
    borderColor: colors.spotlight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  noticeText: {
    flex: 1,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
  },
  noticeDismiss: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.spotlightDeep,
  },
});
