import { useEffect, useMemo, useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import {
  fetchExampleDetail,
  getExampleErrorMessage,
  shuffleChoices,
} from '../lib/examplesApi';
import { colors } from '../theme/colors';
import {
  isSelectExample,
  type ExampleDetail,
  type SelectAnswer,
} from '../types/example';

type Props = {
  visible: boolean;
  exampleId: string | null;
  onClose: () => void;
};

type DisplayChoice = SelectAnswer & { label: string };

function toChoiceLabel(index: number) {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

export function ExampleSolveModal({ visible, exampleId, onClose }: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [example, setExample] = useState<ExampleDetail | null>(null);
  const [choices, setChoices] = useState<DisplayChoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [descriptiveDraft, setDescriptiveDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !exampleId) {
      setExample(null);
      setChoices([]);
      setSelectedIds([]);
      setDescriptiveDraft('');
      setRevealed(false);
      setAiNotice(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setRevealed(false);
    setSelectedIds([]);
    setDescriptiveDraft('');

    void (async () => {
      try {
        const detail = await fetchExampleDetail(exampleId);
        if (cancelled) return;
        setExample(detail);
        const shuffled = shuffleChoices(detail.choices).map((choice, index) => ({
          ...choice,
          label: toChoiceLabel(index),
        }));
        setChoices(shuffled);
      } catch (err) {
        if (cancelled) return;
        setError(getExampleErrorMessage(err, '例題の読み込みに失敗しました。'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, exampleId]);

  const isSelect = example ? isSelectExample(example) : false;
  const correctCount = useMemo(
    () => choices.filter((c) => c.isAnswer).length,
    [choices],
  );
  const isMultiple = isSelect && correctCount >= 2;

  const correctLabels = useMemo(
    () =>
      choices
        .filter((c) => c.isAnswer)
        .map((c) => c.label)
        .join(', '),
    [choices],
  );

  const toggleChoice = (id: string) => {
    if (revealed) return;
    if (!isMultiple) {
      setSelectedIds([id]);
      return;
    }
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const canCheck = isSelect
    ? selectedIds.length > 0
    : descriptiveDraft.trim().length > 0;

  const handleCheck = () => {
    if (!canCheck) return;
    setRevealed(true);
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={[styles.card, isWide ? styles.cardWide : styles.cardNarrow]}>
          <View style={styles.header}>
            <Text style={styles.title}>例題を解く</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              onPress={handleClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.closeButtonPressed,
              ]}
            >
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.centerText}>読み込み中…</Text>
              </View>
            ) : error ? (
              <View style={styles.centerBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : example ? (
              <View style={styles.panel}>
                <View style={styles.panelHeader}>
                  <View style={styles.panelIcon}>
                    <Text style={styles.panelIconLabel}>例</Text>
                  </View>
                  <Text style={styles.panelTitle}>例題</Text>
                </View>

                {example.title ? (
                  <Text style={styles.exampleTitle}>{example.title}</Text>
                ) : null}

                <Text style={styles.questionText}>Q. {example.question}</Text>

                {isSelect ? (
                  <View style={styles.choiceList}>
                    {choices.map((choice) => {
                      const selected = selectedIds.includes(choice.id);
                      const showCorrect = revealed && choice.isAnswer;
                      const showWrong =
                        revealed && selected && !choice.isAnswer;
                      return (
                        <Pressable
                          key={choice.id}
                          accessibilityRole={
                            isMultiple ? 'checkbox' : 'radio'
                          }
                          accessibilityState={{
                            selected,
                            checked: selected,
                          }}
                          disabled={revealed}
                          onPress={() => toggleChoice(choice.id)}
                          style={[
                            styles.choiceRow,
                            selected && !revealed && styles.choiceRowSelected,
                            showCorrect && styles.choiceRowCorrect,
                            showWrong && styles.choiceRowWrong,
                          ]}
                        >
                          <View
                            style={[
                              styles.choiceMark,
                              selected && styles.choiceMarkSelected,
                              showCorrect && styles.choiceMarkCorrect,
                            ]}
                          >
                            {isMultiple ? (
                              <Text
                                style={[
                                  styles.choiceMarkText,
                                  selected && styles.choiceMarkTextSelected,
                                ]}
                              >
                                {selected ? '✓' : ''}
                              </Text>
                            ) : (
                              <View
                                style={[
                                  styles.radioDot,
                                  selected && styles.radioDotSelected,
                                ]}
                              />
                            )}
                          </View>
                          <Text style={styles.choiceLabel}>{choice.label}.</Text>
                          <Text style={styles.choiceValue}>{choice.value}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.descriptiveWrap}>
                    <Text style={styles.fieldHint}>
                      {revealed ? '模範解答' : '解答を入力してください'}
                    </Text>
                    {revealed ? (
                      <Text style={styles.modelAnswer}>{example.answer}</Text>
                    ) : (
                      <TextInput
                        value={descriptiveDraft}
                        onChangeText={setDescriptiveDraft}
                        placeholder="ここに解答を書く"
                        placeholderTextColor={colors.muted}
                        style={styles.descriptiveInput}
                        multiline
                        textAlignVertical="top"
                      />
                    )}
                    {revealed && descriptiveDraft.trim() ? (
                      <View style={styles.yourAnswerBox}>
                        <Text style={styles.yourAnswerLabel}>あなたの解答</Text>
                        <Text style={styles.yourAnswerText}>
                          {descriptiveDraft.trim()}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}

                {revealed && isSelect ? (
                  <View style={styles.answerBadge}>
                    <Text style={styles.answerBadgeLabel}>
                      正解: {correctLabels || '—'}
                    </Text>
                  </View>
                ) : null}

                {revealed ? (
                  <View style={styles.afterSolve}>
                    <View style={styles.explainBlock}>
                      <Text style={styles.explainTitle}>解説</Text>
                      <Text style={styles.explainBody}>
                        {example.explanation || '解説はまだありません。'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setAiNotice(
                          'この例題についてAIに質問する機能は、次の実装で接続します。',
                        )
                      }
                      style={({ pressed }) => [
                        styles.aiButton,
                        pressed && styles.aiButtonPressed,
                      ]}
                    >
                      <Text style={styles.aiButtonLabel}>AIに質問する</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          {!revealed && example && !loading && !error ? (
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                disabled={!canCheck}
                onPress={handleCheck}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                  !canCheck && styles.primaryButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.primaryButtonLabel,
                    !canCheck && styles.primaryButtonLabelDisabled,
                  ]}
                >
                  答え合わせ
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      <Modal
        visible={aiNotice != null}
        transparent
        animationType="fade"
        onRequestClose={() => setAiNotice(null)}
      >
        <View style={styles.noticeOverlay}>
          <Pressable style={styles.backdrop} onPress={() => setAiNotice(null)} />
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>お知らせ</Text>
            <Text style={styles.noticeBody}>{aiNotice}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAiNotice(null)}
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
    maxWidth: 560,
  },
  cardNarrow: {
    maxWidth: 520,
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
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef1209',
  },
  closeButtonPressed: {
    backgroundColor: '#c40e07',
  },
  closeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 20,
    color: colors.paper,
    marginTop: -2,
  },
  bodyScroll: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  centerBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  centerText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.spotlightDeep,
    textAlign: 'center',
  },
  panel: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    backgroundColor: colors.paper,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  panelIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelIconLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.paper,
  },
  panelTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
  },
  exampleTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
    marginBottom: 10,
  },
  questionText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    lineHeight: 24,
    color: colors.ink,
    marginBottom: 16,
  },
  choiceList: {
    gap: 10,
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.paper,
  },
  choiceRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  choiceRowCorrect: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  choiceRowWrong: {
    borderColor: colors.spotlight,
    backgroundColor: '#FFF1EC',
  },
  choiceMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    backgroundColor: colors.paper,
  },
  choiceMarkSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  choiceMarkCorrect: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  choiceMarkText: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.muted,
  },
  choiceMarkTextSelected: {
    color: colors.paper,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  radioDotSelected: {
    backgroundColor: colors.paper,
  },
  choiceLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
    minWidth: 22,
  },
  choiceValue: {
    flex: 1,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
  },
  descriptiveWrap: {
    gap: 8,
  },
  fieldHint: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  descriptiveInput: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    minHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 12,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.mist,
  },
  modelAnswer: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    padding: 12,
  },
  yourAnswerBox: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    backgroundColor: colors.mist,
  },
  yourAnswerLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
    marginBottom: 6,
  },
  yourAnswerText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
  },
  answerBadge: {
    alignSelf: 'flex-start',
    marginTop: 16,
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  answerBadgeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  afterSolve: {
    marginTop: 18,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 16,
  },
  explainBlock: {
    gap: 8,
  },
  explainTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
  },
  explainBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  aiButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  aiButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  aiButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
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
