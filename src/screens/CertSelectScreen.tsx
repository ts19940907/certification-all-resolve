import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import {
  canRenameCertification,
  createCertification,
  fetchCertifications,
  getErrorMessage,
  renameCertification,
  setCertificationArchived,
  validateCertificationQuery,
  type ValidatedCertificationCandidate,
} from '../lib/certificationsApi';
import { ensureCertificationMasters } from '../lib/analysisApi';
import { colors } from '../theme/colors';
import type { Certification } from '../types/certification';

type ListTab = 'active' | 'archive';
type NameModalMode = 'add' | 'rename';

type Props = {
  onSelect?: (certification: Certification) => void;
};

function normalizeName(name: string) {
  return name.trim();
}

export function CertSelectScreen({ onSelect }: Props) {
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listTab, setListTab] = useState<ListTab>('active');
  const [nameModalMode, setNameModalMode] = useState<NameModalMode | null>(null);
  const [draftName, setDraftName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Certification | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Certification | null>(null);
  const [restoreFromNameModal, setRestoreFromNameModal] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [confirmCandidate, setConfirmCandidate] =
    useState<ValidatedCertificationCandidate | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const loadCertifications = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchCertifications();
      setCertifications(rows);
    } catch (error) {
      console.error('[CertSelectScreen] load', error);
      setNoticeMessage(
        getErrorMessage(error, '資格一覧の取得に失敗しました。時間をおいて再度お試しください。'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCertifications();
  }, [loadCertifications]);

  const activeCerts = useMemo(
    () => certifications.filter((item) => !item.isArchive),
    [certifications],
  );
  const archivedCerts = useMemo(
    () => certifications.filter((item) => item.isArchive),
    [certifications],
  );
  const visibleCerts = listTab === 'active' ? activeCerts : archivedCerts;
  const selected = certifications.find((item) => item.id === selectedId) ?? null;
  const selectedVisible =
    selected &&
    ((listTab === 'active' && !selected.isArchive) ||
      (listTab === 'archive' && selected.isArchive))
      ? selected
      : null;
  const trimmedName = normalizeName(draftName);
  const canStart = Boolean(selectedVisible && !selectedVisible.isArchive);

  const findByName = (name: string, exceptId?: string) =>
    certifications.find(
      (item) =>
        normalizeName(item.name) === name &&
        (exceptId == null || item.id !== exceptId),
    );

  const switchTab = (tab: ListTab) => {
    setListTab(tab);
    setSelectedId(null);
  };

  const openAddModal = () => {
    setDraftName('');
    setNameError(null);
    setNameModalMode('add');
  };

  const openRenameModal = async (cert: Certification) => {
    setSelectedId(cert.id);
    setDraftName(cert.name);
    setNameError(null);
    setBusy(true);
    try {
      const allowed = await canRenameCertification(cert.id);
      if (!allowed) {
        setNoticeMessage(
          '例題または履歴がある資格は改名できません。中身を空にすると改名できます。',
        );
        return;
      }
      setNameModalMode('rename');
    } catch (error) {
      console.error('[CertSelectScreen] canRename', error);
      setNoticeMessage(
        getErrorMessage(error, '改名できるかの確認に失敗しました。'),
      );
    } finally {
      setBusy(false);
    }
  };

  const closeNameModal = () => {
    setNameModalMode(null);
    setDraftName('');
    setNameError(null);
    setConfirmCandidate(null);
  };

  const applyRestore = async (cert: Certification) => {
    setBusy(true);
    try {
      await setCertificationArchived(cert.userCertificationId, false);
      await loadCertifications();
      setListTab('active');
      setSelectedId(cert.id);
      setRestoreTarget(null);
      setRestoreFromNameModal(false);
      closeNameModal();
    } catch (error) {
      console.error('[CertSelectScreen] restore', error);
      setNoticeMessage(getErrorMessage(error, '復元に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSave = async () => {
    if (!confirmCandidate || busy) return;
    setBusy(true);
    try {
      if (nameModalMode === 'rename') {
        if (!selected || selected.isArchive) {
          throw new Error('改名対象の資格が見つかりません');
        }
        await renameCertification(selected.id, {
          name: confirmCandidate.officialName,
          questionFormat: confirmCandidate.questionFormat,
          choiceMin: confirmCandidate.choiceMin,
          choiceMax: confirmCandidate.choiceMax,
          answerMax: confirmCandidate.answerMax,
        });
        await loadCertifications();
        setConfirmCandidate(null);
        closeNameModal();
        return;
      }

      const created = await createCertification({
        name: confirmCandidate.officialName,
        questionFormat: confirmCandidate.questionFormat,
        choiceMin: confirmCandidate.choiceMin,
        choiceMax: confirmCandidate.choiceMax,
        answerMax: confirmCandidate.answerMax,
      });
      try {
        await ensureCertificationMasters(created.id);
      } catch (masterError) {
        console.error('[CertSelectScreen] ensure masters', masterError);
      }
      await loadCertifications();
      setListTab('active');
      setSelectedId(created.id);
      setConfirmCandidate(null);
      closeNameModal();
    } catch (error) {
      console.error('[CertSelectScreen] confirm save', error);
      const message = getErrorMessage(
        error,
        nameModalMode === 'rename'
          ? '改名に失敗しました。'
          : '資格の追加に失敗しました。',
      );
      setConfirmCandidate(null);
      if (
        message.includes('同じ名前') ||
        message.includes('改名できません') ||
        message.includes('出題形式')
      ) {
        setNameError(message);
      } else {
        setNoticeMessage(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const openOfficialUrl = async (url: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        setNoticeMessage('リンクを開けませんでした。');
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      console.error('[CertSelectScreen] open url', error);
      setNoticeMessage('リンクを開けませんでした。');
    }
  };

  const handleNameSubmit = async () => {
    if (!trimmedName || !nameModalMode || busy) return;

    if (nameModalMode === 'add') {
      const existing = findByName(trimmedName);
      if (existing && !existing.isArchive) {
        setNameError('同じ名前の資格がすでにあります');
        return;
      }
      if (existing && existing.isArchive) {
        setRestoreTarget(existing);
        setRestoreFromNameModal(true);
        return;
      }

      setBusy(true);
      setNameError(null);
      try {
        const candidate = await validateCertificationQuery(trimmedName);
        // 正式名称での重複も確認
        const existingOfficial = findByName(candidate.officialName);
        if (existingOfficial && !existingOfficial.isArchive) {
          setNameError(
            `「${candidate.officialName}」はすでに登録されています`,
          );
          return;
        }
        if (existingOfficial && existingOfficial.isArchive) {
          setRestoreTarget(existingOfficial);
          setRestoreFromNameModal(true);
          return;
        }
        setConfirmCandidate(candidate);
      } catch (error) {
        console.error('[CertSelectScreen] validate', error);
        setNoticeMessage(
          getErrorMessage(error, '資格の照合に失敗しました。'),
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!selected || selected.isArchive) return;

    if (normalizeName(selected.name) === trimmedName) {
      closeNameModal();
      return;
    }

    const existing = findByName(trimmedName, selected.id);
    if (existing && !existing.isArchive) {
      setNameError('同じ名前の資格がすでにあります');
      return;
    }
    if (existing && existing.isArchive) {
      setRestoreTarget(existing);
      setRestoreFromNameModal(true);
      return;
    }

    setBusy(true);
    setNameError(null);
    try {
      const candidate = await validateCertificationQuery(trimmedName);
      const existingOfficial = findByName(candidate.officialName, selected.id);
      if (existingOfficial && !existingOfficial.isArchive) {
        setNameError(
          `「${candidate.officialName}」はすでに登録されています`,
        );
        return;
      }
      if (existingOfficial && existingOfficial.isArchive) {
        setRestoreTarget(existingOfficial);
        setRestoreFromNameModal(true);
        return;
      }
      setConfirmCandidate(candidate);
    } catch (error) {
      console.error('[CertSelectScreen] validate rename', error);
      const message = getErrorMessage(error, '資格の照合に失敗しました。');
      if (message.includes('改名できません')) {
        setNameError(message);
      } else {
        setNoticeMessage(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget || busy) return;
    setBusy(true);
    try {
      await setCertificationArchived(archiveTarget.userCertificationId, true);
      await loadCertifications();
      if (selectedId === archiveTarget.id) {
        setSelectedId(null);
      }
      setArchiveTarget(null);
    } catch (error) {
      console.error('[CertSelectScreen] archive', error);
      setNoticeMessage(getErrorMessage(error, 'アーカイブに失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () => {
    if (!selectedVisible || selectedVisible.isArchive) return;
    onSelect?.(selectedVisible);
  };

  const nameModalTitle = nameModalMode === 'rename' ? '資格名を変更' : '資格を追加';
  const nameModalLead =
    nameModalMode === 'rename'
      ? '新しい資格名を入力してください（変更前に照合します）'
      : '学びたい資格名を入力してください（追加前に照合します）';
  const nameModalSubmitLabel = '照合する';
  const confirmTitle =
    nameModalMode === 'rename'
      ? 'この資格に変更しますか？'
      : 'この資格で登録しますか？';
  const confirmPrimaryLabel =
    nameModalMode === 'rename' ? 'この資格に変更' : 'この資格で登録';
  const submitDisabled = !trimmedName || busy;

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
          学びたい資格を追加し、改名やアーカイブしながら一覧から選べます。データはクラウドに保存されます。
        </Text>

        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={openAddModal}
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          >
            <Text style={styles.addButtonLabel}>＋ 資格を追加</Text>
          </Pressable>

          <View style={styles.tabs}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: listTab === 'active' }}
              onPress={() => switchTab('active')}
              style={[styles.tab, listTab === 'active' && styles.tabSelected]}
            >
              <Text
                style={[styles.tabLabel, listTab === 'active' && styles.tabLabelSelected]}
              >
                学習中
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: listTab === 'archive' }}
              onPress={() => switchTab('archive')}
              style={[styles.tab, listTab === 'archive' && styles.tabSelected]}
            >
              <Text
                style={[styles.tabLabel, listTab === 'archive' && styles.tabLabelSelected]}
              >
                アーカイブ
                {archivedCerts.length > 0 ? ` (${archivedCerts.length})` : ''}
              </Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingLabel}>資格一覧を読み込み中…</Text>
          </View>
        ) : visibleCerts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {listTab === 'active'
                ? 'まだ資格がありません'
                : 'アーカイブは空です'}
            </Text>
            <Text style={styles.emptyBody}>
              {listTab === 'active'
                ? '「資格を追加」から、学びたい資格名を自由に入力してください。'
                : '学習中の資格をアーカイブすると、ここに表示されます。'}
            </Text>
          </View>
        ) : (
          <View style={[styles.list, isWide && styles.listWide]}>
            {visibleCerts.map((cert) => {
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
                  <View style={styles.itemActions}>
                    {listTab === 'active' ? (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={() => {
                            void openRenameModal(cert);
                          }}
                          style={({ pressed }) => [
                            styles.rowAction,
                            pressed && styles.rowActionPressed,
                          ]}
                        >
                          <Text style={styles.rowActionLabel}>改名</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={() => {
                            setSelectedId(cert.id);
                            setArchiveTarget(cert);
                          }}
                          style={({ pressed }) => [
                            styles.rowAction,
                            styles.rowActionMuted,
                            pressed && styles.rowActionPressed,
                          ]}
                        >
                          <Text style={styles.rowActionLabelMuted}>アーカイブ</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => {
                          setSelectedId(cert.id);
                          setRestoreTarget(cert);
                          setRestoreFromNameModal(false);
                        }}
                        style={({ pressed }) => [
                          styles.rowAction,
                          pressed && styles.rowActionPressed,
                        ]}
                      >
                        <Text style={styles.rowActionLabel}>復元</Text>
                      </Pressable>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, isWide && styles.footerWide]}>
        <Pressable
          accessibilityRole="button"
          disabled={!canStart}
          onPress={handleStart}
          style={({ pressed }) => [
            styles.cta,
            !canStart && styles.ctaDisabled,
            pressed && canStart && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaLabel, !canStart && styles.ctaLabelDisabled]}>
            {listTab === 'archive'
              ? 'アーカイブ中は開始できません'
              : selectedVisible
                ? `${selectedVisible.name} で始める`
                : '資格を選択してください'}
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={nameModalMode != null}
        transparent
        animationType="fade"
        onRequestClose={closeNameModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeNameModal} />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>{nameModalTitle}</Text>
            <Text style={styles.modalLead}>{nameModalLead}</Text>
            <TextInput
              autoFocus
              value={draftName}
              onChangeText={(text) => {
                setDraftName(text);
                setNameError(null);
              }}
              placeholder="例: 基本情報技術者試験"
              placeholderTextColor={colors.muted}
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={() => {
                void handleNameSubmit();
              }}
            />
            {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={closeNameModal}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={submitDisabled}
                onPress={() => {
                  void handleNameSubmit();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  submitDisabled && styles.primaryButtonDisabled,
                  pressed && !submitDisabled && styles.primaryButtonPressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text
                    style={[
                      styles.primaryButtonLabel,
                      submitDisabled && styles.primaryButtonLabelDisabled,
                    ]}
                  >
                    {nameModalSubmitLabel}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={confirmCandidate != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setConfirmCandidate(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!busy) setConfirmCandidate(null);
            }}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>{confirmTitle}</Text>
            <Text style={styles.modalLead}>
              勉強したい資格が次で合っているか確認してください。
            </Text>
            <Text style={styles.confirmName}>{confirmCandidate?.officialName}</Text>
            {confirmCandidate?.summary ? (
              <Text style={styles.confirmSummary}>{confirmCandidate.summary}</Text>
            ) : null}
            {confirmCandidate?.officialUrl ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  if (confirmCandidate.officialUrl) {
                    void openOfficialUrl(confirmCandidate.officialUrl);
                  }
                }}
                style={({ pressed }) => [
                  styles.linkButton,
                  pressed && styles.linkButtonPressed,
                ]}
              >
                <Text style={styles.linkButtonLabel}>資格サイトを開く</Text>
              </Pressable>
            ) : (
              <Text style={styles.confirmHint}>
                公式サイトのリンクは特定できませんでした。
              </Text>
            )}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setConfirmCandidate(null)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonLabel}>違う</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  void handleConfirmSave();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.primaryButtonLabel}>{confirmPrimaryLabel}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={archiveTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => setArchiveTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setArchiveTarget(null)}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>アーカイブしますか？</Text>
            <Text style={styles.modalLead}>
              「{archiveTarget?.name}」を学習中一覧から外し、アーカイブへ移します。あとから復元できます。
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setArchiveTarget(null)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  void handleArchiveConfirm();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.primaryButtonLabel}>アーカイブする</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={restoreTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setRestoreTarget(null);
          setRestoreFromNameModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setRestoreTarget(null);
              setRestoreFromNameModal(false);
            }}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>
              {restoreFromNameModal ? 'アーカイブから復元しますか？' : '復元しますか？'}
            </Text>
            <Text style={styles.modalLead}>
              {restoreFromNameModal
                ? `「${restoreTarget?.name}」はアーカイブにあります。新しく追加せず、復元しますか？`
                : `「${restoreTarget?.name}」を学習中一覧に戻します。`}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setRestoreTarget(null);
                  setRestoreFromNameModal(false);
                }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  if (restoreTarget) void applyRestore(restoreTarget);
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.primaryButtonLabel}>復元する</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={noticeMessage != null}
        transparent
        animationType="fade"
        onRequestClose={() => setNoticeMessage(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setNoticeMessage(null)}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>お知らせ</Text>
            <Text style={styles.modalLead}>{noticeMessage}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setNoticeMessage(null)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                <Text style={styles.primaryButtonLabel}>閉じる</Text>
              </Pressable>
            </View>
          </View>
        </View>
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
  toolbar: {
    gap: 14,
    marginBottom: 20,
  },
  addButton: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  tabs: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.paper,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    gap: 4,
  },
  tab: {
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabSelected: {
    backgroundColor: colors.accentSoft,
  },
  tabLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.muted,
  },
  tabLabelSelected: {
    color: colors.accentDeep,
  },
  loadingBox: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.paper,
  },
  loadingLabel: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
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
    gap: 12,
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
  itemActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowAction: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.accentSoft,
  },
  rowActionMuted: {
    backgroundColor: colors.mist,
  },
  rowActionPressed: {
    opacity: 0.85,
  },
  rowActionLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  rowActionLabelMuted: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
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
  confirmName: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    lineHeight: 26,
    color: colors.ink,
    marginBottom: 8,
  },
  confirmSummary: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    marginBottom: 12,
  },
  confirmHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    marginBottom: 16,
  },
  linkButton: {
    alignSelf: 'flex-start',
    marginBottom: 16,
    paddingVertical: 6,
  },
  linkButtonPressed: {
    opacity: 0.7,
  },
  linkButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.accentDeep,
    textDecorationLine: 'underline',
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
    marginBottom: 10,
    backgroundColor: colors.mist,
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.spotlightDeep,
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
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
    minWidth: 96,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
