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
  askExampleChat,
  fetchExampleDetail,
  generateExampleDiagram,
  getAskErrorMessage,
  getDiagramErrorMessage,
  getExampleErrorMessage,
  shuffleChoices,
} from '../lib/examplesApi';
import { downloadDiagramPdf } from '../lib/diagramPdf';
import {
  insertAiChatHistory,
  insertExampleBatchHistory,
  updateAiChatHistory,
} from '../lib/historiesApi';
import { ensureExampleSrsCard } from '../lib/srsApi';
import { ExampleReportModal } from './ExampleReportModal';
import { colors } from '../theme/colors';
import {
  isSelectExample,
  type ExampleDetail,
  type SelectAnswer,
} from '../types/example';
import type {
  ExampleBatchResultItem,
  HistoryChatMessage,
} from '../types/history';

type Props = {
  visible: boolean;
  /** 1件以上。連続解答時は複数 */
  exampleIds: string[];
  certificationId: string;
  certificationName: string;
  historyId?: string | null;
  initialMessages?: HistoryChatMessage[];
  resumeMode?: boolean;
  /** 本番試験モード（表示文言・制限時間用） */
  examMode?: boolean;
  /** 制限時間（秒）。指定時のみカウントダウン */
  timeLimitSeconds?: number | null;
  onClose: () => void;
  onHistoryChanged?: () => void;
  /** 本番試験を採点・時間切れまで完了して閉じたとき */
  onExamFinished?: (payload: { exampleIds: string[] }) => void;
};

type DisplayChoice = SelectAnswer & { label: string };

type ChatMessage = HistoryChatMessage;

function toChoiceLabel(index: number) {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ExampleSolveModal({
  visible,
  exampleIds,
  certificationId,
  certificationName,
  historyId = null,
  initialMessages = [],
  resumeMode = false,
  examMode = false,
  timeLimitSeconds = null,
  onClose,
  onHistoryChanged,
  onExamFinished,
}: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const [queueIndex, setQueueIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [example, setExample] = useState<ExampleDetail | null>(null);
  const [choices, setChoices] = useState<DisplayChoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [descriptiveDraft, setDescriptiveDraft] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const [diagramBusy, setDiagramBusy] = useState(false);
  const [closingBusy, setClosingBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<
    Array<ExampleBatchResultItem | null>
  >([]);
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const [batchHistorySaved, setBatchHistorySaved] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [examCloseConfirmOpen, setExamCloseConfirmOpen] = useState(false);
  const [examDrafts, setExamDrafts] = useState<
    Array<{ selectedIds: string[]; descriptiveDraft: string } | null>
  >([]);
  const examFinishedRef = useRef(false);

  const initialMessagesRef = useRef(initialMessages);
  initialMessagesRef.current = initialMessages;
  const resumeModeRef = useRef(resumeMode);
  resumeModeRef.current = resumeMode;
  const historyIdRef = useRef(historyId);
  historyIdRef.current = historyId;
  const batchResultsRef = useRef(batchResults);
  batchResultsRef.current = batchResults;
  const exampleRef = useRef(example);
  exampleRef.current = example;
  const queueIndexRef = useRef(queueIndex);
  queueIndexRef.current = queueIndex;
  const showBatchSummaryRef = useRef(showBatchSummary);
  showBatchSummaryRef.current = showBatchSummary;
  const batchHistorySavedRef = useRef(batchHistorySaved);
  batchHistorySavedRef.current = batchHistorySaved;
  const timedOutRef = useRef(false);
  const examDraftsRef = useRef(examDrafts);
  examDraftsRef.current = examDrafts;
  const examChoicesCacheRef = useRef<Map<string, DisplayChoice[]>>(new Map());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const descriptiveDraftRef = useRef(descriptiveDraft);
  descriptiveDraftRef.current = descriptiveDraft;
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  const exampleId = exampleIds[queueIndex] ?? null;
  const queueTotal = exampleIds.length;
  const hasNext = !resumeMode && queueIndex < queueTotal - 1;
  const isBatch = !resumeMode && queueTotal > 1;
  const isLastInBatch = isBatch && !hasNext;

  useEffect(() => {
    if (!visible) {
      setQueueIndex(0);
      setBatchResults([]);
      setShowBatchSummary(false);
      setBatchHistorySaved(false);
      setReportOpen(false);
      setReportNotice(null);
      setRemainingSeconds(null);
      setTimedOut(false);
      timedOutRef.current = false;
      setExamDrafts([]);
      setExamCloseConfirmOpen(false);
      examFinishedRef.current = false;
      examChoicesCacheRef.current = new Map();
      return;
    }
    setQueueIndex(0);
    setBatchResults(Array.from({ length: exampleIds.length }, () => null));
    setExamDrafts(Array.from({ length: exampleIds.length }, () => null));
    setShowBatchSummary(false);
    setBatchHistorySaved(false);
    setReportOpen(false);
    setReportNotice(null);
    setTimedOut(false);
    timedOutRef.current = false;
    setExamCloseConfirmOpen(false);
    examFinishedRef.current = false;
    examChoicesCacheRef.current = new Map();
  }, [visible, exampleIds.join('|')]);

  useEffect(() => {
    if (!visible || !timeLimitSeconds || timeLimitSeconds <= 0) {
      setRemainingSeconds(null);
      return;
    }
    const endsAt = Date.now() + timeLimitSeconds * 1000;
    setRemainingSeconds(timeLimitSeconds);
    const timerId = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemainingSeconds(left);
      if (left <= 0) {
        clearInterval(timerId);
      }
    }, 250);
    return () => clearInterval(timerId);
  }, [visible, timeLimitSeconds, exampleIds.join('|')]);

  useEffect(() => {
    if (!visible || !exampleId) {
      setExample(null);
      setChoices([]);
      setSelectedIds([]);
      setDescriptiveDraft('');
      setRevealed(false);
      setChatOpen(false);
      setChatDraft('');
      setChatMessages([]);
      setChatSending(false);
      setDiagramBusy(false);
      setClosingBusy(false);
      setNotice(null);
      setActiveHistoryId(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedIds([]);
    setDescriptiveDraft('');
    setChatDraft('');
    setChatSending(false);
    setDiagramBusy(false);
    setClosingBusy(false);
    setNotice(null);

    const isFirstInSession = queueIndex === 0;
    const shouldResume = isFirstInSession && resumeModeRef.current && !examMode;
    setRevealed(shouldResume);
    setChatOpen(shouldResume);
    setChatMessages(shouldResume ? [...initialMessagesRef.current] : []);
    setActiveHistoryId(shouldResume ? historyIdRef.current : null);

    void (async () => {
      try {
        const detail = await fetchExampleDetail(exampleId);
        if (cancelled) return;
        setExample(detail);

        let labeled: DisplayChoice[];
        const cached = examMode
          ? examChoicesCacheRef.current.get(exampleId)
          : undefined;
        if (cached) {
          labeled = cached;
        } else {
          const baseChoices = shouldResume
            ? detail.choices
            : shuffleChoices(detail.choices);
          labeled = baseChoices.map((choice, index) => ({
            ...choice,
            label: toChoiceLabel(index),
          }));
          if (examMode) {
            examChoicesCacheRef.current.set(exampleId, labeled);
          }
        }
        setChoices(labeled);

        if (examMode) {
          const draft = examDraftsRef.current[queueIndex];
          setSelectedIds(draft?.selectedIds ?? []);
          setDescriptiveDraft(draft?.descriptiveDraft ?? '');
          setRevealed(false);
        } else if (shouldResume) {
          setSelectedIds(labeled.filter((c) => c.isAnswer).map((c) => c.id));
        }
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
  }, [visible, exampleId, queueIndex, examMode]);

  const isSelect = example ? isSelectExample(example) : false;
  const correctCount = useMemo(
    () => choices.filter((c) => c.isAnswer).length,
    [choices],
  );
  const isMultiple = isSelect && correctCount >= 2;
  const requiredSelectCount = isSelect ? Math.max(1, correctCount) : 0;

  const correctLabels = useMemo(
    () =>
      choices
        .filter((c) => c.isAnswer)
        .map((c) => c.label)
        .join(', '),
    [choices],
  );

  const isSelectionComplete = (ids: string[], required: number) => {
    if (required <= 0) return false;
    return ids.length === required;
  };

  const toggleChoice = (id: string) => {
    if (revealed && !examMode) return;
    if (!isMultiple) {
      setSelectedIds([id]);
      return;
    }
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      // 必要数に達したら、解除するまで追加不可
      if (prev.length >= requiredSelectCount) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const canCheck = isSelect
    ? isSelectionComplete(selectedIds, requiredSelectCount)
    : descriptiveDraft.trim().length > 0;

  const evaluateCurrentAnswer = (): boolean => {
    if (!example) return false;
    if (isSelect) {
      const correctIds = choices.filter((c) => c.isAnswer).map((c) => c.id);
      if (selectedIds.length !== correctIds.length) return false;
      const selectedSet = new Set(selectedIds);
      return correctIds.every((id) => selectedSet.has(id));
    }
    return (
      descriptiveDraft.trim().replace(/\s+/g, '') ===
      example.answer.trim().replace(/\s+/g, '')
    );
  };

  const handleCheck = () => {
    if (examMode) return;
    if (!canCheck || !example || !exampleId) return;
    const correct = evaluateCurrentAnswer();
    if (isBatch) {
      setBatchResults((prev) => {
        const next = [...prev];
        next[queueIndex] = {
          example_id: exampleId,
          title: example.title || '無題の例題',
          correct,
        };
        return next;
      });
    }
    setRevealed(true);
    if (correct) {
      void ensureExampleSrsCard({
        certificationId,
        exampleId,
      }).catch((err) => {
        console.error('[ExampleSolveModal] srs card', err);
      });
    }
  };

  const commitExamProgressAt = (args: {
    index: number;
    exampleId: string;
    example: ExampleDetail;
    choices: DisplayChoice[];
    selectedIds: string[];
    descriptiveDraft: string;
  }): ExampleBatchResultItem | null => {
    const {
      index,
      exampleId: id,
      example: ex,
      choices: ch,
      selectedIds: ids,
      descriptiveDraft: desc,
    } = args;

    const draft = { selectedIds: [...ids], descriptiveDraft: desc };
    const select = isSelectExample(ex);
    const required = select
      ? Math.max(1, ch.filter((c) => c.isAnswer).length)
      : 0;
    const hasPartialOrMore = select
      ? ids.length > 0
      : desc.trim().length > 0;
    // 複数選択は必要数ちょうど選んだときだけ「回答済み」
    const answered = select
      ? ids.length === required
      : desc.trim().length > 0;

    setExamDrafts((prev) => {
      const next = [...prev];
      while (next.length < queueTotal) next.push(null);
      // 途中選択は下書きとして残すが、回答済みにはしない
      next[index] = hasPartialOrMore ? draft : null;
      examDraftsRef.current = next;
      return next;
    });

    let result: ExampleBatchResultItem | null = null;
    if (answered) {
      let correct = false;
      if (select) {
        const correctIds = ch.filter((c) => c.isAnswer).map((c) => c.id);
        if (ids.length === correctIds.length) {
          const selectedSet = new Set(ids);
          correct = correctIds.every((cid) => selectedSet.has(cid));
        }
      } else {
        correct =
          desc.trim().replace(/\s+/g, '') ===
          ex.answer.trim().replace(/\s+/g, '');
      }
      result = {
        example_id: id,
        title: ex.title || '無題の例題',
        correct,
      };
    }

    setBatchResults((prev) => {
      const next = [...prev];
      while (next.length < queueTotal) next.push(null);
      next[index] = result;
      batchResultsRef.current = next;
      return next;
    });
    return result;
  };

  const commitCurrentExamProgress = () => {
    if (!examMode || !example || !exampleId) return;
    commitExamProgressAt({
      index: queueIndex,
      exampleId,
      example,
      choices,
      selectedIds: selectedIdsRef.current,
      descriptiveDraft: descriptiveDraftRef.current,
    });
  };

  const jumpToExamQuestion = (nextIndex: number) => {
    if (!examMode || showBatchSummary || closingBusy || loading) return;
    if (nextIndex < 0 || nextIndex >= queueTotal || nextIndex === queueIndex) {
      return;
    }
    commitCurrentExamProgress();
    setQueueIndex(nextIndex);
  };

  const buildFilledExamResults = (): ExampleBatchResultItem[] => {
    commitCurrentExamProgress();
    return exampleIds.map((id, index) => {
      const existing = batchResultsRef.current[index];
      if (existing != null) return existing;
      return {
        example_id: id,
        title: examDraftsRef.current[index] ? '解答済み' : '未解答',
        correct: false,
      };
    });
  };

  const persistFilledExamResults = (filled: ExampleBatchResultItem[]) => {
    if (batchHistorySavedRef.current) return;
    void (async () => {
      try {
        await insertExampleBatchHistory({
          certificationId,
          results: filled,
          examMode: true,
        });
        setBatchHistorySaved(true);
        onHistoryChanged?.();
      } catch (err) {
        console.error('[solve] persist exam results', err);
        setNotice(
          getExampleErrorMessage(err, '実施履歴の保存に失敗しました。'),
        );
      }
    })();
  };

  const handleExamGrade = () => {
    if (!examMode || showBatchSummary || closingBusy) return;
    const filled = buildFilledExamResults();
    setBatchResults(filled);
    batchResultsRef.current = filled;
    setChatOpen(false);
    setShowBatchSummary(true);
    setNotice('採点しました。試験中は正解を表示していません。');
    examFinishedRef.current = true;
    persistFilledExamResults(filled);
  };

  const batchCorrectCount = useMemo(
    () => batchResults.filter((item) => item?.correct === true).length,
    [batchResults],
  );

  const completedBatchResults = useMemo(() => {
    if (!isBatch) return [];
    if (batchResults.length !== queueTotal) return [];
    if (batchResults.some((item) => item == null)) return [];
    return batchResults as ExampleBatchResultItem[];
  }, [batchResults, isBatch, queueTotal]);

  const persistBatchHistoryIfNeeded = async () => {
    if (!isBatch || batchHistorySaved || completedBatchResults.length === 0) {
      return;
    }
    await insertExampleBatchHistory({
      certificationId,
      results: completedBatchResults,
    });
    setBatchHistorySaved(true);
    onHistoryChanged?.();
  };

  const persistHistoryIfNeeded = async () => {
    if (!example || !exampleId) return;
    const userCount = chatMessages.filter((m) => m.role === 'user').length;
    if (userCount === 0) return;

    if (activeHistoryId) {
      await updateAiChatHistory({
        historyId: activeHistoryId,
        exampleId,
        exampleTitle: example.title,
        messages: chatMessages,
      });
    } else {
      const createdId = await insertAiChatHistory({
        certificationId,
        exampleId,
        exampleTitle: example.title,
        messages: chatMessages,
      });
      setActiveHistoryId(createdId);
    }
    onHistoryChanged?.();
  };

  const handleClose = () => {
    if (chatSending || diagramBusy || closingBusy) return;
    void (async () => {
      setClosingBusy(true);
      try {
        if (examMode && !showBatchSummary) {
          commitCurrentExamProgress();
        }
        await persistHistoryIfNeeded();
        await persistBatchHistoryIfNeeded();
      } catch (err) {
        console.error('[solve] persist history', err);
        setNotice(
          getExampleErrorMessage(err, '実施履歴の保存に失敗しました。'),
        );
        setClosingBusy(false);
        return;
      }
      const shouldNotifyExamFinished =
        examMode && (showBatchSummary || examFinishedRef.current);
      const finishedIds = [...exampleIds];
      setClosingBusy(false);
      setExamCloseConfirmOpen(false);
      onClose();
      if (shouldNotifyExamFinished) {
        onExamFinished?.({ exampleIds: finishedIds });
      }
    })();
  };

  const requestClose = () => {
    if (chatSending || diagramBusy || closingBusy) return;
    if (examMode && !showBatchSummary) {
      setExamCloseConfirmOpen(true);
      return;
    }
    handleClose();
  };

  const handleNextQuestion = () => {
    if (!hasNext || chatSending || diagramBusy || closingBusy) return;
    void (async () => {
      setClosingBusy(true);
      try {
        await persistHistoryIfNeeded();
      } catch (err) {
        console.error('[solve] persist history before next', err);
        setNotice(
          getExampleErrorMessage(err, '実施履歴の保存に失敗しました。'),
        );
        setClosingBusy(false);
        return;
      }
      setClosingBusy(false);
      setQueueIndex((prev) => prev + 1);
    })();
  };

  const handleShowBatchSummary = () => {
    if (!isLastInBatch || chatSending || diagramBusy || closingBusy) return;
    void (async () => {
      setClosingBusy(true);
      try {
        await persistHistoryIfNeeded();
        await persistBatchHistoryIfNeeded();
      } catch (err) {
        console.error('[solve] persist history before summary', err);
        setNotice(
          getExampleErrorMessage(err, '実施履歴の保存に失敗しました。'),
        );
        setClosingBusy(false);
        return;
      }
      setClosingBusy(false);
      setChatOpen(false);
      setShowBatchSummary(true);
    })();
  };

  const finishDueToTimeout = () => {
    if (timedOutRef.current || showBatchSummaryRef.current) return;
    timedOutRef.current = true;
    setTimedOut(true);

    const filled = examMode
      ? buildFilledExamResults().map((item) =>
          item.title === '未解答'
            ? { ...item, title: '未解答（時間切れ）' }
            : item,
        )
      : batchResultsRef.current.map((item, index) => {
          if (item != null) return item;
          const id = exampleIds[index];
          if (!id) {
            return {
              example_id: `missing-${index}`,
              title: '未解答（時間切れ）',
              correct: false,
            };
          }
          const currentExample = exampleRef.current;
          const currentIndex = queueIndexRef.current;
          return {
            example_id: id,
            title:
              index === currentIndex && currentExample
                ? currentExample.title || '無題の例題'
                : '未解答（時間切れ）',
            correct: false,
          };
        });

    setBatchResults(filled);
    batchResultsRef.current = filled;
    setChatOpen(false);
    setRevealed(false);
    setShowBatchSummary(true);
    setNotice(
      '制限時間が終了しました。未解答は不正解として集計します。',
    );
    if (examMode) {
      examFinishedRef.current = true;
    }
    persistFilledExamResults(filled);
  };

  useEffect(() => {
    if (remainingSeconds !== 0) return;
    if (!timeLimitSeconds || timeLimitSeconds <= 0) return;
    finishDueToTimeout();
  }, [remainingSeconds, timeLimitSeconds]);

  const handleToggleChat = () => {
    if (chatSending || diagramBusy) return;
    setChatOpen((prev) => !prev);
  };

  const handleCreateDiagram = () => {
    if (!example || diagramBusy || chatSending) return;
    setDiagramBusy(true);
    void (async () => {
      try {
        const diagram = await generateExampleDiagram({
          exampleId: example.id,
        });
        await downloadDiagramPdf(diagram);
      } catch (err) {
        setNotice(getDiagramErrorMessage(err));
      } finally {
        setDiagramBusy(false);
      }
    })();
  };

  const handleSendChat = () => {
    const text = chatDraft.trim();
    if (!text || !example || chatSending) return;

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
    };
    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setChatDraft('');
    setChatSending(true);

    void (async () => {
      try {
        const reply = await askExampleChat({
          exampleId: example.id,
          messages: nextMessages.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        });
        setChatMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: reply,
          },
        ]);
      } catch (err) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: getAskErrorMessage(err),
          },
        ]);
      } finally {
        setChatSending(false);
      }
    })();
  };

  const showChatSide = chatOpen && isWide;
  const closeLocked = chatSending || diagramBusy || closingBusy;

  const examplePanel = example ? (
    <View style={styles.panel}>
      {examMode ? null : (
        <View style={styles.panelHeader}>
          <View style={styles.panelIcon}>
            <Text style={styles.panelIconLabel}>例</Text>
          </View>
          <Text style={styles.panelTitle}>例題</Text>
        </View>
      )}

      {!examMode && example.title ? (
        <Text style={styles.exampleTitle}>{example.title}</Text>
      ) : null}

      {examMode ? null : (
        <Text style={styles.categoryLabel}>
          カテゴリ: {example.categoryName?.trim() || '未分類'}
        </Text>
      )}

      <Text style={styles.questionText}>
        {examMode ? example.question : `Q. ${example.question}`}
      </Text>

      {example.questionImageUrls.length > 0 ? (
        <View style={styles.questionImages}>
          {example.questionImageUrls.map((uri) => (
            <Image
              key={uri}
              source={{ uri }}
              style={styles.questionImage}
              resizeMode="contain"
              accessibilityLabel="問題の図"
            />
          ))}
        </View>
      ) : null}

      {isSelect ? (
        <View style={styles.choiceList}>
          {isMultiple && !showBatchSummary ? (
            <Text style={styles.multiHint}>
              複数選択（正解は {correctCount} つ
              {selectedIds.length >= correctCount
                ? '・選択完了。外してから変更できます'
                : `・あと ${Math.max(0, correctCount - selectedIds.length)} つ`}
              ）
            </Text>
          ) : null}
          {choices.map((choice) => {
            const selected = selectedIds.includes(choice.id);
            const showCorrect = revealed && !examMode && choice.isAnswer;
            const showWrong =
              revealed && !examMode && selected && !choice.isAnswer;
            const multiLocked =
              isMultiple &&
              !selected &&
              selectedIds.length >= requiredSelectCount;
            const choiceDisabled =
              (revealed && !examMode) || multiLocked;
            return (
              <Pressable
                key={choice.id}
                accessibilityRole={isMultiple ? 'checkbox' : 'radio'}
                accessibilityState={{
                  selected,
                  checked: selected,
                  disabled: choiceDisabled,
                }}
                disabled={choiceDisabled}
                onPress={() => toggleChoice(choice.id)}
                style={[
                  styles.choiceRow,
                  selected && !(revealed && !examMode) && styles.choiceRowSelected,
                  showCorrect && styles.choiceRowCorrect,
                  showWrong && styles.choiceRowWrong,
                  multiLocked && styles.choiceRowLocked,
                ]}
              >
                <View
                  style={[
                    styles.choiceMark,
                    isMultiple && styles.choiceMarkCheckbox,
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
            {revealed && !examMode ? '模範解答' : '解答を入力してください'}
          </Text>
          {revealed && !examMode ? (
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
          {revealed && !examMode && descriptiveDraft.trim() ? (
            <View style={styles.yourAnswerBox}>
              <Text style={styles.yourAnswerLabel}>あなたの解答</Text>
              <Text style={styles.yourAnswerText}>
                {descriptiveDraft.trim()}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {revealed && !examMode && isSelect ? (
        <View style={styles.answerBadge}>
          <Text style={styles.answerBadgeLabel}>
            正解: {correctLabels || '—'}
          </Text>
        </View>
      ) : null}
    </View>
  ) : null;

  const explainPanel =
    example && revealed && !examMode ? (
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelIcon}>
            <Text style={styles.panelIconLabel}>解</Text>
          </View>
          <Text style={styles.panelTitle}>解説</Text>
        </View>
        <Text style={styles.explainBody}>
          {example.explanation || '解説はまだありません。'}
        </Text>
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={diagramBusy || chatSending}
            onPress={handleCreateDiagram}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed &&
                !diagramBusy &&
                !chatSending &&
                styles.secondaryButtonPressed,
              (diagramBusy || chatSending) && styles.secondaryButtonDisabled,
            ]}
          >
            {diagramBusy ? (
              <View style={styles.buttonBusyRow}>
                <ActivityIndicator size="small" color={colors.accentDeep} />
                <Text style={styles.secondaryButtonLabel}>図解を作成中…</Text>
              </View>
            ) : (
              <Text style={styles.secondaryButtonLabel}>図解を作成</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={chatSending || diagramBusy}
            onPress={handleToggleChat}
            style={({ pressed }) => [
              chatOpen ? styles.closeChatButton : styles.aiButton,
              pressed &&
                !chatSending &&
                !diagramBusy &&
                (chatOpen
                  ? styles.closeChatButtonPressed
                  : styles.aiButtonPressed),
              (chatSending || diagramBusy) && styles.aiButtonDisabled,
            ]}
          >
            <Text
              style={
                chatOpen ? styles.closeChatButtonLabel : styles.aiButtonLabel
              }
            >
              {chatOpen ? '質問を閉じる' : 'AIに質問する'}
            </Text>
          </Pressable>
        </View>
      </View>
    ) : null;

  const chatPanel = chatOpen ? (
    <View style={styles.chatPaneInner}>
      <View style={styles.chatHeader}>
        <View style={styles.chatHeaderIcon}>
          <Text style={styles.chatHeaderIconLabel}>AI</Text>
        </View>
        <Text style={styles.chatHeaderTitle}>この例題についてAIに質問</Text>
      </View>

      <ScrollView
        style={styles.chatMessages}
        contentContainerStyle={styles.chatMessagesContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {chatMessages.length === 0 ? (
          <Text style={styles.chatEmpty}>
            解説を読んでもわからない点を質問できます。
          </Text>
        ) : (
          chatMessages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.chatBubble,
                message.role === 'user'
                  ? styles.chatBubbleUser
                  : styles.chatBubbleAssistant,
              ]}
            >
              <Text
                style={[
                  styles.chatBubbleRole,
                  message.role === 'user' && styles.chatBubbleRoleUser,
                ]}
              >
                {message.role === 'user' ? 'あなた' : 'AIアシスタント'}
              </Text>
              <Text
                style={[
                  styles.chatBubbleText,
                  message.role === 'user' && styles.chatBubbleTextUser,
                ]}
              >
                {message.text}
              </Text>
            </View>
          ))
        )}
        {chatSending ? (
          <View style={styles.chatThinking}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.chatThinkingLabel}>考え中…</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.chatComposer}>
        <TextInput
          value={chatDraft}
          onChangeText={setChatDraft}
          placeholder="関連する疑問を入力..."
          placeholderTextColor={colors.muted}
          style={styles.chatInput}
          multiline
          editable={!chatSending}
          textAlignVertical="top"
          onSubmitEditing={handleSendChat}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="送信"
          disabled={!chatDraft.trim() || chatSending}
          onPress={handleSendChat}
          style={({ pressed }) => [
            styles.chatSendButton,
            pressed && styles.chatSendButtonPressed,
            (!chatDraft.trim() || chatSending) && styles.chatSendButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.chatSendLabel,
              (!chatDraft.trim() || chatSending) && styles.chatSendLabelDisabled,
            ]}
          >
            送信
          </Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={requestClose}
    >
      <View style={[styles.overlay, examMode && styles.overlayExam]}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (!closeLocked) requestClose();
          }}
        />
        <View
          style={[
            styles.card,
            (revealed || chatOpen || showBatchSummary || examMode) &&
              styles.cardTall,
            examMode
              ? [styles.cardExam, { width: width * 0.9, maxWidth: width * 0.9 }]
              : chatOpen
                ? isWide
                  ? styles.cardExpandedWide
                  : styles.cardExpandedNarrow
                : isWide
                  ? styles.cardWide
                  : styles.cardNarrow,
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerTitleBlock}>
              <Text style={styles.title}>
                {showBatchSummary
                  ? timedOut
                    ? '時間切れ・解答結果'
                    : '解答結果'
                  : examMode
                    ? `本番試験（${queueIndex + 1}/${queueTotal}）`
                    : isBatch
                      ? `例題を解く（${queueIndex + 1}/${queueTotal}）`
                      : '例題を解く'}
              </Text>
              {remainingSeconds != null && !showBatchSummary ? (
                <Text
                  style={[
                    styles.timerText,
                    remainingSeconds <= 5 * 60 && styles.timerTextUrgent,
                  ]}
                >
                  残り {formatCountdown(remainingSeconds)}
                </Text>
              ) : null}
            </View>
            <View style={styles.headerActions}>
              {example && !showBatchSummary && !loading && !error ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={closeLocked}
                  onPress={() => setReportOpen(true)}
                  style={({ pressed }) => [
                    styles.reportHeaderButton,
                    pressed && !closeLocked && styles.reportHeaderButtonPressed,
                    closeLocked && styles.closeButtonDisabled,
                  ]}
                >
                  <Text style={styles.reportHeaderButtonLabel}>誤りを連絡</Text>
                </Pressable>
              ) : null}
              <Pressable
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              disabled={closeLocked}
              onPress={requestClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && !closeLocked && styles.closeButtonPressed,
                closeLocked && styles.closeButtonDisabled,
              ]}
            >
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
            </View>
          </View>

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.centerText}>読み込み中…</Text>
            </View>
          ) : error ? (
            <View style={styles.centerBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : showBatchSummary ? (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLead}>
                {timedOut
                  ? '制限時間により試験を終了しました'
                  : '全問の解答が終わりました'}
              </Text>
              <Text style={styles.summaryScore}>
                {queueTotal}問中 {batchCorrectCount}問正解
              </Text>
              <Text style={styles.summaryRate}>
                正答率{' '}
                {queueTotal > 0
                  ? Math.round((batchCorrectCount / queueTotal) * 100)
                  : 0}
                %
              </Text>
              <ScrollView
                style={styles.summaryList}
                contentContainerStyle={styles.summaryListContent}
                showsVerticalScrollIndicator
              >
                {batchResults.map((result, index) => (
                  <View key={`result-${index}`} style={styles.summaryRow}>
                    <View style={styles.summaryRowMain}>
                      <Text style={styles.summaryRowLabel}>第{index + 1}問</Text>
                      <Text style={styles.summaryRowTitle} numberOfLines={1}>
                        {result?.title || '—'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.summaryRowValue,
                        result?.correct
                          ? styles.summaryRowCorrect
                          : styles.summaryRowWrong,
                      ]}
                    >
                      {result?.correct ? '正解' : '不正解'}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : example ? (
            <View
              style={[
                styles.bodyRow,
                (revealed || chatOpen) && styles.bodyRowFlex,
                showChatSide ? styles.bodyRowSplit : styles.bodyRowStack,
              ]}
            >
              <View
                style={
                  showChatSide
                    ? styles.halfPane
                    : chatOpen
                      ? styles.mainPaneStacked
                      : styles.mainPaneAlone
                }
              >
                <ScrollView
                  style={
                    revealed || chatOpen
                      ? styles.scrollFill
                      : styles.scrollAuto
                  }
                  contentContainerStyle={[
                    styles.bodyContent,
                    !showChatSide && styles.bodyContentPadded,
                  ]}
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {examplePanel}
                  {explainPanel}
                </ScrollView>
              </View>
              {chatOpen ? (
                <View
                  style={[
                    styles.chatPane,
                    showChatSide ? styles.halfPane : styles.chatPaneStacked,
                  ]}
                >
                  {chatPanel}
                </View>
              ) : null}
            </View>
          ) : null}

          {!showBatchSummary &&
          examMode &&
          example &&
          !loading &&
          !error ? (
            <View style={styles.examNavSection}>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator
                style={styles.examJumpScroll}
                contentContainerStyle={styles.examJumpList}
                keyboardShouldPersistTaps="handled"
              >
                {exampleIds.map((_, index) => {
                  const liveAnswered =
                    index === queueIndex &&
                    (isSelect
                      ? isSelectionComplete(selectedIds, requiredSelectCount)
                      : descriptiveDraft.trim().length > 0);
                  const livePartial =
                    index === queueIndex &&
                    isSelect &&
                    isMultiple &&
                    selectedIds.length > 0 &&
                    selectedIds.length < requiredSelectCount;
                  const draft = examDrafts[index];
                  const draftHasSelection =
                    draft != null &&
                    (draft.selectedIds.length > 0 ||
                      draft.descriptiveDraft.trim().length > 0);
                  // 回答済みは batchResults のみ（複数選択の途中はここに入らない）
                  const answered =
                    batchResults[index] != null || liveAnswered;
                  const partial =
                    !answered &&
                    (livePartial ||
                      (index !== queueIndex &&
                        draftHasSelection &&
                        batchResults[index] == null));
                  const current = index === queueIndex;
                  return (
                    <Pressable
                      key={`jump-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={
                        answered
                          ? `第${index + 1}問（回答済み）`
                          : partial
                            ? `第${index + 1}問（選択途中）`
                            : `第${index + 1}問（未回答）`
                      }
                      disabled={closeLocked}
                      onPress={() => jumpToExamQuestion(index)}
                      style={[
                        styles.examJumpChip,
                        current && styles.examJumpChipCurrent,
                        answered && !current && styles.examJumpChipAnswered,
                        partial && !current && styles.examJumpChipPartial,
                      ]}
                    >
                      <Text
                        style={[
                          styles.examJumpChipLabel,
                          current && styles.examJumpChipLabelCurrent,
                          answered && !current && styles.examJumpChipLabelAnswered,
                        ]}
                      >
                        {index + 1}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Text style={styles.examJumpHint}>
                左右にスクロールして問題番号を選べます（{queueIndex + 1}/
                {queueTotal}）／緑=回答済み・薄色=選択途中
              </Text>
              <View style={styles.examFooterRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={closeLocked || queueIndex <= 0}
                  onPress={() => jumpToExamQuestion(queueIndex - 1)}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    styles.examNavButton,
                    pressed &&
                      !closeLocked &&
                      queueIndex > 0 &&
                      styles.secondaryButtonPressed,
                    (closeLocked || queueIndex <= 0) &&
                      styles.secondaryButtonDisabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonLabel}>前の問題</Text>
                </Pressable>
                {queueIndex < queueTotal - 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={closeLocked}
                    onPress={() => jumpToExamQuestion(queueIndex + 1)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      styles.examNavButton,
                      pressed && !closeLocked && styles.primaryButtonPressed,
                      closeLocked && styles.primaryButtonDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.primaryButtonLabel,
                        closeLocked && styles.primaryButtonLabelDisabled,
                      ]}
                    >
                      次の問題
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={closeLocked}
                    onPress={handleExamGrade}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      styles.examNavButton,
                      pressed && !closeLocked && styles.primaryButtonPressed,
                      closeLocked && styles.primaryButtonDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.primaryButtonLabel,
                        closeLocked && styles.primaryButtonLabelDisabled,
                      ]}
                    >
                      採点する
                    </Text>
                  </Pressable>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={closeLocked}
                onPress={handleExamGrade}
                style={({ pressed }) => [
                  styles.examGradeLink,
                  pressed && !closeLocked && styles.examGradeLinkPressed,
                  closeLocked && styles.secondaryButtonDisabled,
                ]}
              >
                <Text style={styles.examGradeLinkLabel}>
                  途中でも採点して終了
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!showBatchSummary &&
          !examMode &&
          !revealed &&
          example &&
          !loading &&
          !error ? (
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

          {!showBatchSummary &&
          !examMode &&
          revealed &&
          hasNext &&
          example &&
          !loading &&
          !error ? (
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                disabled={closeLocked}
                onPress={handleNextQuestion}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !closeLocked && styles.primaryButtonPressed,
                  closeLocked && styles.primaryButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.primaryButtonLabel,
                    closeLocked && styles.primaryButtonLabelDisabled,
                  ]}
                >
                  次の問題へ（{queueIndex + 2}/{queueTotal}）
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!showBatchSummary &&
          !examMode &&
          revealed &&
          isLastInBatch &&
          example &&
          !loading &&
          !error ? (
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                disabled={closeLocked}
                onPress={handleShowBatchSummary}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !closeLocked && styles.primaryButtonPressed,
                  closeLocked && styles.primaryButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.primaryButtonLabel,
                    closeLocked && styles.primaryButtonLabelDisabled,
                  ]}
                >
                  結果を見る
                </Text>
              </Pressable>
            </View>
          ) : null}

          {showBatchSummary ? (
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                disabled={closeLocked}
                onPress={handleClose}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !closeLocked && styles.primaryButtonPressed,
                  closeLocked && styles.primaryButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.primaryButtonLabel,
                    closeLocked && styles.primaryButtonLabelDisabled,
                  ]}
                >
                  閉じる
                </Text>
              </Pressable>
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

      {exampleId && example ? (
        <ExampleReportModal
          visible={reportOpen}
          exampleId={exampleId}
          exampleTitle={example.title}
          certificationId={certificationId}
          certificationName={certificationName}
          onClose={() => setReportOpen(false)}
          onSubmitted={() => {
            setReportNotice('誤り連絡を受け付けました。ありがとうございます。');
          }}
        />
      ) : null}

      <Modal
        visible={examCloseConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setExamCloseConfirmOpen(false)}
      >
        <View style={styles.noticeOverlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setExamCloseConfirmOpen(false)}
          />
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>試験を終了しますか？</Text>
            <Text style={styles.noticeBody}>
              閉じると1問目からやり直しになりますが、よろしいですか？
            </Text>
            <View style={styles.examCloseConfirmActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setExamCloseConfirmOpen(false)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleClose}
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

      <Modal
        visible={reportNotice != null}
        transparent
        animationType="fade"
        onRequestClose={() => setReportNotice(null)}
      >
        <View style={styles.noticeOverlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setReportNotice(null)}
          />
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>お知らせ</Text>
            <Text style={styles.noticeBody}>{reportNotice}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setReportNotice(null)}
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
  overlayExam: {
    paddingHorizontal: 0,
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
    flexDirection: 'column',
  },
  cardTall: {
    height: '92%',
  },
  cardWide: {
    maxWidth: 560,
  },
  cardNarrow: {
    maxWidth: 520,
  },
  cardExam: {
    alignSelf: 'center',
  },
  cardExpandedWide: {
    maxWidth: 980,
  },
  cardExpandedNarrow: {
    maxWidth: 560,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 10,
  },
  headerTitleBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 20,
    color: colors.ink,
  },
  timerText: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
    letterSpacing: 0.3,
  },
  timerTextUrgent: {
    color: colors.spotlight,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reportHeaderButton: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.mist,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  reportHeaderButtonPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  reportHeaderButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
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
  closeButtonDisabled: {
    opacity: 0.45,
  },
  closeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 20,
    color: colors.paper,
    marginTop: -2,
  },
  bodyRow: {
    flexShrink: 1,
    minHeight: 0,
  },
  bodyRowFlex: {
    flex: 1,
  },
  bodyRowSplit: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 12,
  },
  bodyRowStack: {
    flexDirection: 'column',
  },
  halfPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },
  mainPaneAlone: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
  },
  mainPaneStacked: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  scrollFill: {
    flex: 1,
    minHeight: 0,
    ...(Platform.OS === 'web' ? ({ overflow: 'auto' } as object) : null),
  },
  scrollAuto: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
    flexGrow: 0,
  },
  bodyContentPadded: {
    paddingHorizontal: 20,
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
  summaryBox: {
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  summaryLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
  },
  summaryScore: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 28,
    color: colors.ink,
    marginTop: 4,
  },
  summaryRate: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.accentDeep,
    marginBottom: 8,
  },
  summaryList: {
    alignSelf: 'stretch',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    maxHeight: 280,
  },
  summaryListContent: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  summaryRowMain: {
    flex: 1,
    gap: 2,
  },
  summaryRowLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.muted,
  },
  summaryRowTitle: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  summaryRowValue: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
  },
  summaryRowCorrect: {
    color: colors.accentDeep,
  },
  summaryRowWrong: {
    color: colors.spotlight,
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
    marginBottom: 6,
  },
  categoryLabel: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
    marginBottom: 10,
  },
  questionText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    lineHeight: 24,
    color: colors.ink,
    marginBottom: 16,
  },
  questionImages: {
    gap: 10,
    marginBottom: 16,
  },
  questionImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.line,
  },
  choiceList: {
    gap: 10,
  },
  multiHint: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.spotlightDeep,
    marginBottom: 2,
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
  choiceRowLocked: {
    opacity: 0.45,
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
  choiceMarkCheckbox: {
    borderRadius: 4,
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
  explainBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    marginBottom: 16,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  secondaryButton: {
    backgroundColor: colors.paper,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  secondaryButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  secondaryButtonDisabled: {
    opacity: 0.65,
  },
  secondaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.accentDeep,
  },
  buttonBusyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  aiButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  aiButtonDisabled: {
    opacity: 0.55,
  },
  aiButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  closeChatButton: {
    backgroundColor: colors.mist,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  closeChatButtonPressed: {
    backgroundColor: colors.line,
  },
  closeChatButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.inkSoft,
  },
  chatPane: {
    backgroundColor: colors.mist,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  chatPaneStacked: {
    height: 300,
    flexGrow: 0,
    flexShrink: 0,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  chatPaneInner: {
    flex: 1,
    minHeight: 0,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.paper,
  },
  chatHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatHeaderIconLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 11,
    color: colors.paper,
  },
  chatHeaderTitle: {
    flex: 1,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
  },
  chatMessages: {
    flex: 1,
    minHeight: 140,
  },
  chatMessagesContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  chatEmpty: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    paddingVertical: 12,
  },
  chatThinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  chatThinkingLabel: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.inkSoft,
  },
  chatBubble: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: '92%',
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  chatBubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chatBubbleRole: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 11,
    color: colors.muted,
    marginBottom: 4,
  },
  chatBubbleRoleUser: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  chatBubbleText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.ink,
  },
  chatBubbleTextUser: {
    color: colors.paper,
  },
  chatComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    minHeight: 44,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 10,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.mist,
  },
  chatSendButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  chatSendButtonDisabled: {
    backgroundColor: colors.line,
  },
  chatSendLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  chatSendLabelDisabled: {
    color: colors.muted,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  examNavSection: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  examJumpScroll: {
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    ...(Platform.OS === 'web'
      ? ({ overflowX: 'auto', overflowY: 'hidden' } as object)
      : null),
  },
  examJumpList: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 6,
    paddingRight: 16,
  },
  examJumpHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 11,
    color: colors.muted,
  },
  examJumpChip: {
    minWidth: 34,
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    flexShrink: 0,
  },
  examJumpChipCurrent: {
    borderColor: colors.spotlight,
    backgroundColor: colors.spotlight,
  },
  examJumpChipAnswered: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  examJumpChipPartial: {
    borderColor: colors.line,
    backgroundColor: colors.paper,
    borderStyle: 'dashed',
  },
  examJumpChipLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  examJumpChipLabelCurrent: {
    color: colors.paper,
  },
  examJumpChipLabelAnswered: {
    color: colors.accentDeep,
  },
  examFooterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  examNavButton: {
    flex: 1,
    maxWidth: 200,
  },
  examGradeLink: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  examGradeLinkPressed: {
    opacity: 0.7,
  },
  examGradeLinkLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
    textDecorationLine: 'underline',
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
  examCloseConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
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
