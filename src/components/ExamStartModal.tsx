import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  visible: boolean;
  certificationName: string;
  questionCount: number;
  timeLimitMinutes: number;
  busy?: boolean;
  onStart: () => void;
  onClose: () => void;
};

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

export function ExamStartModal({
  visible,
  certificationName,
  questionCount,
  timeLimitMinutes,
  busy = false,
  onStart,
  onClose,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (!busy) onClose();
          }}
        />
        <View style={styles.card}>
          <Text style={styles.kicker}>本番試験</Text>
          <Text style={styles.title}>試験を開始しますか？</Text>
          <Text style={styles.certName} numberOfLines={2}>
            {certificationName}
          </Text>

          <View style={styles.metaBox}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>問題数</Text>
              <Text style={styles.metaValue}>{questionCount} 問</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>制限時間</Text>
              <Text style={styles.metaValue}>
                {formatMinutes(timeLimitMinutes)}
              </Text>
            </View>
          </View>

          <Text style={styles.lead}>
            スタートを押すと制限時間が始まります。時間切れの時点で未解答は不正解として集計します。
          </Text>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryButtonPressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>キャンセル</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onStart}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                busy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>スタート</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 42, 67, 0.45)',
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 16,
    padding: 20,
    zIndex: 2,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 460,
    gap: 12,
  },
  kicker: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.spotlightDeep,
    letterSpacing: 0.4,
  },
  title: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 22,
    color: colors.ink,
  },
  certName: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
  },
  metaBox: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.mist,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  metaLabel: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.muted,
  },
  metaValue: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
  },
  lead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  secondaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
  },
  primaryButton: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: colors.spotlight,
    minHeight: 44,
    minWidth: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    backgroundColor: colors.spotlightDeep,
  },
  primaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
