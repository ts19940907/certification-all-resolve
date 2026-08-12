import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  generateExampleAuto,
  generateExampleConditioned,
  getGenerateErrorMessage,
} from '../lib/examplesApi';
import { colors } from '../theme/colors';
import {
  listEnabledFormats,
  questionFormatLabel,
  type ConditionedFormatChoice,
  type ConditionedImagePayload,
  type QuestionFormatBit,
} from '../types/example';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

function readFileAsConditionedImage(
  file: File,
): Promise<ConditionedImagePayload> {
  return new Promise((resolve, reject) => {
    const mime = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
    if (!ALLOWED_IMAGE_TYPES.has(mime)) {
      reject(new Error('画像は PNG / JPG / WebP のみ対応しています。'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('画像サイズは最大5MBまでです。'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      const dataBase64 = comma >= 0 ? result.slice(comma + 1) : result;
      if (!dataBase64) {
        reject(new Error('画像の読み込みに失敗しました。'));
        return;
      }
      resolve({
        mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime,
        dataBase64,
        fileName: file.name || 'image',
      });
    };
    reader.readAsDataURL(file);
  });
}

type CreateTab = 'ai' | 'manual';

type Props = {
  visible: boolean;
  certificationId: string;
  certificationName: string;
  questionFormat: number;
  onClose: () => void;
  onGenerated?: (example: { id: string; title: string }) => void;
};

export function ExampleCreateModal({
  visible,
  certificationId,
  certificationName,
  questionFormat,
  onClose,
  onGenerated,
}: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 760;
  const [tab, setTab] = useState<CreateTab>('ai');
  const [keywords, setKeywords] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [formatChoice, setFormatChoice] =
    useState<ConditionedFormatChoice>('auto');
  const [conditionedImage, setConditionedImage] =
    useState<ConditionedImagePayload | null>(null);
  const [imagePreviewUri, setImagePreviewUri] = useState<string | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [manualExplanation, setManualExplanation] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const enabledFormats = useMemo(
    () => listEnabledFormats(questionFormat),
    [questionFormat],
  );

  const canConditionedGenerate = useMemo(() => {
    if (formatChoice !== 'auto') return true;
    return (
      keywords.trim().length > 0 ||
      referenceUrl.trim().length > 0 ||
      conditionedImage != null
    );
  }, [formatChoice, keywords, referenceUrl, conditionedImage]);

  useEffect(() => {
    if (!visible) return;
    setFormatChoice('auto');
  }, [visible, questionFormat]);

  const clearConditionedImage = () => {
    setConditionedImage(null);
    setImagePreviewUri(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const resetFields = () => {
    setTab('ai');
    setKeywords('');
    setReferenceUrl('');
    setFormatChoice('auto');
    clearConditionedImage();
    setManualTitle('');
    setManualQuestion('');
    setManualAnswer('');
    setManualExplanation('');
    setNotice(null);
  };

  const pickImageFromFileList = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const payload = await readFileAsConditionedImage(file);
      setConditionedImage(payload);
      setImagePreviewUri(
        `data:${payload.mimeType};base64,${payload.dataBase64}`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '画像の読み込みに失敗しました。',
      );
    }
  };

  const openImagePicker = () => {
    if (Platform.OS !== 'web' || isGenerating) return;
    if (typeof document === 'undefined') {
      setNotice('画像アップロードは Web / デスクトップ版で利用できます。');
      return;
    }
    let input = fileInputRef.current;
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.style.display = 'none';
      input.onchange = () => {
        void pickImageFromFileList(input?.files ?? null);
      };
      document.body.appendChild(input);
      fileInputRef.current = input;
    }
    input.click();
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
  };

  const resetAndClose = () => {
    cancelGeneration();
    resetFields();
    onClose();
  };

  const handleAutoGenerate = async () => {
    if (isGenerating) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setNotice(null);

    try {
      const example = await generateExampleAuto({
        certificationId,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      onGenerated?.(example);
      resetFields();
      setIsGenerating(false);
      abortRef.current = null;
      onClose();
    } catch (error) {
      if (controller.signal.aborted) {
        setIsGenerating(false);
        abortRef.current = null;
        return;
      }
      setIsGenerating(false);
      abortRef.current = null;
      setNotice(getGenerateErrorMessage(error));
    }
  };

  const handleConditionedGenerate = async () => {
    if (isGenerating || !canConditionedGenerate) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setNotice(null);

    try {
      const example = await generateExampleConditioned({
        certificationId,
        format: formatChoice,
        keywords,
        referenceUrl,
        image: conditionedImage,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      onGenerated?.(example);
      resetFields();
      setIsGenerating(false);
      abortRef.current = null;
      onClose();
    } catch (error) {
      if (controller.signal.aborted) {
        setIsGenerating(false);
        abortRef.current = null;
        return;
      }
      setIsGenerating(false);
      abortRef.current = null;
      setNotice(getGenerateErrorMessage(error));
    }
  };

  const formatOptions: Array<{
    key: ConditionedFormatChoice;
    label: string;
  }> = [
    { key: 'auto', label: 'おまかせ' },
    ...enabledFormats.map((bit: QuestionFormatBit) => ({
      key: bit as ConditionedFormatChoice,
      label: questionFormatLabel(bit),
    })),
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={resetAndClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={isGenerating ? undefined : resetAndClose}
        />
        <View style={[styles.card, isWide ? styles.cardWide : styles.cardNarrow]}>
          <View style={styles.header}>
            <Text style={styles.title}>例題を新規作成</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              disabled={isGenerating}
              onPress={resetAndClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.closeButtonPressed,
                isGenerating && styles.disabled,
              ]}
            >
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: tab === 'ai' }}
              disabled={isGenerating}
              onPress={() => setTab('ai')}
              style={[styles.tab, tab === 'ai' && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, tab === 'ai' && styles.tabLabelActive]}>
                AIで作成
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: tab === 'manual' }}
              disabled={isGenerating}
              onPress={() => setTab('manual')}
              style={[styles.tab, tab === 'manual' && styles.tabActive]}
            >
              <Text
                style={[styles.tabLabel, tab === 'manual' && styles.tabLabelActive]}
              >
                手動で作成
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {tab === 'ai' ? (
              <>
                <Text style={styles.sectionLead}>作成方法を選択してください</Text>
                <View style={[styles.aiRow, !isWide && styles.aiRowStacked]}>
                  <View style={[styles.methodCard, !isWide && styles.methodCardStacked]}>
                    <View style={styles.methodIcon}>
                      <Text style={styles.methodIconLabel}>AI</Text>
                    </View>
                    <Text style={styles.methodTitle}>AIに丸投げ</Text>
                    <Text style={styles.methodDesc}>
                      キーワード指定なしでAIが例題を自動生成（有効な形式からおまかせ）
                    </Text>
                    <View style={styles.benefitBox}>
                      <Text style={styles.benefitItem}>・AIが最適なテーマを選定</Text>
                      <Text style={styles.benefitItem}>・査読AIで精度を補正</Text>
                      <Text style={styles.benefitItem}>・既存例題と重複しないよう生成</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isGenerating}
                      onPress={() => {
                        void handleAutoGenerate();
                      }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && styles.primaryButtonPressed,
                        isGenerating && styles.disabled,
                      ]}
                    >
                      <Text style={styles.primaryButtonLabel}>AIで自動生成</Text>
                    </Pressable>
                  </View>

                  <View style={[styles.methodCard, !isWide && styles.methodCardStacked]}>
                    <View style={[styles.methodIcon, styles.methodIconAlt]}>
                      <Text style={styles.methodIconLabelAlt}>条件</Text>
                    </View>
                    <Text style={styles.methodTitle}>条件を指定して作成</Text>
                    <Text style={styles.methodDesc}>
                      指定した条件に基づいてAIが例題を生成します
                    </Text>

                    <Text style={styles.fieldLabel}>問題形式</Text>
                    <View style={styles.formatRow}>
                      {formatOptions.map((option) => {
                        const selected = formatChoice === option.key;
                        return (
                          <Pressable
                            key={String(option.key)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            disabled={isGenerating}
                            onPress={() => setFormatChoice(option.key)}
                            style={[
                              styles.formatChip,
                              selected && styles.formatChipSelected,
                            ]}
                          >
                            <Text
                              style={[
                                styles.formatChipLabel,
                                selected && styles.formatChipLabelSelected,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {enabledFormats.length === 0 ? (
                      <Text style={styles.formatHint}>
                        この資格の question_format が未設定です。レコード更新後に形式チップが表示されます。
                      </Text>
                    ) : null}

                    <Text style={styles.fieldLabel}>キーワード（任意）</Text>
                    <TextInput
                      value={keywords}
                      onChangeText={setKeywords}
                      editable={!isGenerating}
                      placeholder="例）IAM、クロスアカウント、S3バケットポリシー"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                    />

                    <Text style={styles.fieldLabel}>入れてほしい画像（任意）</Text>
                    <View style={styles.dropZone}>
                      {imagePreviewUri ? (
                        <>
                          <Image
                            source={{ uri: imagePreviewUri }}
                            style={styles.imagePreview}
                            resizeMode="contain"
                          />
                          <Text style={styles.dropZoneTitle}>
                            {conditionedImage?.fileName ?? '選択済み'}
                          </Text>
                          <View style={styles.imageActions}>
                            <Pressable
                              accessibilityRole="button"
                              disabled={isGenerating}
                              onPress={openImagePicker}
                              style={styles.changeImageButton}
                            >
                              <Text style={styles.changeImageLabel}>差し替え</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              disabled={isGenerating}
                              onPress={clearConditionedImage}
                              style={styles.removeImageButton}
                            >
                              <Text style={styles.removeImageLabel}>外す</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          disabled={isGenerating}
                          onPress={openImagePicker}
                          style={({ pressed }) => [
                            styles.dropZoneInner,
                            pressed && styles.dropZonePressed,
                            isGenerating && styles.disabled,
                          ]}
                        >
                          <Text style={styles.dropZoneTitle}>画像を選択</Text>
                          <Text style={styles.dropZoneHint}>
                            PNG, JPG, WebP（最大5MB）／Web・デスクトップ向け
                          </Text>
                        </Pressable>
                      )}
                    </View>

                    <Text style={styles.fieldLabel}>参考リンク（任意）</Text>
                    <TextInput
                      value={referenceUrl}
                      onChangeText={setReferenceUrl}
                      editable={!isGenerating}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="例）https://docs.aws.amazon.com/…"
                      placeholderTextColor={colors.muted}
                      style={styles.input}
                    />

                    <View style={styles.infoBox}>
                      <Text style={styles.infoText}>
                        参考リンクはページ内容を取得して出題材料に使います。画像は出題に使えるかAIが判定し、使えなければ描き直して問題に載せます。
                      </Text>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      disabled={isGenerating || !canConditionedGenerate}
                      onPress={() => {
                        void handleConditionedGenerate();
                      }}
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && styles.primaryButtonPressed,
                        (isGenerating || !canConditionedGenerate) &&
                          styles.disabled,
                      ]}
                    >
                      <Text style={styles.primaryButtonLabel}>条件付きで生成</Text>
                    </Pressable>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.manualWrap}>
                <Text style={styles.sectionLead}>
                  手動作成の保存は編集フローと合わせて後続実装します。見た目の確認用フォームです。
                </Text>
                <Text style={styles.fieldLabel}>タイトル</Text>
                <TextInput
                  value={manualTitle}
                  onChangeText={setManualTitle}
                  editable={!isGenerating}
                  placeholder="例題のタイトル"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <Text style={styles.fieldLabel}>問題文</Text>
                <TextInput
                  value={manualQuestion}
                  onChangeText={setManualQuestion}
                  editable={!isGenerating}
                  placeholder="問題文を入力"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.multiline]}
                  multiline
                  textAlignVertical="top"
                />
                <Text style={styles.fieldLabel}>回答</Text>
                <TextInput
                  value={manualAnswer}
                  onChangeText={setManualAnswer}
                  editable={!isGenerating}
                  placeholder="回答を入力"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
                <Text style={styles.fieldLabel}>解説</Text>
                <TextInput
                  value={manualExplanation}
                  onChangeText={setManualExplanation}
                  editable={!isGenerating}
                  placeholder="解説を入力"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.multiline]}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={isGenerating ? cancelGeneration : resetAndClose}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.cancelButtonPressed,
              ]}
            >
              <Text style={styles.cancelButtonLabel}>
                {isGenerating ? '作成を中止' : 'キャンセル'}
              </Text>
            </Pressable>
          </View>

          {isGenerating ? (
            <View style={styles.generatingOverlay} pointerEvents="auto">
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.generatingTitle}>例題を作成中…</Text>
              <Text style={styles.generatingBody}>
                生成と査読が終わるまでお待ちください。失敗時は裏で再作成します。
              </Text>
              <Text style={styles.generatingCert}>{certificationName}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Modal
        visible={notice != null}
        transparent
        animationType="fade"
        onRequestClose={() => setNotice(null)}
      >
        <View style={styles.noticeOverlay}>
          <Pressable style={styles.backdrop} onPress={() => setNotice(null)} />
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>お知らせ</Text>
            <Text style={styles.noticeBody}>{notice}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setNotice(null)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonLabel}>閉じる</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(16, 42, 67, 0.45)',
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    zIndex: 1,
    maxHeight: '92%',
    overflow: 'hidden',
    alignSelf: 'center',
    width: '100%',
  },
  cardWide: {
    maxWidth: 920,
  },
  cardNarrow: {
    maxWidth: 560,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  title: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 20,
    color: colors.ink,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mist,
  },
  closeButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  closeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 22,
    color: colors.inkSoft,
    marginTop: -2,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    marginHorizontal: 20,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.accentDeep,
  },
  bodyScroll: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
    marginBottom: 14,
  },
  aiRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'stretch',
  },
  aiRowStacked: {
    flexDirection: 'column',
  },
  methodCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    backgroundColor: colors.paper,
  },
  methodCardStacked: {
    width: '100%',
  },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  methodIconAlt: {
    backgroundColor: colors.mist,
  },
  methodIconLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.accentDeep,
  },
  methodIconLabelAlt: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  methodTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 17,
    color: colors.ink,
    marginBottom: 6,
  },
  methodDesc: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
    marginBottom: 12,
  },
  benefitBox: {
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    padding: 12,
    gap: 6,
    marginBottom: 16,
  },
  benefitItem: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.accentDeep,
  },
  fieldLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
    marginBottom: 6,
  },
  formatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  formatChip: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.mist,
  },
  formatChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  formatChipLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  formatChipLabelSelected: {
    color: colors.accentDeep,
  },
  formatHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 12,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.mist,
    marginBottom: 12,
  },
  multiline: {
    minHeight: 88,
  },
  dropZone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    backgroundColor: colors.mist,
    marginBottom: 12,
    gap: 8,
  },
  dropZoneInner: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 4,
  },
  dropZonePressed: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  dropZoneTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
    textAlign: 'center',
  },
  dropZoneHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },
  imagePreview: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    backgroundColor: colors.paper,
  },
  imageActions: {
    flexDirection: 'row',
    gap: 8,
  },
  changeImageButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.paper,
  },
  changeImageLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.accentDeep,
  },
  removeImageButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.paper,
  },
  removeImageLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.spotlight,
  },
  infoBox: {
    backgroundColor: '#E8F1FB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  infoText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    lineHeight: 19,
    color: colors.inkSoft,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  primaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  manualWrap: {
    paddingBottom: 8,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButton: {
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.mist,
  },
  cancelButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  cancelButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
  },
  disabled: {
    opacity: 0.55,
  },
  generatingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 10,
    zIndex: 5,
  },
  generatingTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
    marginTop: 8,
  },
  generatingBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
    textAlign: 'center',
  },
  generatingCert: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.muted,
  },
  noticeOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  noticeCard: {
    backgroundColor: colors.paper,
    borderRadius: 16,
    padding: 20,
    zIndex: 2,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    gap: 12,
  },
  noticeTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
  },
  noticeBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    marginBottom: 4,
  },
});
