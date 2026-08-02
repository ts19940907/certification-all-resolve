import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors } from '../theme/colors';
import type { Certification } from '../types/certification';

type Props = {
  certifications: Certification[];
  onCertificationsChange: (next: Certification[]) => void;
  onSelect?: (certification: Certification) => void;
};

function createId() {
  return `cert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CertSelectScreen({
  certifications,
  onCertificationsChange,
  onSelect,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const selected = certifications.find((item) => item.id === selectedId) ?? null;
  const trimmedName = draftName.trim();

  const openAddModal = () => {
    setDraftName('');
    setIsAddOpen(true);
  };

  const closeAddModal = () => {
    setIsAddOpen(false);
    setDraftName('');
  };

  const handleAdd = () => {
    if (!trimmedName) return;

    const next: Certification = {
      id: createId(),
      name: trimmedName,
    };

    onCertificationsChange([...certifications, next]);
    setSelectedId(next.id);
    closeAddModal();
  };

  const handleStart = () => {
    if (!selected) return;
    onSelect?.(selected);
  };

  return (
    <View style={styles.root}>
      <View style={styles.heroWash} />
      <ScrollView
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>CertResolve</Text>
        <Text style={styles.headline}>どの資格を学びますか？</Text>
        <Text style={styles.lead}>
          学びたい資格を追加して、一覧から選んで始められます。
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={openAddModal}
          style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
        >
          <Text style={styles.addButtonLabel}>＋ 資格を追加</Text>
        </Pressable>

        {certifications.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>まだ資格がありません</Text>
            <Text style={styles.emptyBody}>
              「資格を追加」から、学びたい資格名を自由に入力してください。
            </Text>
          </View>
        ) : (
          <View style={[styles.list, isWide && styles.listWide]}>
            {certifications.map((cert) => {
              const isSelected = cert.id === selectedId;
              return (
                <Pressable
                  key={cert.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setSelectedId(cert.id)}
                  style={({ pressed }) => [
                    styles.item,
                    isWide && styles.itemWide,
                    isSelected && styles.itemSelected,
                    pressed && styles.itemPressed,
                  ]}
                >
                  <Text style={styles.name}>{cert.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, isWide && styles.footerWide]}>
        <Pressable
          accessibilityRole="button"
          disabled={!selected}
          onPress={handleStart}
          style={({ pressed }) => [
            styles.cta,
            !selected && styles.ctaDisabled,
            pressed && selected && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaLabel, !selected && styles.ctaLabelDisabled]}>
            {selected ? `${selected.name} で始める` : '資格を選択してください'}
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={isAddOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAddModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeAddModal} />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>資格を追加</Text>
            <Text style={styles.modalLead}>学びたい資格名を入力してください</Text>
            <TextInput
              autoFocus
              value={draftName}
              onChangeText={setDraftName}
              placeholder="例: 基本情報技術者試験"
              placeholderTextColor={colors.muted}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
            />
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={closeAddModal}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!trimmedName}
                onPress={handleAdd}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !trimmedName && styles.primaryButtonDisabled,
                  pressed && trimmedName && styles.primaryButtonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.primaryButtonLabel,
                    !trimmedName && styles.primaryButtonLabelDisabled,
                  ]}
                >
                  追加する
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.mist,
  },
  heroWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: colors.accentSoft,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 120,
  },
  contentWide: {
    paddingHorizontal: 40,
    paddingTop: 72,
    maxWidth: 920,
    width: '100%',
    alignSelf: 'center',
  },
  brand: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 28,
    letterSpacing: 0.5,
    color: colors.ink,
    marginBottom: 20,
  },
  headline: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 26,
    lineHeight: 36,
    color: colors.ink,
    marginBottom: 10,
  },
  lead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    lineHeight: 24,
    color: colors.inkSoft,
    marginBottom: 20,
    maxWidth: 520,
  },
  addButton: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
    backgroundColor: colors.paper,
  },
  addButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  addButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.accentDeep,
  },
  empty: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 24,
    backgroundColor: colors.paper,
  },
  emptyTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
    marginBottom: 8,
  },
  emptyBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  list: {
    gap: 12,
  },
  listWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  item: {
    backgroundColor: colors.paper,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    width: '100%',
  },
  itemWide: {
    width: '48.5%',
    flexGrow: 1,
  },
  itemSelected: {
    borderColor: colors.selectedBorder,
    backgroundColor: colors.accentSoft,
  },
  itemPressed: {
    opacity: 0.92,
  },
  name: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 17,
    lineHeight: 26,
    color: colors.ink,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: 'rgba(240, 244, 248, 0.92)',
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  footerWide: {
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 520,
  },
  ctaDisabled: {
    backgroundColor: colors.line,
  },
  ctaPressed: {
    backgroundColor: colors.accentDeep,
  },
  ctaLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.paper,
  },
  ctaLabelDisabled: {
    color: colors.muted,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(16, 42, 67, 0.45)',
  },
  modalCard: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 22,
    zIndex: 1,
  },
  modalCardWide: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  modalTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 20,
    color: colors.ink,
    marginBottom: 8,
  },
  modalLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 14,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 16,
    color: colors.ink,
    marginBottom: 18,
    backgroundColor: colors.mist,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.mist,
  },
  secondaryButtonPressed: {
    opacity: 0.85,
  },
  secondaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
  },
  primaryButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.accent,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.line,
  },
  primaryButtonPressed: {
    backgroundColor: colors.accentDeep,
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
