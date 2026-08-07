import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import { deleteExample, fetchExamples } from '../lib/examplesApi';
import { getErrorMessage } from '../lib/certificationsApi';
import {
  exampleExists,
  fetchHistories,
  getHistoryErrorMessage,
} from '../lib/historiesApi';
import { colors } from '../theme/colors';
import type { Certification } from '../types/certification';
import type { ExampleSummary } from '../types/example';
import type { HistoryChatMessage, HistorySummary } from '../types/history';

type Props = {
  certification: Certification;
  onBack: () => void;
};

type SolveSession = {
  exampleId: string;
  historyId: string | null;
  initialMessages: HistoryChatMessage[];
  resumeMode: boolean;
};

const MIN_QUESTION_COUNT = 10;
const MAX_QUESTION_COUNT = 25;
const DEFAULT_QUESTION_COUNT = 10;

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
  const [solveSession, setSolveSession] = useState<SolveSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExampleSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [examplesError, setExamplesError] = useState<string | null>(null);
  const [examplesLoading, setExamplesLoading] = useState(true);
  const [histories, setHistories] = useState<HistorySummary[]>([]);
  const [historiesError, setHistoriesError] = useState<string | null>(null);
  const [historiesLoading, setHistoriesLoading] = useState(true);

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

  const loadHistories = useCallback(async () => {
    setHistoriesLoading(true);
    setHistoriesError(null);
    try {
      const rows = await fetchHistories(certification.id);
      setHistories(rows);
    } catch (error) {
      setHistoriesError(
        getHistoryErrorMessage(error, '実施履歴の取得に失敗しました'),
      );
    } finally {
      setHistoriesLoading(false);
    }
  }, [certification.id]);

  useEffect(() => {
    void loadExamples();
  }, [loadExamples]);

  useEffect(() => {
    void loadHistories();
  }, [loadHistories]);

  const openSolve = (exampleId: string) => {
    setSolveSession({
      exampleId,
      historyId: null,
      initialMessages: [],
      resumeMode: false,
    });
  };

  const openHistoryDetail = async (item: HistorySummary) => {
    if (item.kind !== 'example_ai_chat' || !item.detail?.example_id) {
      setNoticeMessage('この履歴の詳細表示にはまだ対応していません。');
      return;
    }
    try {
      const exists = await exampleExists(item.detail.example_id);
      if (!exists) {
        setNoticeMessage(
          'この例題は削除されているため、チャットを再開できません。',
        );
        return;
      }
      setSolveSession({
        exampleId: item.detail.example_id,
        historyId: item.id,
        initialMessages: item.detail.messages,
        resumeMode: true,
      });
    } catch (error) {
      setNoticeMessage(
        getHistoryErrorMessage(error, '履歴の詳細を開けませんでした。'),
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteExample(deleteTarget.id);
      if (solveSession?.exampleId === deleteTarget.id) {
        setSolveSession(null);
      }
      setDeleteTarget(null);
      await loadExamples();
      await loadHistories();
    } catch (error) {
      console.error('[CertMainScreen] delete', error);
      setDeleteTarget(null);
      setNoticeMessage(
        getErrorMessage(
          error,
          '例題の削除に失敗しました。時間をおいて再度お試しください。',
        ),
      );
    } finally {
      setDeleteBusy(false);
    }
  };

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
              {historiesLoading ? (
                <View style={styles.historyEmptyBox}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.historyEmptyText}>読み込み中…</Text>
                </View>
              ) : historiesError ? (
                <Text style={styles.historyEmptyText}>{historiesError}</Text>
              ) : histories.length === 0 ? (
                <Text style={styles.historyEmptyText}>
                  まだ実施履歴はありません
                </Text>
              ) : (
                histories.map((item) => (
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
                      onPress={() => {
                        void openHistoryDetail(item);
                      }}
                      style={({ pressed }) => [
                        styles.historyDetailButton,
                        pressed && styles.historyDetailButtonPressed,
                      ]}
                    >
                      <Text style={styles.historyDetailButtonLabel}>詳細</Text>
                    </Pressable>
                  </View>
                ))
              )}
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
                        onPress={() => openSolve(example.id)}
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
                        disabled={deleteBusy}
                        onPress={() => setDeleteTarget(example)}
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
        visible={solveSession != null}
        exampleId={solveSession?.exampleId ?? null}
        certificationId={certification.id}
        historyId={solveSession?.historyId ?? null}
        initialMessages={solveSession?.initialMessages ?? []}
        resumeMode={solveSession?.resumeMode ?? false}
        onClose={() => setSolveSession(null)}
        onHistoryChanged={() => {
          void loadHistories();
        }}
      />

      <Modal
        visible={deleteTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!deleteBusy) setDeleteTarget(null);
            }}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>例題を削除しますか？</Text>
            <Text style={styles.modalLead}>
              「{deleteTarget?.title}」を削除します。この操作は取り消せません。
              {'\n'}
              削除すると、この例題に関するAIチャット履歴は再開・閲覧できなくなります。
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={deleteBusy}
                onPress={() => setDeleteTarget(null)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed && styles.modalSecondaryButtonPressed,
                ]}
              >
                <Text style={styles.modalSecondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={deleteBusy}
                onPress={() => {
                  void handleDeleteConfirm();
                }}
                style={({ pressed }) => [
                  styles.modalDangerButton,
                  pressed && styles.modalDangerButtonPressed,
                ]}
              >
                {deleteBusy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.modalDangerButtonLabel}>OK</Text>
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
                  styles.modalPrimaryButton,
                  pressed && styles.modalPrimaryButtonPressed,
                ]}
              >
                <Text style={styles.modalPrimaryButtonLabel}>閉じる</Text>
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
  historyEmptyBox: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  historyEmptyText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
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
    borderRadius: 16,
    padding: 20,
    zIndex: 2,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    gap: 12,
  },
  modalCardWide: {
    maxWidth: 480,
  },
  modalTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
  },
  modalLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    marginBottom: 4,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  modalSecondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.mist,
    minHeight: 44,
    justifyContent: 'center',
  },
  modalSecondaryButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  modalSecondaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
  },
  modalPrimaryButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.accent,
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  modalPrimaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  modalDangerButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#9B3B3B',
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDangerButtonPressed: {
    backgroundColor: '#7A2E2E',
  },
  modalDangerButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
});
