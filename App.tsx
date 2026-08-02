import { useState } from 'react';
import {
  NotoSansJP_400Regular,
  NotoSansJP_700Bold,
  useFonts,
} from '@expo-google-fonts/noto-sans-jp';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { INITIAL_CERTIFICATIONS } from './src/data/certifications';
import { CertMainScreen } from './src/screens/CertMainScreen';
import { CertSelectScreen } from './src/screens/CertSelectScreen';
import { colors } from './src/theme/colors';
import type { Certification } from './src/types/certification';

type Screen = 'select' | 'main';

export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSansJP_400Regular,
    NotoSansJP_700Bold,
  });
  const [screen, setScreen] = useState<Screen>('select');
  const [certifications, setCertifications] =
    useState<Certification[]>(INITIAL_CERTIFICATIONS);
  const [activeCertification, setActiveCertification] =
    useState<Certification | null>(null);

  const handleSelect = (certification: Certification) => {
    setActiveCertification(certification);
    setScreen('main');
  };

  const handleBack = () => {
    setScreen('select');
  };

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {screen === 'select' || !activeCertification ? (
        <CertSelectScreen
          certifications={certifications}
          onCertificationsChange={setCertifications}
          onSelect={handleSelect}
        />
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
});
