import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { ExampleCreateModal } from '../components/ExampleCreateModal';
import { ExampleSolveModal } from '../components/ExampleSolveModal';
import { fetchExamples } from '../lib/examplesApi';
import { getErrorMessage } from '../lib/certificationsApi';
import { colors } from '../theme/colors';
import type { Certification } from '../types/certification';
import type { ExampleSummary } from '../types/example';

type Props = {
  certification: Certification;
  onBack: () => void;
};

const MIN_QUESTION_COUNT = 10;
const MAX_QUESTION_COUNT = 25;
const DEFAULT_QUESTION_COUNT = 10;

/** 新しい順。本実装では実施日時でソートする */
const PLACEHOLDER_HISTORY = [
  {
    id: 'hist-3',
    title: '本番試験（仮）',
    performedAt: '2026-08-02 21:40',
    summary: 'スコア 78点',
  },
  {
    id: 'hist-2',
    title: '例題を解く（仮）',
    performedAt: '2026-08-01 19:12',
    summary: '正解 8 / 10',
  },
  {
    id: 'hist-1',
    title: 'キーワードレビュー（仮）',
    performedAt: '2026-07-30 08:05',
    summary: '理解度 B',
  },
];

function clampQuestionCount(value: number) {
  return Math.min(MAX_QUESTION_COUNT, Math.max(MIN_QUESTION_COUNT, value));
}

export function CertMainScreen({ certification, onBack }: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const isMid = width >= 720;
  const [questionCountText, setQuestionCountText] = useState(
    String(DEFAULT_QUESTION_COUNT),
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [solveExampleId, setSolveExampleId] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [examplesError, setExamplesError] = useState<string | null>(null);
  const [examplesLoading, setExamplesLoading] = useState(true);

  const loadExamples = useCallback(async () => {
    setExamplesLoading(true);
    setExamplesError(null);
    try {
      const rows = await fetchExamples(certification.id);
      setExamples(rows);
    } catch (error) {
      setExamplesError(getErrorMessage(error, '例題一覧の取得に失敗しました'));
    } finally {
      setExamplesLoading(false);
    }
  }, [certification.id]);

  useEffect(() => {
    void loadExamples();
  }, [loadExamples]);

  const handleQuestionCountChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 2);
    if (!digits) {
      // 空にはできないので、入力中は一旦空表示を避けて前回値を維持
      return;
    }

    const next = Number(digits);
    if (Number.isNaN(next)) {
      return;
    }

    // 2桁になった時点で 10〜25 以外は受け付けない
    if (digits.length === 2 && (next < MIN_QUESTION_COUNT || next > MAX_QUESTION_COUNT)) {
      return;
    }

    // 1桁は 1〜2 のみ（10〜25 を組み立てる途中）
    if (digits.length === 1 && next !== 1 && next !== 2) {
      return;
    }

    setQuestionCountText(digits);
  };

  const handleQuestionCountBlur = () => {
    const parsed = Number(questionCountText);
    const next = Number.isNaN(parsed)
      ? DEFAULT_QUESTION_COUNT
      : clampQuestionCount(parsed);
    setQuestionCountText(String(next));
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, !isWide && styles.headerStacked]}>
        {isWide ? (
          <>
            <View style={styles.headerTitleOverlay} pointerEvents="none">
              <Text style={styles.brand}>CertResolve</Text>
              <Text style={styles.certName} numberOfLines={2}>
                {certification.name}
              </Text>
            </View>
            <View style={[styles.headerSide, styles.headerSideLeft]}>
              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                style={({ pressed }) => [styles.backLink, pressed && styles.backLinkPressed]}
              >
                <Text style={styles.backLinkLabel}>← 選択画面に戻る</Text>
              </Pressable>
            </View>
            <View style={styles.headerTitleSpacer} />
            <View style={[styles.headerSide, styles.headerSideRight]}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.examButton,
                  pressed && styles.examButtonPressed,
                ]}
              >
                <Text style={styles.examButtonLabel}>本番試験を実施</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={onBack}
              style={({ pressed }) => [styles.backLink, pressed && styles.backLinkPressed]}
            >
              <Text style={styles.backLinkLabel}>← 選択画面に戻る</Text>
            </Pressable>
            <View style={styles.headerTitle}>
              <Text style={styles.brand}>CertResolve</Text>
              <Text style={styles.certName} numberOfLines={2}>
                {certification.name}
              </Text>
            </View>
            <View style={styles.headerSideRightStacked}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.examButton,
                  pressed && styles.examButtonPressed,
                ]}
              >
                <Text style={styles.examButtonLabel}>本番試験を実施</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      <View style={[styles.body, !isWide && styles.bodyStacked]}>
        <View
          style={[
            styles.mainColumn,
            isWide && styles.mainColumnWide,
            !isMid && styles.mainColumnStacked,
          ]}
        >
          <View style={[styles.historyPanel, isMid && styles.historyPanelBeside]}>
            <Text style={styles.panelTitle}>実施履歴</Text>
            <Text style={styles.panelLead}>最新順に表示されます</Text>
            <ScrollView
              style={styles.panelScroll}
              contentContainerStyle={styles.panelScrollContent}
              showsVerticalScrollIndicator
            >
              {PLACEHOLDER_HISTORY.map((item) => (
                <View key={item.id} style={styles.historyRow}>
                  <View style={styles.historyMain}>
                    <Text style={styles.historyTime}>{item.performedAt}</Text>
                    <Text style={styles.historyTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.historySummary}>{item.summary}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.historyDetailButton,
                      pressed && styles.historyDetailButtonPressed,
                    ]}
                  >
                    <Text style={styles.historyDetailButtonLabel}>詳細</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.examplesPanel, isMid && styles.examplesPanelBeside]}>
            <View style={styles.examplesHeader}>
              <Text style={styles.examplesTitle}>例題一覧</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsCreateOpen(true)}
                style={({ pressed }) => [
                  styles.createButton,
                  pressed && styles.createButtonPressed,
                ]}
              >
                <Text style={styles.createButtonLabel}>＋例題を新規作成</Text>
              </Pressable>
            </View>

            <View style={styles.questionCountRow}>
              <TextInput
                value={questionCountText}
                onChangeText={handleQuestionCountChange}
                onBlur={handleQuestionCountBlur}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={2}
                style={styles.questionCountInput}
                accessibilityLabel="問題数"
              />
              <Text style={styles.questionCountUnit}>問</Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.solveButton,
                  pressed && styles.solveButtonPressed,
                ]}
              >
                <Text style={styles.solveButtonLabel}>例題を解く</Text>
              </Pressable>
              <Text style={styles.questionCountHint}>※10〜25問のみ入力可</Text>
            </View>

            <ScrollView
              style={styles.panelScroll}
              contentContainerStyle={styles.panelScrollContent}
              showsVerticalScrollIndicator
            >
              {examplesLoading ? (
                <Text style={styles.panelLead}>例題を読み込み中…</Text>
              ) : examplesError ? (
                <Text style={styles.panelLead}>{examplesError}</Text>
              ) : examples.length === 0 ? (
                <Text style={styles.panelLead}>
                  まだ例題がありません。「＋例題を新規作成」から追加できます。
                </Text>
              ) : (
                examples.map((example) => (
                  <View key={example.id} style={styles.exampleRow}>
                    <Text style={styles.exampleTitle} numberOfLines={2}>
                      {example.title}
                    </Text>
                    <View style={styles.exampleActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSolveExampleId(example.id)}
                        style={({ pressed }) => [
                          styles.rowAction,
                          pressed && styles.rowActionPressed,
                        ]}
                      >
                        <Text style={styles.rowActionLabel}>単独で解く</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.rowAction,
                          styles.rowActionSecondary,
                          pressed && styles.rowActionPressed,
                        ]}
                      >
                        <Text style={styles.rowActionLabelSecondary}>編集</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.rowAction,
                          styles.rowActionDanger,
                          pressed && styles.rowActionPressed,
                        ]}
                      >
                        <Text style={styles.rowActionLabelDanger}>削除</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>

        <View style={[styles.keywordPanel, isWide && styles.keywordPanelWide]}>
          <Text style={styles.sectionLabel}>キーワードの自己説明</Text>
          <Text style={styles.keywordLead}>
            キーワードと説明を分けて入力し、自分自身のキーワードの理解度をAIにチェックしてもらうことができます。
          </Text>

          <Text style={styles.fieldLabel}>キーワード</Text>
          <TextInput
            editable
            placeholder="キーワードを入力"
            placeholderTextColor={colors.muted}
            style={styles.keywordNameInput}
          />

          <Text style={styles.fieldLabel}>説明</Text>
          <TextInput
            multiline
            editable
            placeholder="自分の言葉で説明を入力"
            placeholderTextColor={colors.muted}
            style={styles.keywordExplainInput}
            textAlignVertical="top"
          />

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.reviewButton,
              pressed && styles.reviewButtonPressed,
            ]}
          >
            <Text style={styles.reviewButtonLabel}>レビューを実施する</Text>
          </Pressable>
        </View>
      </View>

      <ExampleCreateModal
        visible={isCreateOpen}
        certificationId={certification.id}
        certificationName={certification.name}
        questionFormat={certification.questionFormat}
        onClose={() => setIsCreateOpen(false)}
        onGenerated={() => {
          void loadExamples();
        }}
      />

      <ExampleSolveModal
        visible={solveExampleId != null}
        exampleId={solveExampleId}
        onClose={() => setSolveExampleId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.mist,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
  },
  header: {
    position: 'relative',
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  headerTitleOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 160,
  },
  headerTitleSpacer: {
    flex: 1,
  },
  headerSide: {
    zIndex: 1,
    minWidth: 0,
  },
  headerSideLeft: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerSideRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerSideRightStacked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  headerTitle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  brand: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 22,
    color: colors.paper,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  certName: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.accentSoft,
    marginTop: 4,
    textAlign: 'center',
  },
  backLink: {
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  backLinkPressed: {
    opacity: 0.7,
  },
  backLinkLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentSoft,
  },
  examButton: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.spotlight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  examButtonPressed: {
    backgroundColor: colors.spotlightDeep,
  },
  examButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 0,
  },
  bodyStacked: {
    flexDirection: 'column',
  },
  mainColumn: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 0,
  },
  mainColumnWide: {
    flex: 3,
  },
  mainColumnStacked: {
    flexDirection: 'column',
  },
  historyPanel: {
    flex: 1,
    minHeight: 200,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: 14,
  },
  historyPanelBeside: {
    flex: 1,
    maxWidth: 280,
  },
  examplesPanel: {
    flex: 1,
    minHeight: 220,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: 14,
  },
  examplesPanelBeside: {
    flex: 2,
  },
  panelTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 4,
  },
  panelLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 12,
  },
  examplesHeader: {
    position: 'relative',
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  examplesTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
    textAlign: 'center',
  },
  createButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  createButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  createButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.paper,
  },
  questionCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  questionCountInput: {
    width: 56,
    minHeight: 40,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.mist,
    textAlign: 'center',
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  questionCountUnit: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
  },
  solveButton: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  solveButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  solveButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.paper,
  },
  questionCountHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
  sectionLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
    marginBottom: 8,
  },
  panelScroll: {
    flex: 1,
  },
  panelScrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.mist,
  },
  historyMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  historyTime: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 11,
    color: colors.muted,
  },
  historyTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
  },
  historySummary: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.inkSoft,
  },
  historyDetailButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  historyDetailButtonPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  historyDetailButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  exampleRow: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.mist,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  exampleTitle: {
    flex: 1,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
  },
  exampleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 0,
  },
  rowAction: {
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowActionSecondary: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowActionDanger: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: '#D9A5A5',
  },
  rowActionPressed: {
    opacity: 0.85,
  },
  rowActionLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.paper,
  },
  rowActionLabelSecondary: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  rowActionLabelDanger: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: '#9B3B3B',
  },
  keywordPanel: {
    flex: 1,
    minHeight: 240,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: 14,
  },
  keywordPanelWide: {
    flex: 1,
    maxWidth: 340,
  },
  keywordLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
    marginBottom: 12,
  },
  fieldLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
    marginBottom: 6,
  },
  keywordNameInput: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.ink,
    marginBottom: 12,
  },
  keywordExplainInput: {
    flex: 1,
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.ink,
    marginBottom: 12,
  },
  reviewButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  reviewButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  reviewButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
});
