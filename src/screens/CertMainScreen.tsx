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
import { Ionicons } from '@expo/vector-icons';
import { ExampleCreateModal } from '../components/ExampleCreateModal';
import { ExampleReportModal } from '../components/ExampleReportModal';
import { ExampleSolveModal } from '../components/ExampleSolveModal';
import { ExamStartModal } from '../components/ExamStartModal';
import { AnalysisModal } from '../components/AnalysisModal';
import { CategoryMasterModal } from '../components/CategoryMasterModal';
import { CategoryRadarChart } from '../components/CategoryRadarChart';
import { NotificationBell } from '../components/NotificationBell';
import { ReviewSessionModal } from '../components/ReviewSessionModal';
import {
  buildSessionCategoryAnalysis,
  fetchCertificationCategories,
  fetchExampleCategoryMap,
} from '../lib/analysisApi';
import { deleteExample, fetchExamples, filterUnimportedBankExampleIds, importBankExamplesToLibrary } from '../lib/examplesApi';
import { pickBatchExampleIds } from '../lib/batchPick';
import { getErrorMessage } from '../lib/certificationsApi';
import {
  fetchBankExampleIdsForExam,
  fetchExamBankStatus,
  getExamBankErrorMessage,
  rebalanceExamBankForMulti,
  runExamBankFullGeneration,
} from '../lib/examBankApi';
import {
  deleteHistory,
  exampleExists,
  fetchHistories,
  getHistoryErrorMessage,
  insertKeywordReviewHistory,
} from '../lib/historiesApi';
import {
  getKeywordReviewErrorMessage,
  reviewKeyword,
} from '../lib/keywordReviewApi';
import { fetchDueSrsCount, upsertKeywordSrsCard } from '../lib/srsApi';
import { fetchUserSettings } from '../lib/userSettingsApi';
import { colors } from '../theme/colors';
import type {
  CategoryUnderstanding,
  CertificationCategory,
} from '../types/analysis';
import type { Certification } from '../types/certification';
import type { ExampleSummary } from '../types/example';
import type {
  ExampleBatchDetail,
  ExampleBatchResultItem,
  HistoryChatMessage,
  HistorySummary,
} from '../types/history';
import {
  isExampleAiChatDetail,
  isExampleBatchDetail,
  isKeywordReviewDetail,
} from '../types/history';
import type { KeywordReviewResult, UnderstandingGrade } from '../types/keywordReview';
import type { UserNotification } from '../types/notification';

type Props = {
  certification: Certification;
  onBack: () => void;
  onOpenSettings?: () => void;
  openExampleId?: string | null;
  onOpenExampleConsumed?: () => void;
  onOpenFromNotification?: (notification: UserNotification) => void;
  externalNotice?: string | null;
  onDismissExternalNotice?: () => void;
};

type SolveSession = {
  exampleIds: string[];
  historyId: string | null;
  initialMessages: HistoryChatMessage[];
  resumeMode: boolean;
  reviewMode?: boolean;
  initialSelectedIds?: string[];
  initialDescriptiveAnswer?: string;
  examMode?: boolean;
  timeLimitSeconds?: number | null;
};

const MIN_QUESTION_COUNT = 10;
const MAX_QUESTION_COUNT = 25;
const DEFAULT_QUESTION_COUNT = 10;
const EXAM_QUESTION_COUNT = 75;
const EXAM_TIME_LIMIT_MINUTES = 180;

type PhoneMainTab = 'history' | 'examples' | 'keyword';

const PHONE_TABS: Array<{
  id: PhoneMainTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { id: 'history', label: '実施履歴', icon: 'time-outline' },
  { id: 'examples', label: '例題', icon: 'create-outline' },
  { id: 'keyword', label: 'キーワード', icon: 'mic-outline' },
];

function clampQuestionCount(value: number, available: number) {
  const maxAllowed = Math.min(MAX_QUESTION_COUNT, Math.max(0, available));
  if (maxAllowed <= 0) {
    return DEFAULT_QUESTION_COUNT;
  }
  const minAllowed = Math.min(MIN_QUESTION_COUNT, maxAllowed);
  return Math.min(maxAllowed, Math.max(minAllowed, value));
}

function gradeAccent(grade: UnderstandingGrade): string {
  switch (grade) {
    case 'A':
      return colors.accent;
    case 'B':
      return '#2F9E8E';
    case 'C':
      return '#C2811A';
    case 'D':
      return colors.spotlight;
  }
}

export function CertMainScreen({
  certification,
  onBack,
  onOpenSettings,
  openExampleId = null,
  onOpenExampleConsumed,
  onOpenFromNotification,
  externalNotice = null,
  onDismissExternalNotice,
}: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const isMid = width >= 720;
  const isPhone = width < 720;
  const [questionCountText, setQuestionCountText] = useState(
    String(DEFAULT_QUESTION_COUNT),
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [solveSession, setSolveSession] = useState<SolveSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExampleSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [historyDeleteTarget, setHistoryDeleteTarget] =
    useState<HistorySummary | null>(null);
  const [historyDeleteBusy, setHistoryDeleteBusy] = useState(false);
  const [examBankConfirmOpen, setExamBankConfirmOpen] = useState(false);
  const [examRebalanceConfirmOpen, setExamRebalanceConfirmOpen] = useState(false);
  const [examBankBusy, setExamBankBusy] = useState(false);
  const [examBankProgressText, setExamBankProgressText] = useState<string | null>(
    null,
  );
  const [examLobbyIds, setExamLobbyIds] = useState<string[] | null>(null);
  const [examLobbyBusy, setExamLobbyBusy] = useState(false);
  const [bankImportIds, setBankImportIds] = useState<string[] | null>(null);
  const [bankImportBusy, setBankImportBusy] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [examplesError, setExamplesError] = useState<string | null>(null);
  const [examplesLoading, setExamplesLoading] = useState(true);
  const [histories, setHistories] = useState<HistorySummary[]>([]);
  const [historiesError, setHistoriesError] = useState<string | null>(null);
  const [historiesLoading, setHistoriesLoading] = useState(true);
  const [keywordText, setKeywordText] = useState('');
  const [keywordExplain, setKeywordExplain] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [keywordReviewResult, setKeywordReviewResult] =
    useState<KeywordReviewResult | null>(null);
  const [phoneTab, setPhoneTab] = useState<PhoneMainTab>('examples');
  const [batchHistoryDetail, setBatchHistoryDetail] =
    useState<ExampleBatchDetail | null>(null);
  const [batchHistoryKind, setBatchHistoryKind] = useState<string | null>(null);
  const [batchHistoryId, setBatchHistoryId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ExampleSummary | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [examplesListDialogOpen, setExamplesListDialogOpen] = useState(false);
  const [notificationOpenSignal, setNotificationOpenSignal] = useState<
    number | null
  >(null);
  const [categoryMasterOpen, setCategoryMasterOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const [batchPickBusy, setBatchPickBusy] = useState(false);
  const [categories, setCategories] = useState<CertificationCategory[]>([]);
  const [filterDraft, setFilterDraft] = useState<string>('all');
  const [filterApplied, setFilterApplied] = useState<string>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sessionCategoryStats, setSessionCategoryStats] = useState<
    CategoryUnderstanding[]
  >([]);

  const loadExamples = useCallback(async () => {
    setExamplesLoading(true);
    setExamplesError(null);
    try {
      const [rows, cats] = await Promise.all([
        fetchExamples(certification.id),
        fetchCertificationCategories(certification.id),
      ]);
      setExamples(rows);
      setCategories(cats);
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

  const loadDueCount = useCallback(async () => {
    try {
      const count = await fetchDueSrsCount(certification.id);
      setDueCount(count);
    } catch (error) {
      console.error('[CertMainScreen] due count', error);
    }
  }, [certification.id]);

  useEffect(() => {
    void loadExamples();
  }, [loadExamples]);

  useEffect(() => {
    void loadHistories();
  }, [loadHistories]);

  useEffect(() => {
    void loadDueCount();
  }, [loadDueCount]);

  useEffect(() => {
    if (externalNotice) {
      setNoticeMessage(externalNotice);
    }
  }, [externalNotice]);

  const dismissNotice = () => {
    setNoticeMessage(null);
    onDismissExternalNotice?.();
  };

  const availableCount = examples.length;
  const filteredExamples =
    filterApplied === 'all'
      ? examples
      : filterApplied === 'uncategorized'
        ? examples.filter((item) => item.categoryId == null)
        : examples.filter((item) => item.categoryId === filterApplied);

  const filterLabel =
    filterApplied === 'all'
      ? 'すべて'
      : filterApplied === 'uncategorized'
        ? '未分類'
        : categories.find((c) => c.id === filterApplied)?.name ?? 'カテゴリ';

  const maxSelectableCount = Math.min(MAX_QUESTION_COUNT, availableCount);
  const canStartBatch =
    !examplesLoading && availableCount >= MIN_QUESTION_COUNT;

  useEffect(() => {
    if (examplesLoading) return;
    if (maxSelectableCount <= 0) return;
    setQuestionCountText((prev) => {
      const parsed = Number(prev);
      if (Number.isNaN(parsed)) {
        return String(clampQuestionCount(DEFAULT_QUESTION_COUNT, availableCount));
      }
      if (parsed > maxSelectableCount || parsed < Math.min(MIN_QUESTION_COUNT, maxSelectableCount)) {
        return String(clampQuestionCount(parsed, availableCount));
      }
      return prev;
    });
  }, [availableCount, examplesLoading, maxSelectableCount]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 既存バンク問題の category_id 埋め（status 呼び出し側で実施）
        await fetchExamBankStatus(certification.id);
        if (cancelled) return;
      } catch {
        // パイロット対象外の資格などでは無視
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [certification.id]);

  const handleExamFinished = async (payload: { exampleIds: string[] }) => {
    try {
      const settings = await fetchUserSettings();
      if (!settings.promptBankImportAfterExam) return;
      const unimported = await filterUnimportedBankExampleIds(payload.exampleIds);
      if (unimported.length === 0) {
        setNoticeMessage(
          '試験で出た共有バンク問題は、すでに例題一覧へ取り込まれています。',
        );
        return;
      }
      setBankImportIds(unimported);
    } catch (error) {
      setNoticeMessage(
        getErrorMessage(error, '取り込み確認の準備に失敗しました。'),
      );
    }
  };

  const handleConfirmBankImport = async () => {
    if (!bankImportIds || bankImportBusy) return;
    setBankImportBusy(true);
    try {
      const imported = await importBankExamplesToLibrary(bankImportIds);
      setBankImportIds(null);
      await loadExamples();
      setNoticeMessage(
        imported > 0
          ? `共有バンクから ${imported} 問を例題一覧に取り込みました。`
          : '取り込める未登録の問題はありませんでした。',
      );
    } catch (error) {
      setNoticeMessage(
        getErrorMessage(error, '共有バンクの取り込みに失敗しました。'),
      );
    } finally {
      setBankImportBusy(false);
    }
  };

  const openSolve = (exampleId: string) => {
    setSolveSession({
      exampleIds: [exampleId],
      historyId: null,
      initialMessages: [],
      resumeMode: false,
      reviewMode: false,
    });
  };

  const closeBatchHistoryDetail = () => {
    setBatchHistoryDetail(null);
    setBatchHistoryKind(null);
    setBatchHistoryId(null);
    setSessionCategoryStats([]);
  };

  const startBatchRechallenge = async () => {
    if (!batchHistoryDetail || batchHistoryKind === 'exam') return;
    const ids = batchHistoryDetail.results.map((item) => item.example_id);
    try {
      const existing: string[] = [];
      for (const id of ids) {
        if (await exampleExists(id)) {
          existing.push(id);
        }
      }
      if (existing.length === 0) {
        setNoticeMessage(
          'この回の例題は削除されているため、再チャレンジできません。',
        );
        return;
      }
      if (existing.length < ids.length) {
        setNoticeMessage(
          `一部の例題が削除されていたため、残りの ${existing.length} 問で再チャレンジします。`,
        );
      }
      closeBatchHistoryDetail();
      setSolveSession({
        exampleIds: existing,
        historyId: null,
        initialMessages: [],
        resumeMode: false,
      });
    } catch (error) {
      setNoticeMessage(
        getHistoryErrorMessage(error, '再チャレンジの準備に失敗しました。'),
      );
    }
  };

  const openExampleFromBatchHistory = async (exampleId: string) => {
    try {
      const exists = await exampleExists(exampleId);
      if (!exists) {
        setNoticeMessage(
          'この例題は削除されているため、開けません。',
        );
        return;
      }
      openSolve(exampleId);
    } catch (error) {
      setNoticeMessage(
        getHistoryErrorMessage(error, '例題を開けませんでした。'),
      );
    }
  };

  const openReviewFromBatchHistory = async (item: ExampleBatchResultItem) => {
    try {
      const exists = await exampleExists(item.example_id);
      if (!exists) {
        setNoticeMessage(
          'この例題は削除されているため、解説を開けません。',
        );
        return;
      }
      setSolveSession({
        exampleIds: [item.example_id],
        historyId: null,
        initialMessages: [],
        resumeMode: false,
        reviewMode: true,
        initialSelectedIds: item.selected_ids ?? [],
        initialDescriptiveAnswer: item.descriptive_answer ?? '',
      });
    } catch (error) {
      setNoticeMessage(
        getHistoryErrorMessage(error, '解説を開けませんでした。'),
      );
    }
  };

  const formatBatchAnswerSummary = (item: ExampleBatchResultItem) => {
    if (item.selected_labels && item.selected_labels.length > 0) {
      const selected = item.selected_labels.join(', ');
      const correct =
        item.correct_labels && item.correct_labels.length > 0
          ? item.correct_labels.join(', ')
          : null;
      if (item.correct) {
        return `あなたの解答: ${selected}`;
      }
      return correct
        ? `あなたの解答: ${selected} ／ 正解: ${correct}`
        : `あなたの解答: ${selected}`;
    }
    if (item.descriptive_answer) {
      const text =
        item.descriptive_answer.length > 80
          ? `${item.descriptive_answer.slice(0, 80)}…`
          : item.descriptive_answer;
      return `あなたの解答: ${text}`;
    }
    return null;
  };

  const openExamLobby = async () => {
    try {
      const ids = await fetchBankExampleIdsForExam(
        certification.id,
        EXAM_QUESTION_COUNT,
      );
      if (ids.length === 0) {
        setNoticeMessage('共有バンクに問題がありません。');
        return;
      }
      setExamLobbyIds(ids);
    } catch (error) {
      setNoticeMessage(
        getExamBankErrorMessage(error, '試験の準備に失敗しました。'),
      );
    }
  };

  const handleStartExam = () => {
    if (!examLobbyIds || examLobbyIds.length === 0 || examLobbyBusy) return;
    setExamLobbyBusy(true);
    try {
      setSolveSession({
        exampleIds: examLobbyIds,
        historyId: null,
        initialMessages: [],
        resumeMode: false,
        examMode: true,
        timeLimitSeconds: EXAM_TIME_LIMIT_MINUTES * 60,
      });
      setExamLobbyIds(null);
    } finally {
      setExamLobbyBusy(false);
    }
  };

  const handleExamPress = async () => {
    if (examBankBusy) return;
    setExamBankBusy(true);
    setExamBankProgressText(null);
    try {
      const status = await fetchExamBankStatus(certification.id);
      if (status.totalHave >= status.targetTotal && status.totalRemaining <= 0) {
        const at = status.answerTypes;
        if (at && at.total > 0 && !at.inTargetRange) {
          const multiPct = Math.round(at.multiRatio * 100);
          setExamBankProgressText(
            `解答形式の比率が目安外です（単一 ${at.single} / 複数 ${at.multi} = 複数 ${multiPct}%）。SAP 目安は複数 20〜30%（目標 ${at.multiTarget} 問）です。単一選択を一部削除し、複数選択を再生成して調整しますか？`,
          );
          setExamRebalanceConfirmOpen(true);
          return;
        }
        await openExamLobby();
        return;
      }
      if (status.totalHave > 0 && status.totalRemaining > 0) {
        setExamBankProgressText(
          `生成が途中です（${status.totalHave}/${status.targetTotal}）。既存の問題は残したまま、続きから再開します。`,
        );
        setExamBankConfirmOpen(true);
        return;
      }
      setExamBankProgressText(null);
      setExamBankConfirmOpen(true);
    } catch (error) {
      setNoticeMessage(
        getExamBankErrorMessage(
          error,
          '共有バンクの状態確認に失敗しました。',
        ),
      );
    } finally {
      setExamBankBusy(false);
    }
  };

  const handleConfirmRebalanceMulti = async () => {
    if (examBankBusy) return;
    setExamBankBusy(true);
    setExamBankProgressText('複数選択の比率を調整しています…');
    try {
      const rebalanced = await rebalanceExamBankForMulti(certification.id);
      setExamBankProgressText(
        rebalanced.deleted > 0
          ? `単一選択を ${rebalanced.deleted} 問削除しました（現在 ${rebalanced.totalHave}/150）。複数選択を生成中…`
          : '比率は既に近いため削除なし。不足分があれば生成します…',
      );
      const result = await runExamBankFullGeneration(
        certification.id,
        (step) => {
          const multi =
            step.answerTypes != null
              ? ` / 単一${step.answerTypes.single}・複数${step.answerTypes.multi}`
              : '';
          setExamBankProgressText(
            `作成済み ${step.totalHave}/${step.targetTotal} 問${multi}` +
              (step.created > 0 ? `（今回 +${step.created}）` : '') +
              '…',
          );
        },
      );
      setExamRebalanceConfirmOpen(false);
      if (result.complete || result.totalRemaining <= 0) {
        await openExamLobby();
      } else {
        setNoticeMessage(
          `生成が途中です（${result.totalHave}/${result.targetTotal}）。もう一度「本番試験を実施」から再開してください。`,
        );
      }
    } catch (error) {
      setExamBankProgressText(null);
      setNoticeMessage(
        getExamBankErrorMessage(error, '複数選択比率の調整に失敗しました。'),
      );
    } finally {
      setExamBankBusy(false);
    }
  };

  const handleConfirmGenerateBank = async () => {
    if (examBankBusy) return;
    setExamBankBusy(true);
    setExamBankProgressText('共有バンクを準備しています…');
    try {
      const status = await fetchExamBankStatus(certification.id);

      // 不足分がある限り削除せず再開（failed / generating どちらでも）
      const canResume = status.totalHave > 0 && status.totalRemaining > 0;

      if (canResume) {
        setExamBankProgressText(
          `作成済み ${status.totalHave}/${status.targetTotal} 問から再開します…`,
        );
      } else {
        setExamBankProgressText('作成済み 0/150 問から生成を開始します…');
      }

      const result = await runExamBankFullGeneration(
        certification.id,
        (step) => {
          const multi =
            step.answerTypes != null
              ? ` / 単一${step.answerTypes.single}・複数${step.answerTypes.multi}`
              : '';
          setExamBankProgressText(
            `作成済み ${step.totalHave}/${step.targetTotal} 問${multi}` +
              (step.created > 0 ? `（今回 +${step.created}）` : '') +
              '…',
          );
        },
      );
      setExamBankConfirmOpen(false);
      if (result.complete || result.totalRemaining <= 0) {
        await openExamLobby();
      } else {
        setNoticeMessage(
          `生成が途中です（${result.totalHave}/${result.targetTotal}）。もう一度「本番試験を実施」から再開してください。`,
        );
      }
    } catch (error) {
      setExamBankProgressText(null);
      setNoticeMessage(
        getExamBankErrorMessage(error, '共有バンクの生成に失敗しました。'),
      );
    } finally {
      setExamBankBusy(false);
    }
  };

  useEffect(() => {
    if (!openExampleId || examplesLoading) return;
    let cancelled = false;
    void (async () => {
      try {
        const exists = await exampleExists(openExampleId);
        if (cancelled) return;
        if (!exists) {
          setNoticeMessage(
            'この例題は削除されているため、開けません。',
          );
          onOpenExampleConsumed?.();
          return;
        }
        openSolve(openExampleId);
        onOpenExampleConsumed?.();
      } catch (error) {
        if (cancelled) return;
        setNoticeMessage(
          getHistoryErrorMessage(error, '例題を開けませんでした。'),
        );
        onOpenExampleConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openExampleId, examplesLoading, onOpenExampleConsumed]);

  const openBatchSolve = async () => {
    if (!canStartBatch || batchPickBusy) {
      if (!canStartBatch) {
        setNoticeMessage(
          `まとめて解くには例題が${MIN_QUESTION_COUNT}問以上必要です（現在 ${availableCount} 問）。`,
        );
      }
      return;
    }
    const parsed = Number(questionCountText);
    const count = clampQuestionCount(
      Number.isNaN(parsed) ? DEFAULT_QUESTION_COUNT : parsed,
      availableCount,
    );
    setQuestionCountText(String(count));
    setBatchPickBusy(true);
    try {
      const picked = await pickBatchExampleIds({
        certificationId: certification.id,
        exampleIds: examples.map((item) => item.id),
        count,
      });
      if (picked.length === 0) {
        setNoticeMessage('解ける例題がありません。');
        return;
      }
      setSolveSession({
        exampleIds: picked,
        historyId: null,
        initialMessages: [],
        resumeMode: false,
      });
    } catch (error) {
      setNoticeMessage(
        getErrorMessage(error, '出題の準備に失敗しました。もう一度お試しください。'),
      );
    } finally {
      setBatchPickBusy(false);
    }
  };

  const openHistoryDetail = async (item: HistorySummary) => {
    if (isKeywordReviewDetail(item.detail, item.kind)) {
      setKeywordReviewResult(item.detail);
      return;
    }

    if (isExampleBatchDetail(item.detail, item.kind)) {
      setBatchHistoryDetail(item.detail);
      setBatchHistoryKind(item.kind);
      setBatchHistoryId(item.id);
      setSessionCategoryStats([]);
      try {
        const [cats, map] = await Promise.all([
          fetchCertificationCategories(certification.id),
          fetchExampleCategoryMap(certification.id),
        ]);
        setSessionCategoryStats(
          buildSessionCategoryAnalysis(cats, item.detail, map),
        );
      } catch (error) {
        console.error('[CertMainScreen] session analysis', error);
      }
      return;
    }

    if (!isExampleAiChatDetail(item.detail, item.kind)) {
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
        exampleIds: [item.detail.example_id],
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

  const canReview =
    keywordText.trim().length > 0 && keywordExplain.trim().length > 0;

  const handleKeywordReview = async () => {
    if (!canReview || reviewBusy) return;
    setReviewBusy(true);
    try {
      const review = await reviewKeyword({
        certificationId: certification.id,
        keyword: keywordText.trim(),
        explanation: keywordExplain.trim(),
      });
      await insertKeywordReviewHistory({
        certificationId: certification.id,
        review,
      });
      if (review.grade === 'A' || review.grade === 'B') {
        try {
          await upsertKeywordSrsCard({
            certificationId: certification.id,
            keyword: review.keyword,
            explanation: review.explanation,
          });
          await loadDueCount();
        } catch (srsError) {
          console.error('[CertMainScreen] srs keyword', srsError);
        }
      }
      setKeywordReviewResult(review);
      await loadHistories();
    } catch (error) {
      setNoticeMessage(getKeywordReviewErrorMessage(error));
    } finally {
      setReviewBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteExample(deleteTarget.id);
      if (solveSession?.exampleIds.includes(deleteTarget.id)) {
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

  const handleHistoryDeleteConfirm = async () => {
    if (!historyDeleteTarget || historyDeleteBusy) return;
    setHistoryDeleteBusy(true);
    try {
      const deletedId = historyDeleteTarget.id;
      await deleteHistory(deletedId);
      if (batchHistoryId === deletedId) {
        setBatchHistoryDetail(null);
        setBatchHistoryKind(null);
        setBatchHistoryId(null);
        setSessionCategoryStats([]);
      }
      setHistoryDeleteTarget(null);
      await loadHistories();
    } catch (error) {
      console.error('[CertMainScreen] history delete', error);
      setHistoryDeleteTarget(null);
      setNoticeMessage(
        getHistoryErrorMessage(
          error,
          '実施履歴の削除に失敗しました。時間をおいて再度お試しください。',
        ),
      );
    } finally {
      setHistoryDeleteBusy(false);
    }
  };

  const handleQuestionCountChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 2);
    if (!digits) {
      return;
    }

    const next = Number(digits);
    if (Number.isNaN(next)) {
      return;
    }

    const maxAllowed = Math.max(0, maxSelectableCount);
    if (maxAllowed <= 0) {
      return;
    }

    if (next > maxAllowed) {
      return;
    }

    const minAllowed = Math.min(MIN_QUESTION_COUNT, maxAllowed);
    if (digits.length === 2 && next < minAllowed) {
      return;
    }

    if (digits.length === 1) {
      if (maxAllowed < 10) {
        if (next < 1 || next > maxAllowed) return;
      } else {
        if (next !== 1 && next !== 2) return;
        if (next === 2 && maxAllowed < 20) return;
      }
    }

    setQuestionCountText(digits);
  };

  const handleQuestionCountBlur = () => {
    const parsed = Number(questionCountText);
    const next = Number.isNaN(parsed)
      ? clampQuestionCount(DEFAULT_QUESTION_COUNT, availableCount)
      : clampQuestionCount(parsed, availableCount);
    setQuestionCountText(String(next));
  };

  const historyListBody = historiesLoading ? (
    <View style={styles.historyEmptyBox}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.historyEmptyText}>読み込み中…</Text>
    </View>
  ) : historiesError ? (
    <Text style={styles.historyEmptyText}>{historiesError}</Text>
  ) : histories.length === 0 ? (
    <Text style={styles.historyEmptyText}>まだ実施履歴はありません</Text>
  ) : (
    histories.map((item) => (
      <View
        key={item.id}
        style={[styles.historyRow, isPhone && styles.historyRowPhone]}
      >
        <View style={styles.historyMain}>
          <Text style={styles.historyTime}>{item.performedAt}</Text>
          <Text style={styles.historyTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.historySummary}>{item.summary}</Text>
        </View>
        <View
          style={[styles.historyActions, isPhone && styles.historyActionsPhone]}
        >
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
          <Pressable
            accessibilityRole="button"
            onPress={() => setHistoryDeleteTarget(item)}
            style={({ pressed }) => [
              styles.historyDeleteButton,
              pressed && styles.historyDeleteButtonPressed,
            ]}
          >
            <Text style={styles.historyDeleteButtonLabel}>削除</Text>
          </Pressable>
        </View>
      </View>
    ))
  );

  const examplesHeaderBody = (
    <View
      style={[
        styles.examplesHeader,
        isWide ? styles.examplesHeaderWide : styles.examplesHeaderStacked,
      ]}
    >
      <Text style={styles.examplesTitle}>例題一覧</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setIsCreateOpen(true)}
        style={({ pressed }) => [
          styles.createButton,
          !isWide && styles.createButtonStacked,
          pressed && styles.createButtonPressed,
        ]}
      >
        <Text style={styles.createButtonLabel}>＋例題を新規作成</Text>
      </Pressable>
    </View>
  );

  const examplesBatchControlsBody = (
    <View style={styles.questionCountRow}>
      <TextInput
        value={questionCountText}
        onChangeText={handleQuestionCountChange}
        onBlur={handleQuestionCountBlur}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={2}
        editable={maxSelectableCount > 0}
        style={styles.questionCountInput}
        accessibilityLabel="問題数"
      />
      <Text style={styles.questionCountUnit}>問</Text>
      <Pressable
        accessibilityRole="button"
        disabled={!canStartBatch || batchPickBusy}
        onPress={() => {
          void openBatchSolve();
        }}
        style={({ pressed }) => [
          styles.solveButton,
          pressed &&
            canStartBatch &&
            !batchPickBusy &&
            styles.solveButtonPressed,
          (!canStartBatch || batchPickBusy) && styles.solveButtonDisabled,
        ]}
      >
        <Text
          style={[
            styles.solveButtonLabel,
            (!canStartBatch || batchPickBusy) &&
              styles.solveButtonLabelDisabled,
          ]}
        >
          {batchPickBusy ? '準備中…' : isPhone ? '連続で解く' : '例題を解く'}
        </Text>
      </Pressable>
      <Text
        style={[
          styles.questionCountHint,
          isPhone && styles.questionCountHintPhone,
        ]}
      >
        {availableCount === 0
          ? '※例題がありません'
          : availableCount < MIN_QUESTION_COUNT
            ? `※まとめて解くには${MIN_QUESTION_COUNT}問以上必要（現在${availableCount}問）`
            : '※苦手・未解答を優先して出題します'}
      </Text>
    </View>
  );

  const examplesFilterBody = (
    <>
      <View style={styles.filterRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setFilterMenuOpen((v) => !v)}
          style={({ pressed }) => [
            styles.filterCombo,
            isPhone && styles.filterComboPhone,
            pressed && styles.filterComboPressed,
          ]}
        >
          <Text style={styles.filterComboLabel} numberOfLines={1}>
            {filterDraft === 'all'
              ? 'すべて'
              : filterDraft === 'uncategorized'
                ? '未分類'
                : categories.find((c) => c.id === filterDraft)?.name ??
                  'カテゴリ'}
          </Text>
          <Text style={styles.filterComboCaret}>▼</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setFilterApplied(filterDraft);
            setFilterMenuOpen(false);
          }}
          style={({ pressed }) => [
            styles.filterButton,
            pressed && styles.filterButtonPressed,
          ]}
        >
          <Text style={styles.filterButtonLabel}>フィルター</Text>
        </Pressable>
        <Text style={[styles.filterHint, isPhone && styles.filterHintPhone]}>
          表示中 {filteredExamples.length} / {examples.length}（{filterLabel}）
        </Text>
      </View>
      {filterMenuOpen ? (
        <View style={styles.filterMenu}>
          {(
            [
              { id: 'all', name: 'すべて' },
              { id: 'uncategorized', name: '未分類' },
              ...categories.map((c) => ({ id: c.id, name: c.name })),
            ] as Array<{ id: string; name: string }>
          ).map((opt) => (
            <Pressable
              key={opt.id}
              accessibilityRole="button"
              onPress={() => setFilterDraft(opt.id)}
              style={[
                styles.filterOption,
                filterDraft === opt.id && styles.filterOptionActive,
              ]}
            >
              <Text
                style={[
                  styles.filterOptionLabel,
                  filterDraft === opt.id && styles.filterOptionLabelActive,
                ]}
              >
                {opt.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );

  const examplesControlsBody = (
    <>
      {examplesBatchControlsBody}
      {examplesFilterBody}
    </>
  );

  const examplesListBody = examplesLoading ? (
    <Text style={styles.panelLead}>例題を読み込み中…</Text>
  ) : examplesError ? (
    <Text style={styles.panelLead}>{examplesError}</Text>
  ) : examples.length === 0 ? (
    <Text style={styles.panelLead}>
      まだ例題がありません。「＋例題を新規作成」から追加できます。
    </Text>
  ) : filteredExamples.length === 0 ? (
    <Text style={styles.panelLead}>
      条件に一致する例題がありません。フィルターを変更してください。
    </Text>
  ) : (
    filteredExamples.map((example) => (
      <View
        key={example.id}
        style={[styles.exampleRow, isPhone && styles.exampleRowPhone]}
      >
        <View style={styles.exampleTitleBlock}>
          <Text style={styles.exampleTitle} numberOfLines={2}>
            {example.title}
          </Text>
          {example.categoryName ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setCategoryMasterOpen(true)}
              style={({ pressed }) => [
                styles.categoryTag,
                pressed && styles.categoryTagPressed,
              ]}
            >
              <Text style={styles.categoryTagLabel}>{example.categoryName}</Text>
            </Pressable>
          ) : (
            <Text style={styles.uncategorizedLabel}>未分類</Text>
          )}
        </View>
        <View
          style={[styles.exampleActions, isPhone && styles.exampleActionsPhone]}
        >
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
            onPress={() => setReportTarget(example)}
            style={({ pressed }) => [
              styles.rowAction,
              styles.rowActionSecondary,
              pressed && styles.rowActionPressed,
            ]}
          >
            <Text style={styles.rowActionLabelSecondary}>誤りを連絡</Text>
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
  );

  const keywordFormBody = (
    <>
      <Text style={styles.sectionLabel}>キーワードの自己説明</Text>
      <Text style={styles.keywordLead}>
        キーワードと説明を分けて入力し、自分自身のキーワードの理解度をAIにチェックしてもらうことができます。
      </Text>
      <Text style={styles.fieldLabel}>キーワード</Text>
      <TextInput
        editable={!reviewBusy}
        value={keywordText}
        onChangeText={setKeywordText}
        placeholder="キーワードを入力"
        placeholderTextColor={colors.muted}
        style={styles.keywordNameInput}
      />
      <Text style={styles.fieldLabel}>説明</Text>
      <TextInput
        multiline
        editable={!reviewBusy}
        value={keywordExplain}
        onChangeText={setKeywordExplain}
        placeholder="自分の言葉で説明を入力"
        placeholderTextColor={colors.muted}
        style={[
          styles.keywordExplainInput,
          isPhone && styles.keywordExplainInputPhone,
        ]}
        textAlignVertical="top"
      />
      <Pressable
        accessibilityRole="button"
        disabled={!canReview || reviewBusy}
        onPress={() => {
          void handleKeywordReview();
        }}
        style={({ pressed }) => [
          styles.reviewButton,
          pressed && canReview && !reviewBusy && styles.reviewButtonPressed,
          (!canReview || reviewBusy) && styles.reviewButtonDisabled,
        ]}
      >
        {reviewBusy ? (
          <ActivityIndicator color={colors.paper} />
        ) : (
          <Text
            style={[
              styles.reviewButtonLabel,
              !canReview && styles.reviewButtonLabelDisabled,
            ]}
          >
            レビューを実施する
          </Text>
        )}
      </Pressable>
    </>
  );

  const examplesListNestedOpen =
    isCreateOpen ||
    deleteTarget != null ||
    solveSession != null ||
    reportTarget != null ||
    categoryMasterOpen;

  return (
    <View style={[styles.root, isPhone && styles.rootPhone]}>
      <View
        style={[
          styles.header,
          !isWide && styles.headerStacked,
          isPhone && styles.headerPhone,
        ]}
      >
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
                onPress={() => setReviewOpen(true)}
                style={({ pressed }) => [
                  styles.srsReviewButton,
                  pressed && styles.srsReviewButtonPressed,
                ]}
              >
                <Ionicons name="sync-outline" size={18} color={colors.ink} />
                <Text style={styles.srsReviewButtonLabel}>今日の復習</Text>
                {dueCount > 0 ? (
                  <View style={styles.dueBadge}>
                    <Text style={styles.dueBadgeLabel}>
                      {dueCount > 99 ? '99+' : String(dueCount)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAnalysisOpen(true)}
                style={({ pressed }) => [
                  styles.analysisButton,
                  pressed && styles.analysisButtonPressed,
                ]}
              >
                <Ionicons
                  name="school-outline"
                  size={18}
                  color={colors.accentDeep}
                />
                <Text style={styles.analysisButtonLabel}>分析</Text>
              </Pressable>
              {onOpenSettings ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onOpenSettings}
                  style={({ pressed }) => [
                    styles.settingsButton,
                    pressed && styles.settingsButtonPressed,
                  ]}
                >
                  <Ionicons
                    name="settings-outline"
                    size={18}
                    color={colors.accentDeep}
                  />
                  <Text style={styles.settingsButtonLabel}>設定</Text>
                </Pressable>
              ) : null}
              {onOpenFromNotification ? (
                <NotificationBell
                  showLabel
                  onOpenExample={onOpenFromNotification}
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void handleExamPress();
                }}
                style={({ pressed }) => [
                  styles.examButton,
                  pressed && styles.examButtonPressed,
                ]}
              >
                <Ionicons name="create-outline" size={18} color={colors.paper} />
                <Text style={styles.examButtonLabel}>本番試験を実施</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.headerTopRow}>
              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                style={({ pressed }) => [
                  styles.backLink,
                  pressed && styles.backLinkPressed,
                ]}
              >
                <Text style={styles.backLinkLabel}>← 選択画面に戻る</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="メニューを開く"
                onPress={() => setHeaderMenuOpen(true)}
                style={({ pressed }) => [
                  styles.hamburgerButton,
                  pressed && styles.hamburgerButtonPressed,
                ]}
              >
                <Ionicons name="menu" size={22} color={colors.paper} />
                {dueCount > 0 ? (
                  <View style={styles.hamburgerBadge}>
                    <Text style={styles.hamburgerBadgeLabel}>
                      {dueCount > 99 ? '99+' : String(dueCount)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
            <View
              style={[styles.headerTitle, isPhone && styles.headerTitlePhone]}
            >
              <Text style={[styles.brand, isPhone && styles.brandPhone]}>
                CertResolve
              </Text>
              <Text
                style={[styles.certName, isPhone && styles.certNamePhone]}
                numberOfLines={2}
              >
                {certification.name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void handleExamPress();
              }}
              style={({ pressed }) => [
                styles.headerExamButton,
                pressed && styles.headerExamButtonPressed,
              ]}
            >
              <Ionicons name="create-outline" size={18} color={colors.paper} />
              <Text style={styles.headerExamButtonLabel}>本番試験を受ける</Text>
            </Pressable>
            {onOpenFromNotification ? (
              <NotificationBell
                hideTrigger
                openSignal={notificationOpenSignal}
                onOpenExample={onOpenFromNotification}
              />
            ) : null}
          </>
        )}
      </View>

      <Modal
        visible={headerMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHeaderMenuOpen(false)}
      >
        <View style={styles.headerMenuOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="メニューを閉じる"
            style={styles.headerMenuBackdrop}
            onPress={() => setHeaderMenuOpen(false)}
          />
          <View style={styles.headerMenuCard}>
            {onOpenFromNotification ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setHeaderMenuOpen(false);
                  setNotificationOpenSignal((prev) => (prev ?? 0) + 1);
                }}
                style={({ pressed }) => [
                  styles.headerMenuItem,
                  pressed && styles.headerMenuItemPressed,
                ]}
              >
                <Ionicons
                  name="notifications-outline"
                  size={20}
                  color={colors.accentDeep}
                />
                <Text style={styles.headerMenuItemLabel}>通知</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setHeaderMenuOpen(false);
                setAnalysisOpen(true);
              }}
              style={({ pressed }) => [
                styles.headerMenuItem,
                pressed && styles.headerMenuItemPressed,
              ]}
            >
              <Ionicons
                name="school-outline"
                size={20}
                color={colors.accentDeep}
              />
              <Text style={styles.headerMenuItemLabel}>分析</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setHeaderMenuOpen(false);
                setReviewOpen(true);
              }}
              style={({ pressed }) => [
                styles.headerMenuItem,
                pressed && styles.headerMenuItemPressed,
              ]}
            >
              <Ionicons name="sync-outline" size={20} color={colors.accentDeep} />
              <Text style={styles.headerMenuItemLabel}>今日の復習</Text>
              {dueCount > 0 ? (
                <View style={styles.headerMenuDueBadge}>
                  <Text style={styles.dueBadgeLabel}>
                    {dueCount > 99 ? '99+' : String(dueCount)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            {onOpenSettings ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setHeaderMenuOpen(false);
                  onOpenSettings();
                }}
                style={({ pressed }) => [
                  styles.headerMenuItem,
                  pressed && styles.headerMenuItemPressed,
                ]}
              >
                <Ionicons
                  name="settings-outline"
                  size={20}
                  color={colors.accentDeep}
                />
                <Text style={styles.headerMenuItemLabel}>設定</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      {isWide ? (
        <View style={[styles.body, styles.bodyWideFill]}>
          <View style={[styles.mainColumn, styles.mainColumnWide]}>
            <View style={[styles.historyPanel, styles.historyPanelBeside]}>
              <Text style={styles.panelTitle}>実施履歴</Text>
              <Text style={styles.panelLead}>最新順に表示されます</Text>
              <ScrollView
                style={styles.panelScroll}
                contentContainerStyle={styles.panelScrollContent}
                showsVerticalScrollIndicator
              >
                {historyListBody}
              </ScrollView>
            </View>

            <View style={[styles.examplesPanel, styles.examplesPanelBeside]}>
              {examplesHeaderBody}
              {examplesControlsBody}
              <ScrollView
                style={styles.panelScroll}
                contentContainerStyle={styles.panelScrollContent}
                showsVerticalScrollIndicator
              >
                {examplesListBody}
              </ScrollView>
            </View>
          </View>

          <View style={[styles.keywordPanel, styles.keywordPanelWide]}>
            {keywordFormBody}
          </View>
        </View>
      ) : (
        <View style={styles.phoneShell}>
          <View style={styles.phoneTabPane}>
            {phoneTab === 'history' ? (
              <View style={styles.phoneCardFill}>
                <Text style={styles.panelTitle}>実施履歴</Text>
                <Text style={styles.panelLead}>最新順に表示されます</Text>
                <ScrollView
                  style={styles.phoneTabScroll}
                  contentContainerStyle={styles.panelList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {historyListBody}
                </ScrollView>
              </View>
            ) : null}

            {phoneTab === 'examples' ? (
              <View style={[styles.phoneCardFill, styles.phoneExamplesPane]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsCreateOpen(true)}
                  style={({ pressed }) => [
                    styles.createButton,
                    styles.createButtonStacked,
                    pressed && styles.createButtonPressed,
                  ]}
                >
                  <Text style={styles.createButtonLabel}>＋例題を新規作成</Text>
                </Pressable>
                {examplesBatchControlsBody}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setExamplesListDialogOpen(true)}
                  style={({ pressed }) => [
                    styles.openExamplesListButton,
                    pressed && styles.openExamplesListButtonPressed,
                  ]}
                >
                  <Text style={styles.openExamplesListButtonLabel}>
                    例題一覧を開く
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {phoneTab === 'keyword' ? (
              <ScrollView
                style={styles.phoneTabScroll}
                contentContainerStyle={styles.phoneKeywordScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                <View style={styles.phoneCard}>{keywordFormBody}</View>
              </ScrollView>
            ) : null}
          </View>

          <View style={styles.phoneTabBar}>
            {PHONE_TABS.map((tab, index) => {
              const active = phoneTab === tab.id;
              const isFirst = index === 0;
              return (
                <Pressable
                  key={tab.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setPhoneTab(tab.id)}
                  style={({ pressed }) => [
                    styles.phoneTabItem,
                    !isFirst && styles.phoneTabItemDivider,
                    active && styles.phoneTabItemActive,
                    pressed && styles.phoneTabItemPressed,
                  ]}
                >
                  <Ionicons
                    name={tab.icon}
                    size={18}
                    color={active ? colors.accentDeep : colors.inkSoft}
                    style={styles.phoneTabIcon}
                  />
                  <Text
                    style={[
                      styles.phoneTabLabel,
                      active && styles.phoneTabLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

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

      <Modal
        visible={examplesListDialogOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (examplesListNestedOpen) return;
          setFilterMenuOpen(false);
          setExamplesListDialogOpen(false);
        }}
      >
        <View style={styles.examplesListDialogOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="例題一覧を閉じる"
            style={styles.examplesListDialogBackdrop}
            onPress={() => {
              if (examplesListNestedOpen) return;
              setFilterMenuOpen(false);
              setExamplesListDialogOpen(false);
            }}
          />
          <View
            style={[
              styles.examplesListDialogCard,
              isWide && styles.examplesListDialogCardWide,
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.examplesListDialogHeader}>
              <Text style={styles.examplesListDialogTitle}>例題一覧</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="閉じる"
                onPress={() => {
                  setFilterMenuOpen(false);
                  setExamplesListDialogOpen(false);
                }}
                style={({ pressed }) => [
                  styles.examplesListDialogClose,
                  pressed && styles.examplesListDialogClosePressed,
                ]}
              >
                <Text style={styles.examplesListDialogCloseLabel}>×</Text>
              </Pressable>
            </View>
            {examplesFilterBody}
            <ScrollView
              style={styles.examplesListDialogScroll}
              contentContainerStyle={styles.panelList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {examplesListBody}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={examRebalanceConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!examBankBusy) setExamRebalanceConfirmOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!examBankBusy) setExamRebalanceConfirmOpen(false);
            }}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>複数選択の比率を調整しますか？</Text>
            <Text style={styles.modalLead}>
              現行バンクは単一選択に偏っている可能性があります。単一選択を一部削除し、複数選択（正解2つ）を再生成して SAP 目安（複数
              20〜30%）に近づけます。
            </Text>
            {examBankProgressText ? (
              <Text style={styles.modalLead}>{examBankProgressText}</Text>
            ) : null}
            {examBankBusy ? (
              <View style={styles.historyEmptyBox}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={examBankBusy}
                onPress={() => {
                  setExamRebalanceConfirmOpen(false);
                  void openExamLobby();
                }}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed && styles.modalSecondaryButtonPressed,
                ]}
              >
                <Text style={styles.modalSecondaryButtonLabel}>
                  調整せず開始
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={examBankBusy}
                onPress={() => {
                  void handleConfirmRebalanceMulti();
                }}
                style={({ pressed }) => [
                  styles.modalPrimaryButton,
                  pressed && styles.modalPrimaryButtonPressed,
                ]}
              >
                <Text style={styles.modalPrimaryButtonLabel}>調整して再生成</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={examBankConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!examBankBusy) setExamBankConfirmOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!examBankBusy) setExamBankConfirmOpen(false);
            }}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>共有バンクを作成しますか？</Text>
            <Text style={styles.modalLead}>
              AWS SAP 向け共有バンク（150問）をAIで生成します。ドメイン比率は公式ガイドに沿い、1回あたり最大5問ずつ作成します。途中で止まっても既存の問題は残し、続きから再開できます。完了まで時間がかかります。
            </Text>
            {examBankProgressText ? (
              <Text style={styles.modalLead}>{examBankProgressText}</Text>
            ) : null}
            {examBankBusy ? (
              <View style={styles.historyEmptyBox}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={examBankBusy}
                onPress={() => setExamBankConfirmOpen(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed && styles.modalSecondaryButtonPressed,
                ]}
              >
                <Text style={styles.modalSecondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={examBankBusy}
                onPress={() => {
                  void handleConfirmGenerateBank();
                }}
                style={({ pressed }) => [
                  styles.modalPrimaryButton,
                  pressed && styles.modalPrimaryButtonPressed,
                  examBankBusy && styles.modalPrimaryButtonDisabled,
                ]}
              >
                <Text style={styles.modalPrimaryButtonLabel}>
                  {examBankBusy ? '生成中…' : '作成する'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
        visible={historyDeleteTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!historyDeleteBusy) setHistoryDeleteTarget(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!historyDeleteBusy) setHistoryDeleteTarget(null);
            }}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>実施履歴を削除しますか？</Text>
            <Text style={styles.modalLead}>
              「{historyDeleteTarget?.title}」を削除します。この操作は取り消せません。
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={historyDeleteBusy}
                onPress={() => setHistoryDeleteTarget(null)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed && styles.modalSecondaryButtonPressed,
                ]}
              >
                <Text style={styles.modalSecondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={historyDeleteBusy}
                onPress={() => {
                  void handleHistoryDeleteConfirm();
                }}
                style={({ pressed }) => [
                  styles.modalDangerButton,
                  pressed && styles.modalDangerButtonPressed,
                ]}
              >
                {historyDeleteBusy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.modalDangerButtonLabel}>削除する</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={keywordReviewResult != null}
        transparent
        animationType="fade"
        onRequestClose={() => setKeywordReviewResult(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setKeywordReviewResult(null)}
          />
          <View
            style={[
              styles.modalCard,
              styles.reviewResultCard,
              isWide && styles.modalCardWide,
            ]}
          >
            <Text style={styles.modalTitle}>キーワードレビュー結果</Text>
            {keywordReviewResult ? (
              <ScrollView
                style={styles.reviewResultScroll}
                contentContainerStyle={styles.reviewResultContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.reviewResultKeyword}>
                  {keywordReviewResult.keyword}
                </Text>
                <View
                  style={[
                    styles.gradeBadge,
                    {
                      backgroundColor: gradeAccent(keywordReviewResult.grade),
                    },
                  ]}
                >
                  <Text style={styles.gradeBadgeLabel}>
                    理解度 {keywordReviewResult.grade}
                  </Text>
                </View>

                <Text style={styles.reviewResultSectionTitle}>
                  なぜこの評価か
                </Text>
                <Text style={styles.reviewResultBody}>
                  {keywordReviewResult.reason || '（理由なし）'}
                </Text>

                <Text style={styles.reviewResultSectionTitle}>良い点</Text>
                <Text style={styles.reviewResultBody}>
                  {keywordReviewResult.good_points || '（記載なし）'}
                </Text>

                <Text style={styles.reviewResultSectionTitle}>改善点</Text>
                <Text style={styles.reviewResultBody}>
                  {keywordReviewResult.bad_points || '（記載なし）'}
                </Text>

                <Text style={styles.reviewResultSectionTitle}>提出した説明</Text>
                <Text style={styles.reviewResultExplain}>
                  {keywordReviewResult.explanation}
                </Text>
              </ScrollView>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setKeywordReviewResult(null)}
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

      <Modal
        visible={batchHistoryDetail != null}
        transparent
        animationType="fade"
        onRequestClose={closeBatchHistoryDetail}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={closeBatchHistoryDetail}
          />
          <View
            style={[
              styles.modalCard,
              styles.reviewResultCard,
              isWide && styles.modalCardWide,
            ]}
          >
            <View style={styles.batchHistoryHeader}>
              <Text style={[styles.modalTitle, styles.batchHistoryTitle]}>
                {batchHistoryKind === 'exam'
                  ? '本番試験の結果'
                  : 'まとめて解いた結果'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="閉じる"
                onPress={closeBatchHistoryDetail}
                style={({ pressed }) => [
                  styles.batchHistoryCloseButton,
                  pressed && styles.batchHistoryCloseButtonPressed,
                ]}
              >
                <Text style={styles.batchHistoryCloseLabel}>×</Text>
              </Pressable>
            </View>
            {batchHistoryDetail ? (
              <ScrollView
                style={styles.reviewResultScroll}
                contentContainerStyle={styles.reviewResultContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.batchResultScore}>
                  {batchHistoryDetail.total}問中{' '}
                  {batchHistoryDetail.correct_count}問正解
                </Text>
                <Text style={styles.batchResultRate}>
                  正答率{' '}
                  {batchHistoryDetail.total > 0
                    ? Math.round(
                        (batchHistoryDetail.correct_count /
                          batchHistoryDetail.total) *
                          100,
                      )
                    : 0}
                  %
                </Text>
                {sessionCategoryStats.length > 0 ? (
                  <View style={styles.sessionAnalysisBlock}>
                    <Text style={styles.sessionAnalysisTitle}>
                      この回のカテゴリ理解度
                    </Text>
                    <CategoryRadarChart
                      categories={sessionCategoryStats}
                      size={240}
                    />
                  </View>
                ) : null}
                {batchHistoryDetail.results.map((item, index) => {
                  const answerSummary = formatBatchAnswerSummary(item);
                  return (
                  <View key={`${item.example_id}-${index}`} style={styles.batchResultRow}>
                    <View style={styles.batchResultMain}>
                      <Text style={styles.batchResultIndex}>第{index + 1}問</Text>
                      <Text style={styles.batchResultTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <View style={styles.batchResultMeta}>
                        <Text
                          style={[
                            styles.batchResultVerdict,
                            item.correct
                              ? styles.batchResultCorrect
                              : styles.batchResultWrong,
                          ]}
                        >
                          {item.correct ? '正解' : '不正解'}
                        </Text>
                      </View>
                      {answerSummary ? (
                        <Text style={styles.batchAnswerSummary} numberOfLines={3}>
                          {answerSummary}
                        </Text>
                      ) : null}
                      <View style={styles.batchResultActions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${item.title}を開く`}
                          onPress={() => {
                            void openExampleFromBatchHistory(item.example_id);
                          }}
                          style={({ pressed }) => [
                            styles.batchOpenButton,
                            pressed && styles.batchOpenButtonPressed,
                          ]}
                        >
                          <Text style={styles.batchOpenButtonLabel}>
                            この問題を開く
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${item.title}の解説を見る`}
                          onPress={() => {
                            void openReviewFromBatchHistory(item);
                          }}
                          style={({ pressed }) => [
                            styles.batchReviewButton,
                            pressed && styles.batchReviewButtonPressed,
                          ]}
                        >
                          <Text style={styles.batchReviewButtonLabel}>
                            解説を見る
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                  );
                })}
              </ScrollView>
            ) : null}
            {batchHistoryKind === 'exam' ? null : (
              <View style={styles.modalActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void startBatchRechallenge();
                  }}
                  style={({ pressed }) => [
                    styles.modalPrimaryButton,
                    pressed && styles.modalPrimaryButtonPressed,
                  ]}
                >
                  <Text style={styles.modalPrimaryButtonLabel}>
                    再チャレンジをする
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <AnalysisModal
        visible={analysisOpen}
        certificationId={certification.id}
        certificationName={certification.name}
        onClose={() => setAnalysisOpen(false)}
        onOpenCategoryMaster={() => {
          setCategoryMasterOpen(true);
        }}
      />

      <CategoryMasterModal
        visible={categoryMasterOpen}
        certificationId={certification.id}
        onClose={() => setCategoryMasterOpen(false)}
      />

      <ReviewSessionModal
        visible={reviewOpen}
        certificationId={certification.id}
        onClose={() => {
          setReviewOpen(false);
          void loadDueCount();
        }}
        onSessionFinished={() => {
          void loadDueCount();
        }}
      />

      <ExamStartModal
        visible={examLobbyIds != null}
        certificationName={certification.name}
        questionCount={examLobbyIds?.length ?? EXAM_QUESTION_COUNT}
        timeLimitMinutes={EXAM_TIME_LIMIT_MINUTES}
        busy={examLobbyBusy}
        onStart={handleStartExam}
        onClose={() => {
          if (!examLobbyBusy) setExamLobbyIds(null);
        }}
      />

      <ExampleSolveModal
        visible={solveSession != null}
        exampleIds={solveSession?.exampleIds ?? []}
        certificationId={certification.id}
        certificationName={certification.name}
        historyId={solveSession?.historyId ?? null}
        initialMessages={solveSession?.initialMessages ?? []}
        resumeMode={solveSession?.resumeMode ?? false}
        reviewMode={solveSession?.reviewMode ?? false}
        initialSelectedIds={solveSession?.initialSelectedIds ?? []}
        initialDescriptiveAnswer={
          solveSession?.initialDescriptiveAnswer ?? ''
        }
        examMode={solveSession?.examMode ?? false}
        timeLimitSeconds={solveSession?.timeLimitSeconds ?? null}
        onClose={() => {
          setSolveSession(null);
          void loadDueCount();
        }}
        onHistoryChanged={() => {
          void loadHistories();
          void loadDueCount();
        }}
        onExamFinished={(payload) => {
          void handleExamFinished(payload);
        }}
      />

      <Modal
        visible={bankImportIds != null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!bankImportBusy) setBankImportIds(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!bankImportBusy) setBankImportIds(null);
            }}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>共有バンクを取り込みますか？</Text>
            <Text style={styles.modalLead}>
              今回の試験で出た共有バンク問題のうち、まだ例題一覧にないものが{' '}
              {bankImportIds?.length ?? 0}{' '}
              問あります。例題一覧へ取り込みますか？（設定で次回以降の確認表示をオフにもできます）
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={bankImportBusy}
                onPress={() => setBankImportIds(null)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed && styles.modalSecondaryButtonPressed,
                ]}
              >
                <Text style={styles.modalSecondaryButtonLabel}>いまはしない</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={bankImportBusy}
                onPress={() => {
                  void handleConfirmBankImport();
                }}
                style={({ pressed }) => [
                  styles.modalPrimaryButton,
                  pressed && styles.modalPrimaryButtonPressed,
                  bankImportBusy && styles.modalPrimaryButtonDisabled,
                ]}
              >
                <Text style={styles.modalPrimaryButtonLabel}>
                  {bankImportBusy ? '取り込み中…' : '取り込む'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ExampleReportModal
        visible={reportTarget != null}
        exampleId={reportTarget?.id ?? ''}
        exampleTitle={reportTarget?.title ?? ''}
        certificationId={certification.id}
        certificationName={certification.name}
        onClose={() => setReportTarget(null)}
        onSubmitted={() => {
          setNoticeMessage('誤り連絡を受け付けました。ありがとうございます。');
        }}
      />

      <Modal
        visible={noticeMessage != null}
        transparent
        animationType="fade"
        onRequestClose={dismissNotice}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={dismissNotice}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>お知らせ</Text>
            <Text style={styles.modalLead}>{noticeMessage}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={dismissNotice}
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
  },
  rootPhone: {
    paddingTop: 6,
    paddingBottom: 5,
  },
  header: {
    position: 'relative',
    backgroundColor: colors.ink,
    borderRadius: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerPhone: {
    gap: 6,
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
  headerSideRightPhone: {
    justifyContent: 'flex-start',
  },
  headerChipPhone: {
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerTitle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerTitlePhone: {
    paddingVertical: 2,
  },
  headerExamButton: {
    marginTop: 8,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.spotlight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'stretch',
  },
  headerExamButtonPressed: {
    backgroundColor: colors.spotlightDeep,
  },
  headerExamButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  hamburgerButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  hamburgerBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.spotlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburgerBadgeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 9,
    color: colors.paper,
  },
  headerMenuOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingHorizontal: 12,
  },
  headerMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 42, 67, 0.35)',
  },
  headerMenuCard: {
    zIndex: 1,
    minWidth: 220,
    maxWidth: 280,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    shadowColor: '#102A43',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  headerMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerMenuItemPressed: {
    backgroundColor: colors.accentSoft,
  },
  headerMenuItemLabel: {
    flex: 1,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
  },
  headerMenuDueBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.accentDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 22,
    color: colors.paper,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  brandPhone: {
    fontSize: 18,
  },
  certName: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.accentSoft,
    marginTop: 4,
    textAlign: 'center',
  },
  certNamePhone: {
    fontSize: 13,
    lineHeight: 18,
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
    flexDirection: 'row',
    gap: 8,
  },
  examButtonPressed: {
    backgroundColor: colors.spotlightDeep,
  },
  examButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  analysisButton: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 8,
  },
  analysisButtonPressed: {
    backgroundColor: colors.accent,
  },
  analysisButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.accentDeep,
  },
  settingsButton: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 8,
  },
  settingsButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  settingsButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.accentDeep,
  },
  srsReviewButton: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 8,
  },
  srsReviewButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  srsReviewButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
  },
  dueBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.accentDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dueBadgeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 11,
    color: colors.paper,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  filterCombo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 140,
    maxWidth: 220,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterComboPhone: {
    flexGrow: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  filterComboPressed: {
    backgroundColor: colors.accentSoft,
  },
  filterComboLabel: {
    flex: 1,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.ink,
  },
  filterComboCaret: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 10,
    color: colors.muted,
  },
  filterButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  filterButtonPressed: {
    backgroundColor: colors.accent,
  },
  filterButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  filterHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
  filterHintPhone: {
    width: '100%',
  },
  filterMenu: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    marginBottom: 8,
    overflow: 'hidden',
  },
  filterOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  filterOptionActive: {
    backgroundColor: colors.accentSoft,
  },
  filterOptionLabel: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  filterOptionLabelActive: {
    fontFamily: 'NotoSansJP_700Bold',
    color: colors.accentDeep,
  },
  exampleTitleBlock: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  categoryTag: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryTagPressed: {
    backgroundColor: colors.accent,
  },
  categoryTagLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 11,
    color: colors.accentDeep,
  },
  uncategorizedLabel: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 11,
    color: colors.muted,
  },
  sessionAnalysisBlock: {
    marginTop: 8,
    marginBottom: 12,
    gap: 6,
  },
  sessionAnalysisTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 0,
  },
  bodyWideFill: {
    flex: 1,
  },
  bodyStacked: {
    flexDirection: 'column',
    flex: 0,
    width: '100%',
  },
  bodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  bodyScrollWide: {
    flex: 1,
  },
  bodyScrollContent: {
    flexGrow: 1,
    gap: 12,
    paddingBottom: 8,
  },
  bodyScrollContentWide: {
    flex: 1,
  },
  bodyScrollContentPhone: {
    flexGrow: 0,
    paddingBottom: 28,
    gap: 12,
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
  mainColumnInScroll: {
    flex: 0,
    width: '100%',
    gap: 12,
  },
  historyPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: 14,
    overflow: 'hidden',
  },
  historyPanelBeside: {
    flex: 1,
    maxWidth: 280,
  },
  examplesPanel: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: 14,
    overflow: 'hidden',
  },
  examplesPanelBeside: {
    flex: 2,
    minHeight: 0,
  },
  panelInScroll: {
    flex: 0,
    alignSelf: 'stretch',
    width: '100%',
  },
  historyPanelStacked: {
    minHeight: 180,
  },
  examplesPanelStacked: {
    minHeight: 240,
  },
  panelInScrollPhone: {
    padding: 12,
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
  panelList: {
    gap: 10,
    paddingBottom: 4,
  },
  panelListScroll: {
    flexGrow: 0,
  },
  phoneShell: {
    flex: 1,
    minHeight: 0,
  },
  phoneTabPane: {
    flex: 1,
    minHeight: 0,
  },
  phoneTabScroll: {
    flex: 1,
    minHeight: 0,
  },
  phoneKeywordScrollContent: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  phoneCard: {
    backgroundColor: colors.paper,
    borderRadius: 0,
    borderWidth: 0,
    padding: 12,
    gap: 4,
  },
  phoneCardFill: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.paper,
    borderRadius: 0,
    borderWidth: 0,
    padding: 12,
  },
  phoneExamplesPane: {
    gap: 12,
    justifyContent: 'flex-start',
  },
  phoneTabBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 0,
    borderTopWidth: 1,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderColor: colors.line,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: colors.paper,
  },
  phoneTabItem: {
    flex: 1,
    minHeight: 53,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: colors.paper,
  },
  phoneTabItemDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
  },
  phoneTabItemActive: {
    backgroundColor: colors.accentSoft,
  },
  phoneTabItemPressed: {
    opacity: 0.88,
  },
  phoneTabIcon: {
    marginTop: 1,
  },
  phoneTabLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.inkSoft,
    textAlign: 'center',
  },
  phoneTabLabelActive: {
    color: colors.accentDeep,
  },
  openExamplesListButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  openExamplesListButtonPressed: {
    backgroundColor: colors.accent,
  },
  openExamplesListButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.accentDeep,
  },
  examplesListDialogOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 24,
  },
  examplesListDialogBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(16, 42, 67, 0.45)',
  },
  examplesListDialogCard: {
    zIndex: 2,
    flex: 1,
    maxHeight: '92%',
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 10,
  },
  examplesListDialogCardWide: {
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  examplesListDialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  examplesListDialogTitle: {
    flex: 1,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
  },
  examplesListDialogClose: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.spotlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  examplesListDialogClosePressed: {
    backgroundColor: colors.spotlightDeep,
  },
  examplesListDialogCloseLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 22,
    lineHeight: 24,
    color: colors.paper,
  },
  examplesListDialogScroll: {
    flex: 1,
    minHeight: 0,
  },

  panelScroll: {
    flex: 1,
    minHeight: 0,
  },
  panelScrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  examplesHeader: {
    marginBottom: 12,
    gap: 10,
  },
  examplesHeaderWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  examplesHeaderStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  examplesTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
    textAlign: 'center',
  },
  createButton: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  createButtonStacked: {
    alignSelf: 'stretch',
    minHeight: 44,
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
  solveButtonDisabled: {
    backgroundColor: colors.line,
  },
  solveButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.paper,
  },
  solveButtonLabelDisabled: {
    color: colors.muted,
  },
  questionCountHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
  questionCountHintPhone: {
    width: '100%',
    textAlign: 'center',
  },
  sectionLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
    marginBottom: 8,
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
  historyRowPhone: {
    alignItems: 'flex-start',
    flexWrap: 'wrap',
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
  historyActions: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
  },
  historyActionsPhone: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyDeleteButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.spotlight,
    backgroundColor: colors.paper,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  historyDeleteButtonPressed: {
    backgroundColor: '#F8E8E6',
  },
  historyDeleteButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.spotlight,
    textAlign: 'center',
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
  exampleRowPhone: {
    flexDirection: 'column',
    alignItems: 'stretch',
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
  exampleActionsPhone: {
    justifyContent: 'flex-start',
    width: '100%',
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
    minHeight: 0,
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: 14,
    overflow: 'hidden',
  },
  keywordPanelPhone: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: '100%',
    minHeight: 0,
    padding: 12,
  },
  keywordPanelWide: {
    flex: 1,
    maxWidth: 340,
    minHeight: 0,
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
  keywordExplainInputPhone: {
    minHeight: 96,
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
  reviewButtonDisabled: {
    backgroundColor: colors.line,
  },
  reviewButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  reviewButtonLabelDisabled: {
    color: colors.muted,
  },
  reviewResultCard: {
    maxHeight: '88%',
  },
  reviewResultScroll: {
    maxHeight: 420,
  },
  reviewResultContent: {
    gap: 8,
    paddingBottom: 4,
  },
  reviewResultKeyword: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
  },
  gradeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 6,
  },
  gradeBadgeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.paper,
  },
  reviewResultSectionTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
    marginTop: 8,
  },
  reviewResultBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
  },
  reviewResultExplain: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 21,
    color: colors.inkSoft,
    backgroundColor: colors.mist,
    borderRadius: 10,
    padding: 12,
  },
  batchResultScore: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 24,
    color: colors.ink,
    marginBottom: 4,
  },
  batchResultRate: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.accentDeep,
    marginBottom: 16,
  },
  batchResultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  batchResultMain: {
    flex: 1,
    gap: 6,
  },
  batchResultIndex: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.muted,
  },
  batchResultTitle: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  batchResultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 2,
  },
  batchResultVerdict: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
  },
  batchResultCorrect: {
    color: colors.accentDeep,
  },
  batchResultWrong: {
    color: colors.spotlight,
  },
  batchAnswerSummary: {
    marginTop: 4,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 18,
  },
  batchResultActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  batchOpenButton: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  batchOpenButtonPressed: {
    backgroundColor: colors.accent,
  },
  batchOpenButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.accentDeep,
  },
  batchReviewButton: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  batchReviewButtonPressed: {
    backgroundColor: colors.mist,
    borderColor: colors.accent,
  },
  batchReviewButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
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
  batchHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  batchHistoryTitle: {
    flex: 1,
    paddingRight: 4,
  },
  batchHistoryCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.spotlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchHistoryCloseButtonPressed: {
    backgroundColor: colors.spotlightDeep,
  },
  batchHistoryCloseLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 22,
    lineHeight: 24,
    color: colors.paper,
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
  modalPrimaryButtonDisabled: {
    opacity: 0.55,
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
