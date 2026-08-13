import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getReportErrorMessage,
  submitExampleContentReport,
} from '../lib/exampleReportsApi';
import { colors } from '../theme/colors';
import {
  reportTargetLabel,
  type ReportTarget,
} from '../types/exampleReport';

type Props = {
  visible: boolean;
  exampleId: string;
  exampleTitle: string;
  certificationId: string | null;
  certificationName: string;
  onClose: () => void;
  onSubmitted?: () => void;
};

const TARGETS: ReportTarget[] = [
  'question',
  'choices',
  'explanation',
  'other',
];

export function ExampleReportModal({
  visible,
  exampleId,
  exampleTitle,
  certificationId,
  certificationName,
  onClose,
  onSubmitted,
}: Props) {
  const [target, setTarget] = useState<ReportTarget>('question');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTarget('question');
    setMessage('');
    setBusy(false);
    setError(null);
  }, [visible, exampleId]);

  const canSubmit = message.trim().length > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await submitExampleContentReport({
        exampleId,
        exampleTitle,
        certificationId,
        certificationName,
        target,
        message,
      });
      onSubmitted?.();
      onClose();
    } catch (err) {
      setError(
        getReportErrorMessage(err, '連絡の送信に失敗しました。'),
      );
      setBusy(false);
    }
  };

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
          <Text style={styles.title}>内容の誤りを連絡</Text>
          <Text style={styles.lead}>
            問題文・選択肢・解説などに誤りがあれば教えてください。管理者画面で確認します。
          </Text>
          <Text style={styles.exampleLabel} numberOfLines={2}>
            対象例題: {exampleTitle || '（無題）'}
          </Text>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.fieldLabel}>対象</Text>
            <View style={styles.targetRow}>
              {TARGETS.map((item) => {
                const selected = target === item;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    disabled={busy}
                    onPress={() => setTarget(item)}
                    style={[
                      styles.targetChip,
                      selected && styles.targetChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.targetChipLabel,
                        selected && styles.targetChipLabelSelected,
                      ]}
                    >
                      {reportTargetLabel(item)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>連絡内容</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              editable={!busy}
              placeholder="どこがどのように誤っているか、できるだけ具体的に書いてください"
              placeholderTextColor={colors.muted}
              style={styles.input}
              multiline
              textAlignVertical="top"
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryButtonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonLabel}>キャンセル</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={() => {
                void handleSubmit();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && canSubmit && styles.primaryButtonPressed,
                !canSubmit && styles.primaryButtonDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colors.paper} />
              ) : (
                <Text
                  style={[
                    styles.primaryButtonLabel,
                    !canSubmit && styles.primaryButtonLabelDisabled,
                  ]}
                >
                  送信する
                </Text>
              )}
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
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(16, 42, 67, 0.45)',
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 16,
    padding: 20,
    zIndex: 2,
    maxHeight: '88%',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
  },
  title: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
    marginBottom: 8,
  },
  lead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
    marginBottom: 10,
  },
  exampleLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
    marginBottom: 14,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingBottom: 8,
  },
  fieldLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
    marginBottom: 8,
  },
  targetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  targetChip: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.mist,
  },
  targetChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  targetChipLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  targetChipLabelSelected: {
    color: colors.accentDeep,
  },
  input: {
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 12,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.ink,
    marginBottom: 8,
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.mist,
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
    minWidth: 120,
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  primaryButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.line,
  },
  primaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  primaryButtonLabelDisabled: {
    color: colors.muted,
  },
});
